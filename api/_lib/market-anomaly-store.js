// Read side of the market anomaly feed: recent rows from market_anomaly_events,
// shaped for the paid /api/x402/market-anomalies endpoint and the market_anomaly
// alert rules. The write side is api/cron/market-anomalies.js.

import { sql } from './db.js';
import { PROCESSORS, SEVERITIES } from './market-anomaly.js';

const SEVERITY_FLOOR = Object.freeze({
	medium: ['medium', 'high', 'critical'],
	high: ['high', 'critical'],
	critical: ['critical'],
});

export function shapeEvent(r) {
	return {
		id: Number(r.id),
		processor: r.processor,
		subject: r.subject,
		metric: r.metric,
		severity: r.severity,
		direction: r.direction,
		value: r.value != null ? Number(r.value) : null,
		baseline: r.baseline != null ? Number(r.baseline) : null,
		change_pct: r.change_pct != null ? Number(r.change_pct) : null,
		score: r.score != null ? Number(r.score) : null,
		detectors: Array.isArray(r.detectors) ? r.detectors : [],
		summary: r.summary,
		observed_at: new Date(r.observed_at).toISOString(),
	};
}

/**
 * @param {{ processor?: string, processors?: string[], severity?: string, subject?: string, hours?: number, limit?: number, sinceId?: number }} q
 */
export async function queryMarketAnomalies({ processor = '', processors = null, severity = 'medium', subject = '', hours = 24, limit = 50, sinceId = 0 } = {}) {
	const procs = processors?.length ? processors : processor ? [processor] : null;
	const rows = await sql`
		select id, processor, subject, metric, severity, direction, value, baseline, change_pct, score, detectors, summary, observed_at
		from market_anomaly_events
		where created_at > now() - make_interval(hours => ${hours})
		  and id > ${sinceId}
		  and severity = any(${SEVERITY_FLOOR[severity] || SEVERITY_FLOOR.medium}::text[])
		  and (${procs}::text[] is null or processor = any(${procs}::text[]))
		  and (${subject} = '' or lower(subject) = lower(${subject}))
		order by id desc
		limit ${limit}
	`;
	const events = rows.map(shapeEvent);
	return { events, count: events.length, hours, min_severity: severity, processors: [...PROCESSORS], severities: [...SEVERITIES] };
}

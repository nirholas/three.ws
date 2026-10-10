// Per-key analytics over usage_events: which routes a key calls, how often
// they fail, how long they take (p50/p95/p99) and which addresses call it.
// The gateway writes one event per call with meta.route, meta.ip and
// meta.http_status (api/_lib/gateway.js), which is everything this reads.

import { sql } from '../db.js';

const RANGES = new Set([1, 7, 30, 90]);

export function analyticsDays(raw) {
	const n = Number(raw);
	return RANGES.has(n) ? n : 7;
}

function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * @param {{ userId: string, apiKeyId: string, days?: number }} opts
 */
export async function keyAnalytics({ userId, apiKeyId, days = 7 }) {
	const since = new Date(Date.now() - days * 86_400_000).toISOString();
	const [totals, byRoute, topCallers, daily] = await Promise.all([
		sql`
			select count(*)::int as calls,
				count(*) filter (where status <> 'ok')::int as errors,
				percentile_cont(0.5) within group (order by latency_ms) as p50,
				percentile_cont(0.95) within group (order by latency_ms) as p95,
				percentile_cont(0.99) within group (order by latency_ms) as p99,
				max(created_at) as last_call_at
			from usage_events
			where api_key_id = ${apiKeyId} and user_id = ${userId} and kind = 'api' and created_at >= ${since}
		`,
		sql`
			select coalesce(tool, 'unknown') as route,
				count(*)::int as calls,
				count(*) filter (where status <> 'ok')::int as errors,
				percentile_cont(0.5) within group (order by latency_ms) as p50,
				percentile_cont(0.95) within group (order by latency_ms) as p95,
				percentile_cont(0.99) within group (order by latency_ms) as p99
			from usage_events
			where api_key_id = ${apiKeyId} and user_id = ${userId} and kind = 'api' and created_at >= ${since}
			group by 1 order by calls desc limit 50
		`,
		sql`
			select coalesce(meta->>'ip', 'unknown') as ip,
				count(*)::int as calls,
				count(*) filter (where status <> 'ok')::int as errors,
				max(created_at) as last_call_at
			from usage_events
			where api_key_id = ${apiKeyId} and user_id = ${userId} and kind = 'api' and created_at >= ${since}
			group by 1 order by calls desc limit 10
		`,
		sql`
			select date_trunc('day', created_at) as day,
				count(*)::int as calls,
				count(*) filter (where status <> 'ok')::int as errors
			from usage_events
			where api_key_id = ${apiKeyId} and user_id = ${userId} and kind = 'api' and created_at >= ${since}
			group by 1 order by 1
		`,
	]);
	const t = totals[0] || {};
	return {
		days,
		since,
		totals: {
			calls: t.calls || 0,
			errors: t.errors || 0,
			error_rate: t.calls ? Math.round((t.errors / t.calls) * 10_000) / 10_000 : 0,
			p50_ms: num(t.p50),
			p95_ms: num(t.p95),
			p99_ms: num(t.p99),
			last_call_at: t.last_call_at || null,
		},
		by_route: byRoute.map((r) => ({ route: r.route, calls: r.calls, errors: r.errors, p50_ms: num(r.p50), p95_ms: num(r.p95), p99_ms: num(r.p99) })),
		top_callers: topCallers.map((r) => ({ ip: r.ip, calls: r.calls, errors: r.errors, last_call_at: r.last_call_at })),
		daily: daily.map((r) => ({ day: r.day, calls: r.calls, errors: r.errors })),
	};
}

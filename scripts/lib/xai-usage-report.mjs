// Report builder for `npm run grok:usage`: spend by lane and model over three
// windows, burn rate, and (when the grant env vars are set) remaining credit,
// projected exhaustion and days to expiry. Pure over a `sql` handle so the same
// code runs against production (--prod-env) and the isolated test database.

import { creditPosition, creditVerdict } from '../../api/_lib/xai-credit-health.js';

const DAY_MS = 86_400_000;
export const WINDOWS = [
	{ label: 'today', days: 1 },
	{ label: '7 days', days: 7 },
	{ label: '30 days', days: 30 },
];

const usd = (micro) => `$${(Number(micro) / 1e6).toFixed(2)}`;

/** Spend rows grouped by lane and model since `since`. */
export async function spendByLaneModel(sql, since) {
	return sql`
		select lane, model, count(*)::int as calls, coalesce(sum(cost_usd_micro), 0)::float8 as micro,
			(count(*) filter (where cost_source = 'price_table'))::int as estimated
		from xai_usage where created_at >= ${since.toISOString()}
		group by lane, model order by micro desc
	`;
}

/** Everything the CLI prints, as data. */
export async function buildReport(sql, { now = Date.now(), env = process.env } = {}) {
	const windows = [];
	for (const w of WINDOWS) {
		const rows = await spendByLaneModel(sql, new Date(now - w.days * DAY_MS));
		windows.push({ ...w, rows, totalMicro: rows.reduce((a, r) => a + r.micro, 0) });
	}
	const week = windows.find((w) => w.days === 7);
	const grantUsd = Number(env.XAI_CREDIT_GRANT_USD);
	const issuedAt = env.XAI_CREDIT_ISSUED_AT ? new Date(env.XAI_CREDIT_ISSUED_AT) : null;
	let credit = null;
	if (Number.isFinite(grantUsd) && grantUsd > 0 && issuedAt && !Number.isNaN(issuedAt.getTime())) {
		const [tot] = await sql`select coalesce(sum(cost_usd_micro), 0)::float8 as micro from xai_usage where created_at >= ${issuedAt.toISOString()}`;
		const cap = Number(env.XAI_DAILY_SPEND_CAP_USD);
		const position = creditPosition({
			now,
			grantUsd,
			issuedAt,
			spentUsd: tot.micro / 1e6,
			spent24hUsd: windows[0].totalMicro / 1e6,
			spent7dUsd: week.totalMicro / 1e6,
			dailyCapUsd: Number.isFinite(cap) && cap > 0 ? cap : null,
		});
		credit = {
			grantUsd,
			spentUsd: tot.micro / 1e6,
			position,
			verdict: creditVerdict(position),
			exhaustionDate: position.daysToExhaustion === null ? null : new Date(now + position.daysToExhaustion * DAY_MS),
		};
	}
	return { now, windows, burnPerDayUsd: week.totalMicro / 1e6 / 7, credit };
}

export function formatReport(r) {
	const out = [];
	for (const w of r.windows) {
		out.push(`${w.label}: ${usd(w.totalMicro)}`);
		if (!w.rows.length) out.push('  no xAI calls recorded');
		for (const row of w.rows) {
			const est = row.estimated ? `  (${row.estimated} priced from table)` : '';
			out.push(`  ${row.lane.padEnd(12)} ${row.model.padEnd(34)} ${String(row.calls).padStart(6)} calls  ${usd(row.micro).padStart(10)}${est}`);
		}
	}
	out.push(`burn rate (7 day average): ${r.burnPerDayUsd.toFixed(2)} USD/day`);
	if (!r.credit) {
		out.push('credit: set XAI_CREDIT_GRANT_USD and XAI_CREDIT_ISSUED_AT for remaining credit and expiry (see docs/ops/xai-credits.md)');
	} else {
		const c = r.credit;
		out.push(`credit: ${c.position.remainingUsd.toFixed(2)} USD remaining of ${c.grantUsd.toFixed(2)} (${c.spentUsd.toFixed(2)} spent since issue)`);
		out.push(`expires: ${c.position.expiry.toISOString().slice(0, 10)} (${c.position.daysToExpiry} days)`);
		out.push(
			c.exhaustionDate
				? `projected exhaustion: ${c.exhaustionDate.toISOString().slice(0, 10)} (${c.position.daysToExhaustion} days at current burn)`
				: 'projected exhaustion: none (no recent burn)',
		);
		out.push(`status: ${c.verdict.status}${c.verdict.reasons.length ? `: ${c.verdict.reasons.join('; ')}` : ''}`);
	}
	return out.join('\n');
}

/**
 * Sum the `usd` series of a management API usage response (POST
 * /v1/billing/teams/{team_id}/usage with values [{ name: 'usd', aggregation:
 * 'AGGREGATION_SUM' }]): every data point of every series.
 */
export function sumManagementUsd(body) {
	let total = 0;
	for (const series of body?.timeSeries ?? []) {
		for (const point of series.dataPoints ?? []) total += Number(point.values?.[0]) || 0;
	}
	return total;
}

/** Request body for the usage endpoint over [from, to), UTC. */
export function managementUsageRequest(from, to) {
	const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
	return {
		analyticsRequest: {
			timeRange: { startTime: fmt(from), endTime: fmt(to), timezone: 'Etc/GMT' },
			timeUnit: 'TIME_UNIT_DAY',
			values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
			groupBy: [],
			filters: [],
		},
	};
}

/** Drift between our ledger and xAI's number for the same window. */
export function reconcile(ledgerUsd, xaiUsd) {
	const driftUsd = ledgerUsd - xaiUsd;
	return {
		ledgerUsd,
		xaiUsd,
		driftUsd,
		driftPct: xaiUsd > 0 ? (driftUsd / xaiUsd) * 100 : null,
		looksLikeCents: xaiUsd > 0 && ledgerUsd > 0 && xaiUsd / ledgerUsd > 50,
	};
}

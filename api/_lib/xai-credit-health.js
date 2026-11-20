// xAI startups credit health, reported as the `xai_credit` subsystem in
// /api/healthz. The grant is one balance with a six month expiry, so there are
// three ways to lose: run dry mid-demo, let it expire unspent, or overspend in
// a day. The verdict is computed from the xai_usage ledger plus three env vars
// that live on Cloud Run only (XAI_CREDIT_GRANT_USD, XAI_CREDIT_ISSUED_AT,
// XAI_DAILY_SPEND_CAP_USD). The grant amount never appears in the result: the
// public detail carries the status and day counts only.
//
// Verdicts:
//   fail  spend in the last 24h is over the daily cap, or the grant is spent
//   warn  credit runs out in under RUNWAY_WARN_DAYS at the current burn and
//         before expiry (the lane is about to die), or expiry is within
//         WASTE_WARN_DAYS with more than WASTE_WARN_UNSPENT of the grant
//         unspent (credit about to be wasted), or it expired with credit left
//   ok    otherwise
//   unknown  the grant env vars are not set, or the ledger cannot be read

import { sql } from './db.js';
import { env } from './env.js';

export const RUNWAY_WARN_DAYS = 14;
export const WASTE_WARN_DAYS = 30;
export const WASTE_WARN_UNSPENT = 0.4;
export const EXPIRY_MONTHS = 6;
export const BURN_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/** Expiry instant: six calendar months after issue. PURE. */
export function creditExpiry(issuedAt) {
	const d = new Date(issuedAt);
	d.setUTCMonth(d.getUTCMonth() + EXPIRY_MONTHS);
	return d;
}

/**
 * Credit position from the grant and the ledger totals. PURE.
 * @param {{ now: number, grantUsd: number, issuedAt: string|number|Date, spentUsd: number, spent24hUsd: number, spent7dUsd: number, dailyCapUsd?: number|null }} i
 */
export function creditPosition({ now, grantUsd, issuedAt, spentUsd, spent24hUsd, spent7dUsd, dailyCapUsd = null }) {
	const expiry = creditExpiry(issuedAt);
	const remainingUsd = grantUsd - spentUsd;
	const windowDays = Math.max(1, Math.min(BURN_WINDOW_DAYS, (now - new Date(issuedAt).getTime()) / DAY_MS));
	const burnPerDayUsd = spent7dUsd / windowDays;
	const daysToExpiry = Math.ceil((expiry.getTime() - now) / DAY_MS);
	const daysToExhaustion = burnPerDayUsd > 0 && remainingUsd > 0 ? Math.floor(remainingUsd / burnPerDayUsd) : null;
	const unspentFraction = grantUsd > 0 ? Math.max(0, remainingUsd) / grantUsd : 0;
	return { expiry, remainingUsd, burnPerDayUsd, daysToExpiry, daysToExhaustion, unspentFraction, spent24hUsd, dailyCapUsd };
}

/** Verdict for a position. PURE. Returns { status: 'ok'|'warn'|'fail', reasons: string[] }. */
export function creditVerdict(p) {
	const fails = [];
	const warns = [];
	if (p.dailyCapUsd != null && p.spent24hUsd > p.dailyCapUsd) fails.push('24 hour spend is over the daily cap');
	if (p.remainingUsd <= 0) fails.push('the credit grant is spent');
	if (p.daysToExpiry < 0 && p.remainingUsd > 0) warns.push('the credit expired with a balance left');
	if (p.daysToExhaustion !== null && p.daysToExhaustion < RUNWAY_WARN_DAYS && p.daysToExhaustion < p.daysToExpiry) {
		warns.push(`credit runs out in ${p.daysToExhaustion} days at the current burn, before it expires`);
	}
	if (p.daysToExpiry >= 0 && p.daysToExpiry <= WASTE_WARN_DAYS && p.unspentFraction > WASTE_WARN_UNSPENT) {
		warns.push(`${p.daysToExpiry} days to expiry with more than ${Math.round(WASTE_WARN_UNSPENT * 100)}% unspent`);
	}
	const status = fails.length ? 'fail' : warns.length ? 'warn' : 'ok';
	return { status, reasons: [...fails, ...warns] };
}

const SUBSYSTEM_STATUS = { ok: 'ok', warn: 'degraded', fail: 'down' };

function parseGrant() {
	const grantUsd = Number(env.XAI_CREDIT_GRANT_USD);
	const issuedAt = env.XAI_CREDIT_ISSUED_AT ? new Date(env.XAI_CREDIT_ISSUED_AT) : null;
	if (!Number.isFinite(grantUsd) || grantUsd <= 0 || !issuedAt || Number.isNaN(issuedAt.getTime())) return null;
	const cap = Number(env.XAI_DAILY_SPEND_CAP_USD);
	return { grantUsd, issuedAt, dailyCapUsd: Number.isFinite(cap) && cap > 0 ? cap : null };
}

/** Spend totals in USD from the ledger since `issuedAt`, 24h and 7d. */
export async function readLedgerTotals({ now, issuedAt }) {
	const [row] = await sql`
		select
			coalesce(sum(cost_usd_micro) filter (where created_at >= ${issuedAt.toISOString()}), 0)::float8 as total,
			coalesce(sum(cost_usd_micro) filter (where created_at >= ${new Date(now - DAY_MS).toISOString()}), 0)::float8 as d1,
			coalesce(sum(cost_usd_micro) filter (where created_at >= ${new Date(now - BURN_WINDOW_DAYS * DAY_MS).toISOString()}), 0)::float8 as d7
		from xai_usage
	`;
	return { spentUsd: row.total / 1e6, spent24hUsd: row.d1 / 1e6, spent7dUsd: row.d7 / 1e6 };
}

/**
 * The healthz subsystem entry. Never throws; never includes the grant amount.
 */
export async function gatherXaiCreditHealth(now = Date.now()) {
	const base = { name: 'xai_credit', label: 'xAI startups credit', advisory: true };
	const grant = parseGrant();
	if (!grant) return { ...base, status: 'unknown', detail: 'credit grant not configured' };
	try {
		const totals = await readLedgerTotals({ now, issuedAt: grant.issuedAt });
		const p = creditPosition({ now, grantUsd: grant.grantUsd, issuedAt: grant.issuedAt, dailyCapUsd: grant.dailyCapUsd, ...totals });
		const v = creditVerdict(p);
		const days = [`${p.daysToExpiry} days to expiry`, p.daysToExhaustion === null ? 'no recent burn' : `${p.daysToExhaustion} days of credit at current burn`];
		return {
			...base,
			status: SUBSYSTEM_STATUS[v.status],
			detail: v.status === 'ok' ? days.join(', ') : `${v.reasons.join('; ')} (${days.join(', ')})`,
			metrics: { verdict: v.status, daysToExpiry: p.daysToExpiry, daysToExhaustion: p.daysToExhaustion },
		};
	} catch (err) {
		return { ...base, status: 'unknown', detail: `ledger unreadable: ${err?.message || 'error'}` };
	}
}

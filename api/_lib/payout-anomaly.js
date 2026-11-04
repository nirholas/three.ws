// @ts-check
// Payout anomaly detection. Two signals, both read from agent_withdrawals:
//
//   volume   the last 24 hours moved more than MULTIPLIER x the median daily
//            volume of the 14 days before, per currency (a runaway loop or a
//            drained-balance exploit looks like this).
//   failure  more than 20 percent of the last 24 hours' payouts failed, given
//            at least MIN_FAILURE_SAMPLE of them (a broken signer, an empty
//            treasury or a dead RPC looks like this).
//
// `evaluatePayouts` is pure so the thresholds are tested without a database;
// `scanPayouts` feeds it from the ledger. Quiet history is not an anomaly on
// its own: when the trailing median is zero, volume is judged by payout count
// instead (COUNT_FLOOR_WHEN_QUIET), so a platform's first real day of payouts
// does not page anyone but a runaway of dozens does.

import { sql } from './db.js';

export const DEFAULT_MULTIPLIER = 3;
export const FAILURE_RATE_LIMIT = 0.2;
export const MIN_FAILURE_SAMPLE = 5;
export const COUNT_FLOOR_WHEN_QUIET = 25;
export const TRAILING_DAYS = 14;

/** @param {number[]} values */
export function median(values) {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {{
 *   perMint: Record<string, { last24h: number, last24hCount: number, trailingDaily: number[] }>,
 *   failed24h: number,
 *   total24h: number,
 *   multiplier?: number,
 * }} input
 * @returns {Array<{ kind: 'volume' | 'failure', detail: string }>}
 */
export function evaluatePayouts({ perMint, failed24h, total24h, multiplier = DEFAULT_MULTIPLIER }) {
	/** @type {Array<{ kind: 'volume' | 'failure', detail: string }>} */
	const findings = [];
	for (const [mint, row] of Object.entries(perMint)) {
		const days = [...row.trailingDaily];
		while (days.length < TRAILING_DAYS) days.push(0);
		const base = median(days);
		if (base > 0) {
			if (row.last24h > base * multiplier) {
				findings.push({
					kind: 'volume',
					detail: `${mint}: ${row.last24h} atomics in 24h is ${(row.last24h / base).toFixed(1)}x the ${TRAILING_DAYS}-day median of ${base} (limit ${multiplier}x)`,
				});
			}
		} else if (row.last24hCount >= COUNT_FLOOR_WHEN_QUIET) {
			findings.push({
				kind: 'volume',
				detail: `${mint}: ${row.last24hCount} payouts in 24h against a ${TRAILING_DAYS}-day median of zero (limit ${COUNT_FLOOR_WHEN_QUIET})`,
			});
		}
	}
	if (total24h >= MIN_FAILURE_SAMPLE && failed24h / total24h > FAILURE_RATE_LIMIT) {
		findings.push({
			kind: 'failure',
			detail: `${failed24h} of ${total24h} payouts failed in 24h (${Math.round((failed24h / total24h) * 100)}%, limit ${Math.round(FAILURE_RATE_LIMIT * 100)}%)`,
		});
	}
	return findings;
}

/** Read the ledger and evaluate it. */
export async function scanPayouts({ multiplier = DEFAULT_MULTIPLIER } = {}) {
	const rows = await sql`
		SELECT currency_mint,
		       floor(extract(epoch FROM (now() - created_at)) / 86400)::int AS age_day,
		       sum(amount) FILTER (WHERE status <> 'failed')::float8 AS volume,
		       count(*) FILTER (WHERE status <> 'failed')::int AS paid_count,
		       count(*) FILTER (WHERE status = 'failed')::int AS failed_count
		FROM agent_withdrawals
		WHERE created_at >= now() - ${`${TRAILING_DAYS + 1} days`}::interval
		GROUP BY currency_mint, age_day
	`;
	/** @type {Record<string, { last24h: number, last24hCount: number, trailingDaily: number[] }>} */
	const perMint = {};
	let failed24h = 0;
	let total24h = 0;
	for (const r of rows) {
		const bucket = (perMint[r.currency_mint] ||= { last24h: 0, last24hCount: 0, trailingDaily: [] });
		if (r.age_day === 0) {
			bucket.last24h += Number(r.volume || 0);
			bucket.last24hCount += r.paid_count;
			failed24h += r.failed_count;
			total24h += r.paid_count + r.failed_count;
		} else if (r.age_day <= TRAILING_DAYS) {
			bucket.trailingDaily.push(Number(r.volume || 0));
		}
	}
	const findings = evaluatePayouts({ perMint, failed24h, total24h, multiplier });
	return { findings, failed24h, total24h, mints: Object.keys(perMint).length };
}

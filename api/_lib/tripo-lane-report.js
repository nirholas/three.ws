// @ts-check
// Tripo-lane health: completion rate and median latency by day, for the
// lane work order 084-partners-01-tripo-v3-house-lane.md (task 6) asked be
// reportable on its own, separately from the all-backend forge-funnel.js
// numbers. Scoped to backend = 'tripo' rows only (both the BYOK path and the
// TRIPO_API_KEY house-key path write that same backend value).
//
// Read-only. Every query is a SELECT.

import { sql } from './db.js';

export const TRIPO_LANE_MIN_DAYS = 1;
export const TRIPO_LANE_MAX_DAYS = 365;
export const TRIPO_LANE_DEFAULT_DAYS = 30;

/** Clamp a caller-supplied window to a whole number of days in range. */
export function clampTripoLaneDays(value) {
	if (value == null || value === '') return TRIPO_LANE_DEFAULT_DAYS;
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return TRIPO_LANE_DEFAULT_DAYS;
	return Math.min(TRIPO_LANE_MAX_DAYS, Math.max(TRIPO_LANE_MIN_DAYS, n));
}

function int(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function round1(v) {
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/**
 * One row per day: completion rate and median seconds-to-done, from the raw
 * per-day counts the query below returns. Pure, so it is testable without a
 * database.
 *
 * @param {Array<Record<string, unknown>>} rows
 */
export function summarizeTripoLaneDays(rows = []) {
	return rows.map((r) => {
		const done = int(r.done);
		const failed = int(r.failed);
		const total = int(r.total);
		const terminal = done + failed;
		return {
			day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
			total,
			done,
			failed,
			in_flight: Math.max(0, total - terminal),
			completion_rate: terminal > 0 ? Math.round((done / terminal) * 1000) / 1000 : null,
			median_latency_seconds: r.median_seconds == null ? null : round1(r.median_seconds),
		};
	});
}

/**
 * @param {{ days?: number|string }} [opts]
 */
export async function gatherTripoLaneReport({ days } = {}) {
	const windowDays = clampTripoLaneDays(days);
	try {
		const rows = await sql`
			with totals as (
				select
					date_trunc('day', created_at) as day,
					count(*)::int as total,
					count(*) filter (where status = 'done')::int as done,
					count(*) filter (where status = 'failed')::int as failed
				from forge_creations
				where backend = 'tripo'
					and created_at > now() - make_interval(days => ${windowDays})
				group by 1
			),
			latency as (
				select
					date_trunc('day', created_at) as day,
					percentile_cont(0.5) within group (
						order by extract(epoch from (updated_at - created_at))
					) as median_seconds
				from forge_creations
				where backend = 'tripo' and status = 'done'
					and created_at > now() - make_interval(days => ${windowDays})
				group by 1
			)
			select t.day, t.total, t.done, t.failed, l.median_seconds
			from totals t
			left join latency l using (day)
			order by t.day desc
		`;
		const byDay = summarizeTripoLaneDays(rows);
		const totalDone = byDay.reduce((n, d) => n + d.done, 0);
		const totalFailed = byDay.reduce((n, d) => n + d.failed, 0);
		const totalTerminal = totalDone + totalFailed;
		const allLatencies = byDay.map((d) => d.median_latency_seconds).filter((v) => v != null);
		return {
			ok: true,
			window_days: windowDays,
			total: byDay.reduce((n, d) => n + d.total, 0),
			done: totalDone,
			failed: totalFailed,
			completion_rate: totalTerminal > 0 ? Math.round((totalDone / totalTerminal) * 1000) / 1000 : null,
			// Median of the daily medians, not a second pass over every row: cheap,
			// and stable against one noisy day dominating the window summary.
			median_latency_seconds:
				allLatencies.length === 0
					? null
					: round1(
							[...allLatencies].sort((a, b) => a - b)[Math.floor((allLatencies.length - 1) / 2)],
						),
			by_day: byDay,
		};
	} catch (err) {
		return { ok: false, error: err?.message || String(err), window_days: windowDays, by_day: [] };
	}
}

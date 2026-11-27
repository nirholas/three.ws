// @ts-check
// Shared core of the Forge operator reports: `npm run forge:errors`
// (scripts/forge-error-report.mjs) and `npm run forge:funnel`
// (scripts/forge-funnel-report.mjs, GET /api/ops/forge-funnel, /forge-funnel).
//
// Read-only. Every query is a SELECT.

import { sql } from './db.js';
import { classifyForgeError } from './ops/forge-error-class.js';

/**
 * Raw rows for the error report, over the current window and the one before it.
 * @param {{ days: number, includeRecovered?: boolean }} opts
 */
export async function gatherForgeErrors({ days, includeRecovered = false }) {
	const since = `${days} days`;
	const [totals] = await sql`
		SELECT count(*) FILTER (WHERE status = 'done')::int    AS done,
		       count(*) FILTER (WHERE status = 'failed')::int  AS failed,
		       count(*) FILTER (WHERE status NOT IN ('done', 'failed'))::int AS open,
		       count(*) FILTER (WHERE superseded_by IS NOT NULL)::int AS recovered,
		       count(*)::int AS rows
		FROM forge_creations
		WHERE created_at >= now() - ${since}::interval
	`;
	const failures = await sql`
		SELECT id, error, created_at,
		       COALESCE(backend, '(none)') AS backend,
		       COALESCE(path, '(none)')    AS path
		FROM forge_creations
		WHERE status = 'failed'
		  AND created_at >= now() - ${since}::interval
		  AND (${includeRecovered} OR superseded_by IS NULL)
		ORDER BY created_at DESC
	`;
	return { totals, failures };
}

/**
 * @param {{ totals: Record<string, any>, failures: Array<Record<string, any>> }} raw
 */
export function summarizeForgeErrors(raw) {
	const t = raw.totals || {};
	const done = Number(t.done) || 0;
	const failedRows = Number(t.failed) || 0;
	const recovered = Number(t.recovered) || 0;
	const lost = Math.max(0, failedRows - recovered);
	const classes = new Map();
	for (const row of raw.failures) {
		const c = classifyForgeError(row.error);
		const key = c.id === 'other' ? `other:${c.normalized}` : c.id;
		classes.set(key, (classes.get(key) || 0) + 1);
	}
	return {
		done,
		failed: lost,
		recovered,
		in_flight: Number(t.open) || 0,
		success_rate: { value: done + lost > 0 ? Math.round((done / (done + lost)) * 10_000) / 10_000 : null },
		classes,
	};
}

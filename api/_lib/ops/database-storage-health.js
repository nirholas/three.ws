// Database storage subsystem for /api/healthz.
//
// The write-heavy crons skip their tick once pg_database_size crosses the
// high-water mark (DB_RETENTION_HIGH_WATER_MB, see isStoragePressured in
// api/_lib/db.js). That skip is silent from the outside: every page still answers
// 200 while ingest, rollups and reputation stop. This sensor gives the condition
// a health signature BEFORE it bites.
//
//   ok        below 75% of the mark
//   degraded  75% to 100% of the mark (retention is working against the cap)
//   down      above the mark (write-heavy crons are skipping right now)

import { cacheGet } from '../cache.js';

export const LAST_RUN_CACHE_KEY = 'db-retention:last-run';
export const DEGRADED_RATIO = 0.75;

/** Same resolution as storageHighWaterMb() in api/_lib/db.js. */
export function highWaterMb(env = process.env) {
	const raw = Number.parseInt(String(env.DB_RETENTION_HIGH_WATER_MB ?? ''), 10);
	return Number.isFinite(raw) && raw >= 128 && raw <= 100_000 ? raw : 470;
}

/**
 * Pure classification so the thresholds are unit-testable.
 *
 * @param {{ sizeMb: number, markMb: number,
 *   topTables?: Array<{ table: string, mb: number }>,
 *   lastRun?: { at?: string, size_before_mb?: number, size_after_mb?: number, archived?: number, deleted?: number } | null }} a
 */
export function classifyDatabaseStorage({ sizeMb, markMb, topTables = [], lastRun = null }) {
	const base = { name: 'database_storage', label: 'Database storage vs high-water mark' };
	const pct = Math.round((sizeMb / markMb) * 100);
	const top = topTables.slice(0, 3).map((t) => `${t.table} ${t.mb}MB`).join(', ') || 'n/a';
	const last = lastRun?.at
		? `last retention run ${lastRun.at} (${lastRun.size_before_mb}MB to ${lastRun.size_after_mb}MB, ${lastRun.deleted ?? 0} archived rows pruned)`
		: 'no retention run recorded in the last 7 days';
	const detail = `${sizeMb}MB of ${markMb}MB mark (${pct}%). Largest: ${top}. ${last}.`;
	const extra = { sizeMb, markMb, percentOfMark: pct, topTables: topTables.slice(0, 3), lastRun };
	if (sizeMb > markMb) {
		return {
			...base,
			status: 'down',
			detail,
			...extra,
			hint: 'Write-heavy crons are skipping ("db at storage cap"). Run `node scripts/db-archive-table.mjs --all --prune`, then VACUUM FULL the biggest tables (docs/ops/db-retention.md), or raise DB_RETENTION_HIGH_WATER_MB with the Neon plan.',
		};
	}
	if (sizeMb >= markMb * DEGRADED_RATIO) {
		return {
			...base,
			status: 'degraded',
			detail,
			...extra,
			hint: 'Retention is running close to the cap. Check the archive step in the last db-retention run and compact bloated tables (docs/ops/db-retention.md).',
		};
	}
	return { ...base, status: 'ok', detail, ...extra };
}

export async function gatherDatabaseStorageHealth() {
	const base = { name: 'database_storage', label: 'Database storage vs high-water mark' };
	try {
		const { sql } = await import('../db.js');
		const [size] = await sql`SELECT (pg_database_size(current_database()) / 1048576.0)::int AS mb`;
		const top = await sql`
			SELECT c.relname AS "table", (pg_total_relation_size(c.oid) / 1048576.0)::int AS mb
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relkind = 'r'
			ORDER BY pg_total_relation_size(c.oid) DESC
			LIMIT 3
		`;
		let lastRun = null;
		try {
			lastRun = (await cacheGet(LAST_RUN_CACHE_KEY)) || null;
		} catch {
			lastRun = null;
		}
		return classifyDatabaseStorage({
			sizeMb: Number(size.mb) || 0,
			markMb: highWaterMb(),
			topTables: top.map((r) => ({ table: r.table, mb: Number(r.mb) })),
			lastRun,
		});
	} catch (err) {
		return { ...base, status: 'unknown', detail: err?.message || 'size unreadable' };
	}
}

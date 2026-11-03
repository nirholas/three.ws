// Archive-then-delete retention for append-only audit tables.
//
// Audit and payment ledger rows are not regenerable, so a prune never deletes a
// row until a gzip JSONL object holding it has been written to object storage and
// read back (HEAD size check). Rows are processed one UTC day at a time in bounded
// parts; a day whose archive part fails is left untouched in the database and is
// reported, never deleted. If object storage is not configured nothing is deleted.
//
// Archive layout: audit-archive/<table>/<YYYY-MM-DD>/<runStamp>-<part>.jsonl.gz
// One line per row, the full row as `to_jsonb(row)`.

import { gzipSync } from 'node:zlib';
import { sql } from './db.js';
import { putObject, headObject, objectStorageConfigured } from './r2.js';

// Identifiers are interpolated into SQL, so only these tables are accepted.
const PRUNABLE = new Set(['audit_log', 'x402_audit_log']);

const defaultStore = {
	configured: () => objectStorageConfigured(),
	put: (key, body) => putObject({
		key, body, contentType: 'application/gzip',
		metadata: { 'content-encoding': 'gzip' },
	}),
	head: (key) => headObject(key),
};

/**
 * Parse a retention-days env value. Returns `fallback` for anything that is not a
 * positive integer, and never below `floor` (a typo must not wipe the ledger).
 */
export function parseRetentionDays(raw, fallback = 365, floor = 30) {
	const n = Number.parseInt(String(raw ?? ''), 10);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return Math.max(n, floor);
}

async function archivePart(store, table, day, stamp, part, rows) {
	const key = `audit-archive/${table}/${day}/${stamp}-${part}.jsonl.gz`;
	const body = gzipSync(Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8'));
	await store.put(key, body);
	const head = await store.head(key);
	if (!head || Number(head.ContentLength) !== body.length) {
		throw new Error(`archive verification failed for ${key}: expected ${body.length} bytes, found ${head?.ContentLength ?? 'none'}`);
	}
	return key;
}

/**
 * @param {object} o
 * @param {'audit_log'|'x402_audit_log'} o.table
 * @param {number} o.retentionDays
 * @param {string[]} [o.exemptActions]   audit_log only: actions that are never pruned
 * @param {number} [o.maxDays]           UTC days handled per run
 * @param {number} [o.batchRows]         rows per archive part
 * @param {number} [o.now]
 * @param {object} [o.store]             storage adapter (tests); defaults to R2/S3
 * @returns {Promise<{ table, retentionDays, cutoff, days, archivedRows, deleted, objects: string[], failures: {day:string,error:string}[], refused?: string }>}
 */
export async function pruneTableWithArchive({
	table, retentionDays, exemptActions = [], maxDays = 5, batchRows = 5000, now = Date.now(), store = defaultStore,
}) {
	if (!PRUNABLE.has(table)) throw new Error(`pruneTableWithArchive: table not allowed: ${table}`);
	const cutoff = new Date(now - retentionDays * 86_400_000).toISOString();
	const out = { table, retentionDays, cutoff, days: 0, archivedRows: 0, deleted: 0, objects: [], failures: [] };

	const exempt = table === 'audit_log' && exemptActions.length > 0;
	const exemptSql = exempt ? ' AND action <> ALL($2::text[])' : '';
	const withExempt = (params) => (exempt ? [...params, exemptActions] : params);

	if (!store.configured()) return { ...out, refused: 'object_storage_not_configured' };

	const days = await sql(
		`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
		   FROM ${table}
		  WHERE created_at < $1::timestamptz${exemptSql}
		  GROUP BY 1 ORDER BY 1 LIMIT ${Math.max(1, Math.floor(maxDays))}`,
		withExempt([cutoff]),
	);

	const stamp = new Date(now).toISOString().replace(/[-:.]/g, '').slice(0, 15);
	for (const { day } of days) {
		let part = 0;
		let dayFailed = false;
		for (;;) {
			const rows = await sql(
				`SELECT to_jsonb(t) AS row
				   FROM ${table} t
				  WHERE created_at >= $1::timestamptz AND created_at < ($1::timestamptz + interval '1 day')
				    AND created_at < $2::timestamptz${exemptSql.replace('$2', '$3')}
				  ORDER BY id LIMIT ${Math.max(1, Math.floor(batchRows))}`,
				exempt ? [`${day}T00:00:00Z`, cutoff, exemptActions] : [`${day}T00:00:00Z`, cutoff],
			);
			if (!rows.length) break;
			const payloads = rows.map((r) => r.row);
			try {
				out.objects.push(await archivePart(store, table, day, stamp, part, payloads));
			} catch (err) {
				out.failures.push({ day, error: String(err?.message ?? err).slice(0, 300) });
				dayFailed = true;
				break;
			}
			const ids = payloads.map((p) => p.id);
			const gone = await sql(`DELETE FROM ${table} WHERE id = ANY($1::uuid[]) RETURNING id`, [ids]);
			out.archivedRows += payloads.length;
			out.deleted += gone.length;
			part += 1;
			if (rows.length < batchRows) break;
		}
		if (!dayFailed) out.days += 1;
		// Storage trouble tends to be global: stop instead of retrying every day.
		if (dayFailed) break;
	}
	return out;
}

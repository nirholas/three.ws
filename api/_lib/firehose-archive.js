// Archive-before-delete for the Coin Intelligence firehose (the data behind
// /radar, /coin-intel and the Oracle coin pages).
//
// db-retention used to DELETE every pump_coin_intel mint past the retention
// window, with its six mint-keyed satellites, and keep no copy, so the platform
// held only the last few days of the launches it had observed. This module keeps
// the window (the live tables stay small and fast) but makes the delete safe:
// every row leaves Postgres only after it is in cold storage.
//
// The contract, per batch of mints:
//
//   1. Every row for those mints is read from each satellite and the master,
//      along with its ctid.
//   2. Each table's rows become one gzip NDJSON part under `<table>/<day>/`,
//      uploaded create-only with server-side MD5 verification and checked
//      again (size + md5) here, followed by a manifest in the same shape
//      db-archive.js writes, so scripts/db-archive-table.mjs can --verify and
//      --restore these tables like any other archived table.
//   3. Only when EVERY part and manifest of the batch has landed are rows
//      deleted, and only the exact rows archived (by ctid). A row updated after
//      it was read has a new ctid, so it survives and is archived next tick.
//   4. The master row is deleted last, and only for mints with no satellite row
//      left, so a satellite row written between steps 1 and 3 is never removed
//      by the FK cascade without being archived first.
//
// Any failure before step 3 deletes nothing and reports `skipped`.
//
// Table names are fixed constants from db-retention.js, never user input.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const FIREHOSE_MASTER = 'pump_coin_intel';

// Mint-keyed satellites of pump_coin_intel, archived and deleted before the
// master so no run orphans a satellite row. Every name is a fixed constant and
// verified to carry a `mint` column. Deliberately EXCLUDES wallet_reputation /
// smart_wallet_reputation (wallet-keyed accumulated output, the durable product
// value) and pumpfun_graduations (small win/loss ground truth the judge reads).
export const FIREHOSE_SATELLITES = [
	'pump_coin_wallets',
	'coin_smart_money',
	'smart_money_scored',
	'pump_coin_outcomes',
	'oracle_conviction',
	'oracle_conviction_history',
];

/** Every table this module archives, for scripts/db-archive-table.mjs --verify / --restore. */
export const FIREHOSE_TABLES = [FIREHOSE_MASTER, ...FIREHOSE_SATELLITES];

const md5b64 = (buf) => createHash('md5').update(buf).digest('base64');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const ident = (s) => {
	if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unsafe identifier: ${s}`);
	return s;
};

/**
 * Upload one table's rows as a verified part + manifest. Returns the stem so the
 * caller can write the `.deleted.json` marker after the delete.
 */
async function putPart({ store, table, lines, day, runId, tag, minKey, maxKey, cutoff }) {
	const raw = Buffer.from(lines.join('\n') + '\n');
	const gz = gzipSync(raw, { level: 6 });
	const stem = `${table}/${day}/${runId}-${tag}-${sha256(gz).slice(0, 8)}`;
	const partName = `${stem}.ndjson.gz`;
	const md5 = md5b64(gz);
	const meta = await store.put(partName, gz, 'application/gzip');
	if (meta?.md5Hash !== md5 || Number(meta?.size) !== gz.length) {
		throw new Error(`checksum mismatch after upload of ${partName}`);
	}
	const manifest = {
		table,
		part: partName,
		cutoff,
		rows: lines.length,
		// Restore filters parts by day on key[0]; for the firehose that is the
		// master's first_seen_at range for the batch.
		min_key: [minKey],
		max_key: [maxKey],
		key_columns: ['first_seen_at'],
		sha256: sha256(gz),
		md5,
		bytes: gz.length,
		raw_bytes: raw.length,
		archived_at: new Date().toISOString(),
	};
	const mMeta = await store.put(`${stem}.manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
	if (!mMeta?.name) throw new Error(`manifest upload failed for ${partName}`);
	return { stem, partName };
}

async function markDeleted(store, stem, partName, archived, deleted) {
	await store.put(
		`${stem}.deleted.json`,
		Buffer.from(JSON.stringify({ part: partName, archived_rows: archived, deleted_rows: deleted, deleted_at: new Date().toISOString() })),
		'application/json',
	);
}

const deleteByCtid = (table) =>
	`WITH d AS (DELETE FROM ${ident(table)} WHERE ctid = ANY($1::text[]::tid[]) AND mint = ANY($2::text[]) RETURNING 1) SELECT count(*)::int AS n FROM d`;

/**
 * Archive then delete one batch of mints across the master and its satellites.
 *
 * @param {object} a
 * @param {(text:string, params:any[])=>Promise<any[]>} a.query
 * @param {{put:Function}} a.store
 * @param {string[]} a.satellites   live satellite tables (fixed constants)
 * @param {Array<{mint:string, first_seen_at:string}>} a.batch  master rows, oldest first
 * @param {string} a.runId
 * @param {number} a.batchIndex
 * @param {string} a.cutoff         ISO cutoff the batch was selected with
 */
export async function archiveAndPruneMints({ query, store, satellites, batch, runId, batchIndex, cutoff }) {
	const out = { mints: batch.length, archived: {}, deleted: {}, parts: 0, skipped: null };
	if (!batch.length) return out;
	const mints = batch.map((r) => r.mint);
	const minKey = String(batch[0].first_seen_at);
	const maxKey = String(batch[batch.length - 1].first_seen_at);
	const day = minKey.slice(0, 10);
	const tag = `b${String(batchIndex).padStart(4, '0')}`;

	// 1. Read everything first.
	const tables = [...satellites, FIREHOSE_MASTER];
	const read = [];
	try {
		for (const t of tables) {
			const rows = await query(
				`SELECT ctid::text AS tid, to_jsonb(t)::text AS line FROM ${ident(t)} t WHERE t.mint = ANY($1::text[])`,
				[mints],
			);
			read.push({ table: t, rows });
		}
		// 2. Upload every non-empty table; any throw aborts the whole batch.
		for (const r of read) {
			if (!r.rows.length) continue;
			const { stem, partName } = await putPart({
				store,
				table: r.table,
				lines: r.rows.map((x) => x.line),
				day,
				runId,
				tag,
				minKey,
				maxKey,
				cutoff,
			});
			r.stem = stem;
			r.partName = partName;
			out.archived[r.table] = r.rows.length;
			out.parts += 1;
		}
	} catch (err) {
		out.skipped = err?.message || String(err);
		out.archived = {};
		return out;
	}

	// 3. Delete exactly the archived rows, satellites first.
	for (const r of read) {
		if (!r.rows.length) continue;
		let sqlText = deleteByCtid(r.table);
		if (r.table === FIREHOSE_MASTER && satellites.length) {
			// 4. Never let the FK cascade take a satellite row nobody archived.
			const guards = satellites.map((s) => `NOT EXISTS (SELECT 1 FROM ${ident(s)} s WHERE s.mint = ${FIREHOSE_MASTER}.mint)`).join(' AND ');
			sqlText = `WITH d AS (DELETE FROM ${FIREHOSE_MASTER} WHERE ctid = ANY($1::text[]::tid[]) AND mint = ANY($2::text[]) AND ${guards} RETURNING 1) SELECT count(*)::int AS n FROM d`;
		}
		const [{ n }] = await query(sqlText, [r.rows.map((x) => x.tid), mints]);
		out.deleted[r.table] = Number(n);
		await markDeleted(store, r.stem, r.partName, r.rows.length, Number(n)).catch((err) => {
			out.markerError = err.message;
		});
	}
	return out;
}

/**
 * Archive then delete satellite rows whose master row is already gone.
 *
 * @param {object} a
 * @param {(text:string, params:any[])=>Promise<any[]>} a.query
 * @param {{put:Function}} a.store
 * @param {string} a.table
 * @param {number} a.limit
 * @param {string} a.runId
 */
export async function archiveAndPruneOrphans({ query, store, table, limit, runId }) {
	const out = { table, archived: 0, deleted: 0, skipped: null };
	const t = ident(table);
	let rows;
	let stem;
	let partName;
	try {
		rows = await query(
			`SELECT s.ctid::text AS tid, s.mint, to_jsonb(s)::text AS line FROM ${t} s
			 WHERE NOT EXISTS (SELECT 1 FROM ${FIREHOSE_MASTER} p WHERE p.mint = s.mint)
			 LIMIT $1`,
			[limit],
		);
		if (!rows.length) return out;
		const now = new Date().toISOString();
		({ stem, partName } = await putPart({
			store,
			table,
			lines: rows.map((r) => r.line),
			day: now.slice(0, 10),
			runId,
			tag: 'orphans',
			minKey: now,
			maxKey: now,
			cutoff: now,
		}));
		out.archived = rows.length;
	} catch (err) {
		out.skipped = err?.message || String(err);
		return out;
	}
	const [{ n }] = await query(deleteByCtid(table), [rows.map((r) => r.tid), [...new Set(rows.map((r) => r.mint))]]);
	out.deleted = Number(n);
	await markDeleted(store, stem, partName, rows.length, out.deleted).catch((err) => {
		out.markerError = err.message;
	});
	return out;
}

// Archive-then-prune engine for the database's big history tables.
//
// Used by api/cron/db-retention.js (steady-state daily slice) and by
// scripts/db-archive-table.mjs (first bulk archive, restore, verify).
//
// The contract that makes pruning safe:
//
//   1. Rows older than the cutoff are read in keyset order and written to a
//      gzip NDJSON part in a Google Cloud Storage bucket.
//   2. GCS verifies the part's MD5 server-side (md5Hash is sent in the object
//      metadata and the upload is rejected on mismatch); the response is
//      checked again here (size and md5).
//   3. A manifest object (table, cutoff, row count, key range, sha256 and md5
//      of the part) is written next.
//   4. Only then are exactly those rows deleted, by primary key, and a
//      `.deleted.json` marker with the deleted row count is written.
//
// Any failure before step 4 returns `skipped` with the reason and deletes
// nothing. Objects are only ever created (ifGenerationMatch=0), never
// overwritten, so the runtime service account needs create permission only.
//
// Row lines are produced by Postgres (`to_jsonb(t)::text`) and never re-parsed
// here, so bigint and numeric values keep full precision.

import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const ARCHIVE_BUCKET = 'three-ws-db-archive';
const GCS_UPLOAD = 'https://storage.googleapis.com/upload/storage/v1/b';
const GCS_API = 'https://storage.googleapis.com/storage/v1/b';

const md5b64 = (buf) => createHash('md5').update(buf).digest('base64');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function retry(fn, attempts = 3) {
	let last;
	for (let i = 0; i < attempts; i++) {
		try {
			return await fn();
		} catch (err) {
			last = err;
			if (err?.permanent) throw err;
			await new Promise((r) => setTimeout(r, 400 * 2 ** i));
		}
	}
	throw last;
}

/**
 * Minimal GCS JSON-API client (no SDK dependency, same approach as the news
 * archive). `getToken` returns an OAuth access token.
 */
export function createGcsStore({ bucket = ARCHIVE_BUCKET, getToken, fetchImpl = fetch }) {
	async function auth() {
		return { authorization: `Bearer ${await getToken()}` };
	}

	return {
		bucket,

		/** Create-only upload with server-side MD5 verification. */
		async put(name, body, contentType = 'application/octet-stream') {
			const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
			const md5 = md5b64(buf);
			const boundary = 'dbarchive' + sha256(Buffer.from(name)).slice(0, 16);
			const head = Buffer.from(
				`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
					JSON.stringify({ name, contentType, md5Hash: md5 }) +
					`\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
			);
			const payload = Buffer.concat([head, buf, Buffer.from(`\r\n--${boundary}--`)]);
			const url = `${GCS_UPLOAD}/${bucket}/o?uploadType=multipart&ifGenerationMatch=0`;
			return retry(async () => {
				const res = await fetchImpl(url, {
					method: 'POST',
					headers: { ...(await auth()), 'content-type': `multipart/related; boundary=${boundary}` },
					body: payload,
				});
				if (res.status === 412) {
					const err = new Error(`gcs object already exists: ${name}`);
					err.permanent = true;
					throw err;
				}
				if (!res.ok) {
					const err = new Error(`gcs upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
					if (res.status >= 400 && res.status < 500 && res.status !== 429) err.permanent = true;
					throw err;
				}
				return res.json();
			});
		},

		async get(name) {
			return retry(async () => {
				const res = await fetchImpl(`${GCS_API}/${bucket}/o/${encodeURIComponent(name)}?alt=media`, {
					headers: await auth(),
				});
				if (!res.ok) {
					const err = new Error(`gcs read ${res.status}: ${name}`);
					if (res.status === 404 || res.status === 403) err.permanent = true;
					throw err;
				}
				return Buffer.from(await res.arrayBuffer());
			});
		},

		async list(prefix) {
			const names = [];
			let pageToken = '';
			do {
				const url = `${GCS_API}/${bucket}/o?prefix=${encodeURIComponent(prefix)}&fields=items(name,size),nextPageToken&maxResults=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
				const res = await retry(async () => {
					const r = await fetchImpl(url, { headers: await auth() });
					if (!r.ok) throw new Error(`gcs list ${r.status}`);
					return r.json();
				});
				for (const o of res.items || []) names.push(o.name);
				pageToken = res.nextPageToken || '';
			} while (pageToken);
			return names;
		},
	};
}

const ident = (s) => {
	if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unsafe identifier: ${s}`);
	return s;
};

/** SELECT text for one keyset page. Identifiers come from the fixed spec list. */
export function buildSelect(spec, { withCursor }) {
	const t = ident(spec.table);
	const ts = ident(spec.tsColumn);
	const pk = spec.pk.map((p) => ident(p.col));
	const keys = [`t.${ts}::text AS k_ts`, ...pk.map((c, i) => `t.${c}::text AS k_${i}`)].join(', ');
	const cursor = withCursor
		? ` AND (t.${ts}, ${pk.map((c) => `t.${c}`).join(', ')}) > ($2::timestamptz, ${spec.pk.map((p, i) => `$${i + 3}::${p.type}`).join(', ')})`
		: '';
	const limitIdx = withCursor ? 3 + spec.pk.length : 2;
	return (
		`SELECT to_jsonb(t)::text AS line, ${keys} FROM ${t} t ` +
		`WHERE t.${ts} < $1::timestamptz${spec.where ? ` AND (${spec.where})` : ''}${cursor} ` +
		`ORDER BY t.${ts}, ${pk.map((c) => `t.${c}`).join(', ')} LIMIT $${limitIdx}`
	);
}

/** DELETE text for one verified part. $1..$n are pk arrays, $n+1 is the cutoff. */
export function buildDelete(spec) {
	const t = ident(spec.table);
	const ts = ident(spec.tsColumn);
	const pk = spec.pk.map((p) => ident(p.col));
	const unnest = spec.pk.map((p, i) => `$${i + 1}::${p.type}[]`).join(', ');
	const cut = `$${spec.pk.length + 1}::timestamptz`;
	const del = `DELETE FROM ${t} WHERE (${pk.join(', ')}) IN (SELECT * FROM unnest(${unnest})) AND ${ts} < ${cut}${spec.where ? ` AND (${spec.where})` : ''}`;
	if (spec.rollup) {
		return `WITH d AS (${del} RETURNING *), r AS (${spec.rollup}) SELECT count(*)::int AS n FROM d`;
	}
	return `WITH d AS (${del} RETURNING 1) SELECT count(*)::int AS n FROM d`;
}

/**
 * Archive (and optionally prune) up to `maxRows` rows older than the cutoff.
 *
 * @param {object} a
 * @param {(text:string, params:any[])=>Promise<any[]>} a.query
 * @param {{put:Function}} a.store
 * @param {object} a.spec            entry from ARCHIVED_TABLES
 * @param {boolean} a.prune          delete verified rows (cron, script --prune)
 * @param {number} a.maxRows         ceiling for this call
 * @param {number} [a.partRows]      rows per part object
 * @param {string} a.runId
 * @param {string} [a.cutoffIso]     fixed cutoff for the run (default: now - spec.days)
 * @param {Array}  [a.after]         [k_ts, ...k_pk] cursor for archive-only resume
 * @param {number} [a.deadlineMs]    epoch ms after which no new part starts
 */
export async function archiveSlice({
	query,
	store,
	spec,
	prune,
	maxRows,
	partRows = 20_000,
	runId,
	cutoffIso,
	after = null,
	deadlineMs = Infinity,
	pageRows = 2_500,
}) {
	const cutoff = cutoffIso || new Date(Date.now() - spec.days * 86_400_000).toISOString();
	const out = { table: spec.table, cutoff, archivedRows: 0, deletedRows: 0, parts: 0, cursor: after, skipped: null };
	let cursor = after;

	try {
		while (out.archivedRows < maxRows && Date.now() < deadlineMs) {
			const want = Math.min(partRows, maxRows - out.archivedRows);
			const lines = [];
			const keys = spec.pk.map(() => []);
			let first = null;
			let last = null;
			while (lines.length < want) {
				const take = Math.min(pageRows, want - lines.length);
				const useCursor = cursor != null;
				const params = useCursor ? [cutoff, ...cursor, take] : [cutoff, take];
				const rows = await query(buildSelect(spec, { withCursor: useCursor }), params);
				if (!rows.length) break;
				for (const r of rows) {
					lines.push(r.line);
					spec.pk.forEach((_, i) => keys[i].push(r[`k_${i}`]));
					const k = [r.k_ts, ...spec.pk.map((_, i) => r[`k_${i}`])];
					if (!first) first = k;
					last = k;
				}
				cursor = last;
				if (rows.length < take) break;
			}
			if (!lines.length) break;

			const raw = Buffer.from(lines.join('\n') + '\n');
			const gz = gzipSync(raw, { level: 6 });
			const stem = `${spec.table}/${first[0].slice(0, 10)}/${runId}-${String(out.parts).padStart(4, '0')}-${sha256(gz).slice(0, 8)}`;
			const partName = `${stem}.ndjson.gz`;
			const md5 = md5b64(gz);

			const meta = await store.put(partName, gz, 'application/gzip');
			if (meta?.md5Hash !== md5 || Number(meta?.size) !== gz.length) {
				throw new Error(`checksum mismatch after upload of ${partName}`);
			}
			const manifest = {
				table: spec.table,
				part: partName,
				cutoff,
				rows: lines.length,
				min_key: first,
				max_key: last,
				key_columns: ['ts', ...spec.pk.map((p) => p.col)],
				sha256: sha256(gz),
				md5: md5,
				bytes: gz.length,
				raw_bytes: raw.length,
				archived_at: new Date().toISOString(),
			};
			const mMeta = await store.put(`${stem}.manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
			if (!mMeta?.name) throw new Error(`manifest upload failed for ${partName}`);

			out.archivedRows += lines.length;
			out.parts += 1;
			out.cursor = last;

			if (prune) {
				const [{ n }] = await query(buildDelete(spec), [...keys, cutoff]);
				out.deletedRows += Number(n);
				await store
					.put(`${stem}.deleted.json`, Buffer.from(JSON.stringify({ part: partName, archived_rows: lines.length, deleted_rows: Number(n), deleted_at: new Date().toISOString() })), 'application/json')
					.catch((err) => {
						out.markerError = err.message;
					});
			}
			if (lines.length < want) break;
		}
	} catch (err) {
		out.skipped = err?.message || String(err);
	}
	return out;
}

/** Re-read every manifest for a table and check counts and hashes. */
export async function verifyTable({ store, table }) {
	const names = await store.list(`${table}/`);
	const manifests = names.filter((n) => n.endsWith('.manifest.json'));
	const deletedMarkers = new Set(names.filter((n) => n.endsWith('.deleted.json')));
	const report = { table, parts: 0, archivedRows: 0, deletedRows: 0, problems: [] };
	for (const mName of manifests) {
		const m = JSON.parse((await store.get(mName)).toString());
		report.parts += 1;
		report.archivedRows += m.rows;
		const gz = await store.get(m.part);
		if (sha256(gz) !== m.sha256) report.problems.push(`${m.part}: sha256 mismatch`);
		const lineCount = gunzipSync(gz).toString().split('\n').filter(Boolean).length;
		if (lineCount !== m.rows) report.problems.push(`${m.part}: ${lineCount} lines, manifest says ${m.rows}`);
		const dName = mName.replace(/\.manifest\.json$/, '.deleted.json');
		if (deletedMarkers.has(dName)) {
			const d = JSON.parse((await store.get(dName)).toString());
			report.deletedRows += d.deleted_rows;
		}
	}
	return report;
}

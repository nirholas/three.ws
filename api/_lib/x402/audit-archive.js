// Archive-before-delete retention for the x402 payment audit ledger.
//
// x402_audit_log is the money record. Pruning it after the retention window
// frees storage, but the rows cannot be regenerated, so a row is deleted ONLY
// after the batch that contains it has been written to object storage as gzip
// JSONL, read back, and verified (byte-identical body, matching row count).
// Any failure on that path (storage not configured, upload error, read-back
// mismatch) leaves the batch's rows in the table and stops the run; the next
// tick retries the same rows. Nothing is deleted on a hope.
//
// Object key: x402-audit-log/<YYYY-MM-DD of the batch's first row>/<hmac-24>.jsonl.gz
// The suffix is an HMAC of the content under a server secret. It makes the write
// idempotent (the same rows always map to the same key), stops a late-arriving
// row for an already archived day from overwriting its neighbours, and keeps the
// key unguessable: the bucket is served on a public domain and these rows carry
// payer addresses and request forensics, so the archive must not be enumerable.

import { createHmac } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sql } from '../db.js';
import { env } from '../env.js';
import {
	objectStorageConfigured,
	putObject,
	getObjectBuffer,
} from '../r2.js';

export const ARCHIVE_PREFIX = 'x402-audit-log';
export const ARCHIVE_BATCH = 5000;
export const ARCHIVE_MAX_BATCHES_PER_RUN = 20;

const defaultDeps = {
	sql,
	secret: () => env.JWT_SECRET,
	configured: objectStorageConfigured,
	put: putObject,
	get: getObjectBuffer,
};

/**
 * Serialise rows to the archive object: gzip JSONL, one row per line.
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} secret  server secret keying the unguessable key suffix
 * @returns {{ key: string, body: Buffer, jsonl: string }}
 */
export function buildArchiveObject(rows, secret) {
	const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
	const body = gzipSync(Buffer.from(jsonl, 'utf8'));
	const first = rows[0]?.created_at;
	const day = new Date(first ?? Date.now()).toISOString().slice(0, 10);
	const digest = createHmac('sha256', secret).update(jsonl).digest('hex').slice(0, 24);
	return { key: `${ARCHIVE_PREFIX}/${day}/${digest}.jsonl.gz`, body, jsonl };
}

/**
 * Write a batch to object storage and read it back. Resolves only when the
 * stored object decompresses to exactly the rows that were serialised.
 * @returns {Promise<string>} the verified object key
 */
export async function archiveBatch(rows, deps = defaultDeps) {
	const { key, body, jsonl } = buildArchiveObject(rows, deps.secret());
	await deps.put({
		key,
		body,
		contentType: 'application/gzip',
		metadata: { rows: String(rows.length), source: 'x402_audit_log' },
	});
	const stored = await deps.get(key);
	const text = gunzipSync(Buffer.from(stored)).toString('utf8');
	if (text !== jsonl) throw new Error(`archive verification failed for ${key}: stored body differs`);
	return key;
}

/**
 * Archive then delete audit rows older than `cutoffDays`, oldest first.
 *
 * @param {number} cutoffDays
 * @param {{ batch?: number, maxBatches?: number }} [opts]
 * @returns {Promise<{ deleted: number, archived: number, objects: string[], skipped?: string, error?: string }>}
 */
export async function archiveAndPruneAuditLog(cutoffDays, opts = {}, deps = defaultDeps) {
	const batch = opts.batch ?? ARCHIVE_BATCH;
	const maxBatches = opts.maxBatches ?? ARCHIVE_MAX_BATCHES_PER_RUN;
	const out = { deleted: 0, archived: 0, objects: [] };

	if (!deps.configured()) {
		return { ...out, skipped: 'archive_storage_unconfigured' };
	}

	for (let i = 0; i < maxBatches; i++) {
		const rows = await deps.sql`
			SELECT * FROM x402_audit_log
			WHERE created_at < now() - ${cutoffDays} * interval '1 day'
			ORDER BY created_at, id
			LIMIT ${batch}
		`;
		if (!rows.length) break;

		let key;
		try {
			key = await archiveBatch(rows, deps);
		} catch (err) {
			// Refuse to delete a batch that is not safely archived.
			return { ...out, error: `archive failed, rows kept: ${String(err?.message || err).slice(0, 200)}` };
		}
		out.archived += rows.length;
		out.objects.push(key);

		const ids = rows.map((r) => r.id);
		const del = await deps.sql`DELETE FROM x402_audit_log WHERE id = ANY(${ids}) RETURNING id`;
		out.deleted += del.length;
		if (rows.length < batch) break;
	}
	return out;
}

// GET /api/cron/forge-web-variants
//
// Steady-state backfill of the phone-sized delivery variant for meshes that
// were forged before it existed, or whose variant did not land at finish time.
//
// Every finished generation from 2026-09-04 onward gets its variant written
// right after materialization (buildWebVariant in api/_lib/forge-store.js). The
// meshes already in the bucket do not, and there are enough of them that a bulk
// rewrite of storage is the wrong tool: it would be one long unattended job
// re-uploading objects nobody has asked for. This drains the gap a bounded batch
// at a time, newest first, because the newest models are the ones actually being
// opened on a phone.
//
// Per row: read the stored original, run the delivery pass (meshopt geometry +
// WebP textures capped at 2048 px), write the result to a SECOND key, and record
// it. The original object is never touched, so a row that fails here is exactly
// as serveable as it was before, and the download action and every third-party
// API consumer keep the full-resolution mesh.
//
// A row whose variant would not actually be smaller is marked as attempted by
// pointing web_glb_key at the original key, which both keeps it out of the
// pending index and makes readers serve the original: `web_glb_url` stays null
// in that case and every reader already treats null as "serve glb_url". The
// same retirement ends a row that can never get a variant: a glb_key that is not
// a key in our bucket, or a model that failed MAX_ATTEMPTS times.
//
// Why a ledger (forge_web_variant_backfill, same shape as the thumbnail
// backfill's): until 2026-11-27 a failed row was left exactly as it was, still
// the newest, so the same rows were claimed and failed on every tick and nothing
// behind them ran. Production had 19,729 rows waiting and the head of the queue
// unchanged since 2026-11-15. Now:
//   - a model-attributable failure counts an attempt; the third one retires the
//     row to its original, so a broken mesh cannot hold the queue
//   - a storage outage counts nothing: a refused read keeps its lease, so the
//     row rotates out for LEASE_MINUTES and the rows behind it run; a refused
//     write stops the batch, because nothing else can be written either
//
// Originals are read like /cdn/ reads them (getPublicObjectBuffer): the signed
// read, the GCS fallback, then the public bucket domain. Model bytes are public
// anyway, and from 2026-11-15 the signed read was refused while the public
// domain still served every original written before the outage.
//
// Env:
//   CRON_SECRET                  required (Bearer)
//   FORGE_WEB_VARIANT_BATCH      meshes per tick (default 6, max 24)
//
// Sizing: the pass measured 0.6-5.6 s per mesh on real production output, plus
// the bucket read and write, so 6 lands well inside maxDuration=120 even on a
// bad batch.

import { json, wrapCron } from '../_lib/http.js';
import { logger } from '../_lib/usage.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql, isDbUnavailableError } from '../_lib/db.js';
import { getPublicObjectBuffer, objectStorageConfigured, keyFromPublicUrl, isStorageInfrastructureError } from '../_lib/r2.js';
import { forgeStoreEnabled, writeWebVariant } from '../_lib/forge-store.js';

export const maxDuration = 120;

const log = logger('forge-web-variants');

const BATCH = Math.max(1, Math.min(24, Number(process.env.FORGE_WEB_VARIANT_BATCH || 6)));
export const MAX_ATTEMPTS = 3;
// Longer than the 10-minute schedule, so a row a storage outage refused sits
// out a few ticks and the rows behind it get their turn.
export const LEASE_MINUTES = 60;

let schemaReady = false;

async function ensureSchema() {
	if (schemaReady) return;
	await sql`
		CREATE TABLE IF NOT EXISTS forge_web_variant_backfill (
			creation_id uuid        PRIMARY KEY REFERENCES forge_creations(id) ON DELETE CASCADE,
			attempts    int         NOT NULL DEFAULT 0,
			last_error  text,
			claimed_at  timestamptz,
			updated_at  timestamptz NOT NULL DEFAULT now(),
			created_at  timestamptz NOT NULL DEFAULT now()
		)
	`;
	schemaReady = true;
}

// Select and claim in one statement (FOR UPDATE ... SKIP LOCKED), so an
// overlapping tick never builds the same row twice. The claim counts the
// attempt up front; outcomes below release, keep or roll it back.
async function claimRows(limit) {
	await ensureSchema();
	return sql`
		WITH candidates AS (
			SELECT c.id, c.glb_key, c.size_bytes, c.updated_at
			  FROM forge_creations c
			  LEFT JOIN forge_web_variant_backfill b ON b.creation_id = c.id
			 WHERE c.status = 'done' AND c.glb_url IS NOT NULL AND c.glb_key IS NOT NULL AND c.web_glb_key IS NULL
			   AND (
			         b.creation_id IS NULL
			         OR (b.attempts < ${MAX_ATTEMPTS}
			             AND (b.claimed_at IS NULL
			                  OR b.claimed_at < now() - (${LEASE_MINUTES} * interval '1 minute')))
			       )
			 ORDER BY c.updated_at DESC
			 LIMIT ${limit}
			 FOR UPDATE OF c SKIP LOCKED
		), claimed AS (
			INSERT INTO forge_web_variant_backfill (creation_id, attempts, claimed_at, updated_at)
			SELECT id, 1, now(), now() FROM candidates
			ON CONFLICT (creation_id) DO UPDATE
				SET attempts   = forge_web_variant_backfill.attempts + 1,
				    claimed_at = now(),
				    updated_at = now()
			RETURNING creation_id
		)
		SELECT c.id, c.glb_key, c.size_bytes
		  FROM candidates c
		  JOIN claimed k ON k.creation_id = c.id
		 ORDER BY c.updated_at DESC
	`;
}

// The bucket key a stored glb_key names: a plain key, or an absolute URL on our
// own CDN or public bucket domain (older rows stored those). Anything else (a
// provider's or another bucket's URL) is not ours to read or to write next to.
export function bucketKeyFor(glbKey) {
	const value = String(glbKey || '');
	if (!value) return null;
	if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return value.includes('..') ? null : value;
	return keyFromPublicUrl(value);
}

async function retireToOriginal(row) {
	await sql`
		update forge_creations
		set web_glb_key = ${row.glb_key}, updated_at = now()
		where id = ${row.id} and web_glb_key is null
	`;
	await releaseClaim(row.id);
}

async function releaseClaim(id) {
	await sql`DELETE FROM forge_web_variant_backfill WHERE creation_id = ${id}`.catch(() => {});
}

// Model-attributable: keep the counted attempt and drop the lease so the next
// tick can retry. Answers the attempts used so far.
async function failClaim(id, message) {
	const [row] = await sql`
		UPDATE forge_web_variant_backfill
		   SET last_error = ${String(message || 'failed').slice(0, 500)}, claimed_at = NULL, updated_at = now()
		 WHERE creation_id = ${id}
		RETURNING attempts
	`;
	return row?.attempts ?? MAX_ATTEMPTS;
}

// Blameless (storage or database outage): give the attempt back. keepLease
// parks the row for LEASE_MINUTES so the queue moves past it.
async function rollbackClaim(id, message, keepLease) {
	await sql`
		UPDATE forge_web_variant_backfill
		   SET attempts   = GREATEST(attempts - 1, 0),
		       last_error = ${String(message || 'outage').slice(0, 500)},
		       claimed_at = CASE WHEN ${keepLease} THEN claimed_at ELSE NULL END,
		       updated_at = now()
		 WHERE creation_id = ${id}
	`.catch(() => {});
}

const blameless = (err) => isStorageInfrastructureError(err) || isDbUnavailableError(err);

export default wrapCron(async (req, res) => {
	if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
	if (!requireCron(req, res)) return;
	if (!forgeStoreEnabled()) return json(res, 200, { ok: false, reason: 'forge_store_disabled' });
	if (!objectStorageConfigured()) return json(res, 200, { ok: false, reason: 'object_storage_unconfigured' });

	let rows;
	try {
		rows = await claimRows(BATCH);
	} catch (err) {
		log.warn('claim_failed', { message: err?.message });
		return json(res, 200, { ok: false, reason: `claim_failed: ${err?.message}` });
	}

	if (!rows.length) return json(res, 200, { ok: true, processed: 0, remaining: 0, done: true });

	let built = 0;
	let skipped = 0;
	let retired = 0;
	let failed = 0;
	let deferred = 0;
	let aborted = null;
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (aborted) {
			await rollbackClaim(row.id, aborted, false);
			continue;
		}
		const key = bucketKeyFor(row.glb_key);
		if (!key) {
			await retireToOriginal(row);
			retired++;
			log.info('variant_retired_foreign_key', { creation_id: row.id });
			continue;
		}

		let buffer;
		try {
			buffer = await getPublicObjectBuffer(key);
		} catch (err) {
			if (blameless(err)) {
				await rollbackClaim(row.id, err?.message, true);
				deferred++;
				log.warn('variant_read_deferred', { creation_id: row.id, message: err?.message });
			} else {
				failed++;
				const attempts = await failClaim(row.id, err?.message);
				if (attempts >= MAX_ATTEMPTS) {
					await retireToOriginal(row);
					retired++;
				}
				log.warn('variant_read_failed', { creation_id: row.id, attempts, message: err?.message });
			}
			continue;
		}

		try {
			const result = await writeWebVariant({ buffer, creationId: row.id, keyPrefix: key.replace(/\.glb$/i, '') });
			if (result) {
				built++;
				await releaseClaim(row.id);
				log.info('variant_built', { creation_id: row.id, before: buffer.length, after: result.bytes });
			} else {
				// No gain (or too small to bother): serve the original.
				await retireToOriginal(row);
				skipped++;
			}
		} catch (err) {
			if (blameless(err)) {
				// Storage refused the write: every other row would be refused too.
				aborted = String(err?.message || 'storage_unavailable').slice(0, 200);
				await rollbackClaim(row.id, err?.message, false);
				log.warn('variant_write_refused', { creation_id: row.id, message: err?.message });
				continue;
			}
			failed++;
			const attempts = await failClaim(row.id, err?.message);
			if (attempts >= MAX_ATTEMPTS) {
				await retireToOriginal(row);
				retired++;
			}
			log.warn('variant_failed', { creation_id: row.id, attempts, message: err?.message });
		}
	}

	let remaining = null;
	try {
		const [{ n }] = await sql`
			select count(*)::int as n from forge_creations
			where status = 'done' and glb_url is not null and glb_key is not null and web_glb_key is null
		`;
		remaining = n;
	} catch {
		remaining = null;
	}

	return json(res, 200, { ok: true, processed: rows.length, built, skipped, retired, failed, deferred, aborted, remaining });
}, { maxDurationMs: maxDuration * 1000 });

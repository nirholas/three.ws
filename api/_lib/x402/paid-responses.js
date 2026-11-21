// api/_lib/x402/paid-responses.js
//
// The paid-response store: the full body of every x402 call the platform paid
// for, kept for our own accounting and so the data we bought can be used again.
//
// payX402 (./pay.js) calls recordPaidResponse after every PAID result and before
// it returns, so all 35+ pipelines that buy through it are covered with no
// per-pipeline wiring. Callers add context (pipeline, run, endpoint key, wallet
// kind, fresh wallet id) through payX402's `capture` option.
//
// Where a body lands, in order:
//   1. x402_paid_response_bodies (content-addressed by sha256, so the same
//      dataset bought twice is stored once) plus one x402_paid_responses receipt
//      row. Bodies over INLINE_MAX_BYTES go to object storage and the row keeps
//      the key; if that upload fails the body is stored inline anyway.
//   2. If the database write fails, the whole record is spooled to object
//      storage under SPOOL_PREFIX. `npm run x402:paid-data -- ingest-spool`
//      replays the spool into the tables.
//   3. If both fail, an error is logged with the tx signature and endpoint so the
//      purchase can be re-fetched by hand. This function never throws: a store
//      fault must not turn a settled payment into a crash.
//
// Schema: api/_lib/migrations/20261121120000_x402_paid_responses.sql.
// ensurePaidResponsesSchema mirrors it so a first write before the migration
// lands still works.

import { createHash } from 'node:crypto';

import { sql as defaultSql } from '../db.js';
import { logger } from '../usage.js';

const log = logger('x402-paid-responses');

export const INLINE_MAX_BYTES = 1_000_000;
export const BODY_PREFIX = 'x402-paid';
export const SPOOL_PREFIX = 'x402-paid-spool';
export const WALLET_KINDS = Object.freeze(['fresh', 'pool', 'seed', 'treasury', 'agent', 'shared', 'unknown']);

let _schemaReady = false;

/** Idempotent DDL guard mirroring the migration. Triggers are left to the migration. */
export async function ensurePaidResponsesSchema(sql = defaultSql) {
	if (_schemaReady) return;
	await sql`
		CREATE TABLE IF NOT EXISTS x402_paid_response_bodies (
			sha256         text PRIMARY KEY,
			bytes          integer NOT NULL,
			content_type   text NOT NULL DEFAULT 'application/json',
			body           jsonb,
			object_key     text,
			first_seen_at  timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT x402_paid_response_bodies_has_body CHECK (body IS NOT NULL OR object_key IS NOT NULL)
		)`;
	await sql`
		CREATE TABLE IF NOT EXISTS x402_paid_responses (
			id               bigserial PRIMARY KEY,
			created_at       timestamptz NOT NULL DEFAULT now(),
			tx_sig           text UNIQUE,
			pipeline         text NOT NULL,
			endpoint_key     text,
			url              text NOT NULL,
			endpoint_path    text NOT NULL,
			method           text NOT NULL,
			request_body     jsonb,
			status           integer NOT NULL,
			payer            text,
			wallet_kind      text NOT NULL DEFAULT 'unknown',
			fresh_wallet_id  bigint,
			amount_atomic    bigint NOT NULL DEFAULT 0,
			asset            text,
			network          text NOT NULL DEFAULT 'solana:mainnet',
			body_sha256      text NOT NULL REFERENCES x402_paid_response_bodies (sha256),
			bytes            integer NOT NULL,
			run_id           text,
			duration_ms      integer
		)`;
	await sql`CREATE INDEX IF NOT EXISTS x402_paid_responses_created ON x402_paid_responses (created_at DESC)`;
	await sql`CREATE INDEX IF NOT EXISTS x402_paid_responses_endpoint ON x402_paid_responses (endpoint_path, created_at DESC)`;
	await sql`CREATE INDEX IF NOT EXISTS x402_paid_responses_payer ON x402_paid_responses (payer)`;
	_schemaReady = true;
}

/** Test hook: forget that the schema was ensured (each PGlite test starts empty). */
export function resetPaidResponsesSchemaCache() {
	_schemaReady = false;
}

// Postgres jsonb refuses the \u0000 escape. A NUL never carries meaning in a
// response body, so it is dropped from the canonical text before hashing.
function canonicalBody(body) {
	const isText = typeof body === 'string';
	let text;
	try {
		text = JSON.stringify(body === undefined ? null : body);
	} catch {
		text = JSON.stringify(String(body));
	}
	return { text: text.replace(/\\u0000/g, ''), contentType: isText ? 'text/plain' : 'application/json' };
}

function endpointPathOf(url) {
	try {
		return new URL(url).pathname || '/';
	} catch {
		return String(url || '').split('?')[0] || '/';
	}
}

function asJsonParam(value) {
	if (value == null) return null;
	if (typeof value === 'string') {
		try { JSON.parse(value); return value.replace(/\\u0000/g, ''); } catch { return JSON.stringify(value); }
	}
	try { return JSON.stringify(value).replace(/\\u0000/g, ''); } catch { return null; }
}

function normalizeKind(kind) {
	return WALLET_KINDS.includes(kind) ? kind : 'unknown';
}

/**
 * Build the record for one paid call. Pure: no I/O.
 * @returns {object|null} null when the result was not paid.
 */
export function buildPaidRecord({ url, method = 'POST', requestBody = null, result, payer = null, asset = null, network = null, durationMs = null, context = {} }) {
	if (!result || result.paid !== true) return null;
	const { text, contentType } = canonicalBody(result.responseBody);
	const sha256 = createHash('sha256').update(text).digest('hex');
	return {
		txSig: result.txSig || null,
		pipeline: String(context.pipeline || 'unattributed'),
		endpointKey: context.endpointKey ? String(context.endpointKey) : null,
		url: String(url),
		endpointPath: endpointPathOf(url),
		method: String(method || 'POST').toUpperCase(),
		requestBody: asJsonParam(requestBody),
		status: Number(result.status) || 0,
		payer: payer || null,
		walletKind: normalizeKind(context.walletKind),
		freshWalletId: context.freshWalletId != null ? Number(context.freshWalletId) : null,
		amountAtomic: Number(result.amountAtomic) || 0,
		asset: asset || null,
		network: network || 'solana:mainnet',
		runId: context.runId ? String(context.runId) : null,
		durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
		sha256,
		bytes: Buffer.byteLength(text, 'utf8'),
		contentType,
		bodyText: text,
	};
}

async function defaultPut(args) {
	const { putObject } = await import('../r2.js');
	return putObject(args);
}

async function defaultStorageConfigured() {
	const { objectStorageConfigured } = await import('../r2.js');
	return objectStorageConfigured();
}

async function writeRecord(sql, rec, put) {
	await ensurePaidResponsesSchema(sql);
	let inline = rec.bodyText;
	let objectKey = null;
	if (rec.bytes > INLINE_MAX_BYTES) {
		const key = `${BODY_PREFIX}/${rec.sha256.slice(0, 2)}/${rec.sha256}.json`;
		try {
			await put({ key, body: rec.bodyText, contentType: 'application/json', metadata: { sha256: rec.sha256 } });
			objectKey = key;
			inline = null;
		} catch (err) {
			log.warn('paid_response_object_put_failed', { sha256: rec.sha256, bytes: rec.bytes, message: err?.message });
		}
	}
	await sql`
		INSERT INTO x402_paid_response_bodies (sha256, bytes, content_type, body, object_key)
		VALUES (${rec.sha256}, ${rec.bytes}, ${rec.contentType}, ${inline}::jsonb, ${objectKey})
		ON CONFLICT (sha256) DO NOTHING`;
	const rows = await sql`
		INSERT INTO x402_paid_responses
			(tx_sig, pipeline, endpoint_key, url, endpoint_path, method, request_body, status,
			 payer, wallet_kind, fresh_wallet_id, amount_atomic, asset, network,
			 body_sha256, bytes, run_id, duration_ms)
		VALUES
			(${rec.txSig}, ${rec.pipeline}, ${rec.endpointKey}, ${rec.url}, ${rec.endpointPath}, ${rec.method},
			 ${rec.requestBody}::jsonb, ${rec.status}, ${rec.payer}, ${rec.walletKind}, ${rec.freshWalletId},
			 ${rec.amountAtomic}, ${rec.asset}, ${rec.network}, ${rec.sha256}, ${rec.bytes}, ${rec.runId}, ${rec.durationMs})
		ON CONFLICT (tx_sig) DO NOTHING
		RETURNING id`;
	if (rows[0]?.id != null) return { id: Number(rows[0].id), duplicate: false };
	return { id: null, duplicate: true };
}

/**
 * Store one paid response. Never throws.
 * @returns {Promise<{ stored: boolean, where?: 'db'|'spool', id?: number|null, sha256?: string, duplicate?: boolean, reason?: string }>}
 */
export async function recordPaidResponse({
	sql = null, url, method, requestBody, result, payer, asset, network, durationMs, context = {},
	put = defaultPut, storageConfigured = defaultStorageConfigured,
}) {
	const rec = buildPaidRecord({ url, method, requestBody, result, payer, asset, network, durationMs, context });
	if (!rec) return { stored: false, reason: 'not_paid' };
	const db = sql || defaultSql;
	const haveDb = Boolean(sql) || Boolean(process.env.DATABASE_URL);

	let dbError = null;
	if (haveDb) {
		try {
			const out = await writeRecord(db, rec, put);
			return { stored: true, where: 'db', id: out.id, sha256: rec.sha256, duplicate: out.duplicate };
		} catch (err) {
			dbError = err;
			log.warn('paid_response_db_write_failed', { tx: rec.txSig, endpoint: rec.endpointPath, message: err?.message });
		}
	}

	let canSpool = false;
	try { canSpool = await storageConfigured(); } catch { canSpool = false; }
	if (canSpool) {
		const day = new Date().toISOString().slice(0, 10);
		const key = `${SPOOL_PREFIX}/${day}/${rec.txSig || rec.sha256}-${Date.now()}.json`;
		try {
			const { bodyText, ...meta } = rec;
			await put({ key, body: JSON.stringify({ v: 1, record: meta, body: bodyText }), contentType: 'application/json', metadata: { sha256: rec.sha256 } });
			return { stored: true, where: 'spool', key, sha256: rec.sha256 };
		} catch (err) {
			log.error('paid_response_spool_failed', { tx: rec.txSig, endpoint: rec.endpointPath, message: err?.message });
		}
	}

	if (haveDb || canSpool) {
		log.error('paid_response_unstored', { tx: rec.txSig, endpoint: rec.endpointPath, payer: rec.payer, amount_atomic: rec.amountAtomic, db_error: dbError?.message || null });
	}
	return { stored: false, reason: haveDb || canSpool ? 'store_failed' : 'no_store_configured', sha256: rec.sha256 };
}

/**
 * Replay one spooled envelope (as written by recordPaidResponse) into the tables.
 * Throws on a malformed envelope or a database fault so the caller keeps the spool object.
 */
export async function ingestSpoolEnvelope({ sql = defaultSql, envelope, put = defaultPut }) {
	if (!envelope || envelope.v !== 1 || !envelope.record || typeof envelope.body !== 'string') {
		throw new Error('spool envelope is malformed');
	}
	const sha256 = createHash('sha256').update(envelope.body).digest('hex');
	if (sha256 !== envelope.record.sha256) throw new Error('spool envelope body does not match its sha256');
	const rec = { ...envelope.record, bodyText: envelope.body };
	return writeRecord(sql, rec, put);
}

// Every spool key in both stores. While R2 refuses the credential the spool lands
// in the GCS fallback bucket, which R2's lister cannot see, so both are listed
// and an outage of either one only hides that store's half.
async function defaultSpoolList(prefix, max) {
	const keys = new Set();
	const errors = [];
	const { listObjectsPage } = await import('../r2.js');
	const { fallbackBucket, fallbackList } = await import('../storage-fallback.js');
	const sources = [
		async (token) => { const p = await listObjectsPage({ prefix, continuationToken: token || undefined }); return { objects: p.objects, next: p.nextToken || null }; },
	];
	if (fallbackBucket()) sources.push(async (token) => { const p = await fallbackList({ prefix, pageToken: token }); return { objects: p.objects, next: p.nextToken }; });
	for (const page of sources) {
		let token = null;
		try {
			do {
				const { objects, next } = await page(token);
				for (const o of objects) keys.add(o.key);
				token = next;
			} while (token && keys.size < max);
		} catch (err) {
			errors.push(err?.message || String(err));
		}
	}
	return { keys: [...keys].sort().slice(0, max), errors };
}

/**
 * Replay the spool into the tables: every envelope recordPaidResponse wrote
 * while the database refused it. A spool object is deleted only after its
 * record is confirmed in the database; a malformed or tampered envelope is kept
 * and reported so nothing paid for is thrown away.
 *
 * @returns {Promise<{ listed: number, ingested: number, duplicates: number, failed: Array<{ key: string, error: string }>, list_errors: string[] }>}
 */
export async function drainPaidSpool({ sql = defaultSql, limit = 500, list = defaultSpoolList, get = null, del = null, put = defaultPut } = {}) {
	const getObject = get || (async (key) => (await import('../r2.js')).getObjectBuffer(key));
	const deleteObj = del || (async (key) => (await import('../r2.js')).deleteObject(key));
	const { keys, errors } = await list(`${SPOOL_PREFIX}/`, limit);
	const out = { listed: keys.length, ingested: 0, duplicates: 0, failed: [], list_errors: errors };
	for (const key of keys) {
		try {
			const envelope = JSON.parse(Buffer.from(await getObject(key)).toString('utf8'));
			const res = await ingestSpoolEnvelope({ sql, envelope, put });
			if (res.duplicate) out.duplicates += 1;
			else out.ingested += 1;
			const { sha256, txSig } = envelope.record;
			const [row] = txSig
				? await sql`SELECT 1 AS ok FROM x402_paid_responses WHERE tx_sig = ${txSig}`
				: await sql`SELECT 1 AS ok FROM x402_paid_responses WHERE body_sha256 = ${sha256} LIMIT 1`;
			if (!row) throw new Error('record not visible after ingest');
			await deleteObj(key);
		} catch (err) {
			out.failed.push({ key, error: String(err?.message || err).slice(0, 200) });
		}
	}
	return out;
}

/** Load a stored body by its sha256, from inline jsonb or object storage. */
export async function loadPaidBody({ sql = defaultSql, sha256, getObject = null }) {
	const rows = await sql`SELECT body, object_key FROM x402_paid_response_bodies WHERE sha256 = ${sha256}`;
	const row = rows[0];
	if (!row) return undefined;
	if (row.body !== null && row.body !== undefined) return typeof row.body === 'string' ? JSON.parse(row.body) : row.body;
	const fetchObject = getObject || (async (key) => (await import('../r2.js')).getObjectBuffer(key));
	const buf = await fetchObject(row.object_key);
	return JSON.parse(Buffer.from(buf).toString('utf8'));
}

/**
 * Per-endpoint rollup of what was bought: calls, spend, distinct payers, distinct
 * bodies (how much of the data was actually new) and the latest purchase.
 */
export async function paidDataSummary({ sql = defaultSql, sinceIso = null } = {}) {
	const since = sinceIso || '1970-01-01T00:00:00Z';
	return sql`
		SELECT endpoint_path,
		       count(*)::int                  AS calls,
		       sum(amount_atomic)::bigint     AS spent_atomic,
		       count(DISTINCT payer)::int     AS payers,
		       count(DISTINCT body_sha256)::int AS distinct_bodies,
		       sum(bytes)::bigint             AS bytes,
		       max(created_at)                AS last_at
		  FROM x402_paid_responses
		 WHERE created_at >= ${since}::timestamptz
		 GROUP BY endpoint_path
		 ORDER BY calls DESC`;
}

/**
 * Per-wallet accounting: for every payer, what it paid, how many responses it
 * bought, and for fresh wallets what was funded and returned. One wallet per
 * transaction is the point of the fresh lane, so this is the ledger view of it.
 */
export async function walletAccounting({ sql = defaultSql, sinceIso = null, untilIso = null } = {}) {
	const since = sinceIso || '1970-01-01T00:00:00Z';
	const until = untilIso || '9999-12-31T00:00:00Z';
	return sql`
		WITH paid AS (
			SELECT payer, wallet_kind,
			       count(*)::int              AS responses,
			       sum(amount_atomic)::bigint AS paid_atomic,
			       sum(bytes)::bigint         AS bytes,
			       min(created_at)            AS first_at,
			       max(created_at)            AS last_at,
			       array_agg(DISTINCT endpoint_path) AS endpoints
			  FROM x402_paid_responses
			 WHERE created_at >= ${since}::timestamptz AND created_at < ${until}::timestamptz
			 GROUP BY payer, wallet_kind
		)
		SELECT p.payer, p.wallet_kind, p.responses, p.paid_atomic, p.bytes, p.first_at, p.last_at, p.endpoints,
		       f.id                      AS fresh_wallet_id,
		       f.state                   AS fresh_state,
		       f.usdc_funded_atomic      AS usdc_funded_atomic,
		       f.usdc_returned_atomic    AS usdc_returned_atomic,
		       f.sol_funded_lamports     AS sol_funded_lamports,
		       f.sol_reclaimed_lamports  AS sol_reclaimed_lamports,
		       f.rent_reclaimed_lamports AS rent_reclaimed_lamports,
		       f.fund_sig, f.pay_sig, f.sweep_sig
		  FROM paid p
		  LEFT JOIN x402_fresh_wallets f ON f.pubkey = p.payer
		 ORDER BY p.last_at DESC`;
}

/**
 * One page of receipts with their bodies, oldest first, for exports and reuse of
 * the bought data. Page with `afterId` (the last row's id). Bodies stored in
 * object storage are fetched; a body that cannot be loaded comes back as null
 * with `body_error` set rather than failing the page.
 */
export async function listPaidResponses({ sql = defaultSql, endpoint = null, pipeline = null, sinceIso = null, afterId = 0, limit = 500, withBodies = true, getObject = null } = {}) {
	const since = sinceIso || '1970-01-01T00:00:00Z';
	const n = Math.max(1, Math.min(5000, Number(limit) || 500));
	const rows = await sql`
		SELECT r.id, r.created_at, r.tx_sig, r.pipeline, r.endpoint_key, r.url, r.endpoint_path, r.method,
		       r.request_body, r.status, r.payer, r.wallet_kind, r.fresh_wallet_id, r.amount_atomic::text AS amount_atomic,
		       r.asset, r.network, r.body_sha256, r.bytes, r.run_id, r.duration_ms
		  FROM x402_paid_responses r
		 WHERE r.id > ${afterId}
		   AND r.created_at >= ${since}::timestamptz
		   AND (${endpoint}::text IS NULL OR r.endpoint_path = ${endpoint} OR r.endpoint_key = ${endpoint})
		   AND (${pipeline}::text IS NULL OR r.pipeline = ${pipeline})
		 ORDER BY r.id
		 LIMIT ${n}`;
	if (!withBodies) return rows.map((r) => ({ ...r, id: Number(r.id) }));
	const out = [];
	for (const r of rows) {
		const row = { ...r, id: Number(r.id) };
		try {
			row.body = await loadPaidBody({ sql, sha256: r.body_sha256, getObject }) ?? null;
		} catch (err) {
			row.body = null;
			row.body_error = String(err?.message || err).slice(0, 200);
		}
		out.push(row);
	}
	return out;
}

// Google Cloud Storage fallback for the primary object store (Cloudflare R2).
//
// Why it exists: on 2026-11-14 ~17:23 UTC Cloudflare stopped accepting every R2
// credential the platform holds (both access key pairs answered a bare 401
// Unauthorized), and every finished 3D generation died in materializeCreation
// because putObject() had nowhere else to put the GLB. The GPU workers kept
// producing meshes; the platform kept throwing them away. R2 is a single
// third-party dependency with a single credential, so a credential event on
// Cloudflare's side must not be able to stop generation.
//
// How it works: when STORAGE_FALLBACK_BUCKET names a GCS bucket, the r2.js
// helpers divert a write R2 refuses for an INFRASTRUCTURE reason (see
// isStorageInfrastructureError) into this bucket under the same key, and every
// read helper looks here when R2 cannot answer or does not have the key. The
// key namespace is shared, so every URL already handed out (/cdn/<key>) keeps
// resolving no matter which store holds the bytes. Once R2 is healthy again,
// `node scripts/storage-fallback-backfill.mjs` copies the diverted objects back.
//
// The bucket is PRIVATE and read only through the /cdn proxy with the runtime
// service account's token, so there is no public edge cache to serve a stale
// copy and no second public namespace to police.
//
// It speaks the GCS XML API (storage.googleapis.com/<bucket>/<object>) because
// that API carries custom metadata, Range, HEAD and server-side copy as plain
// headers, which is the S3 shape the callers already expect. Auth is the shared
// token minter (metadata server on Cloud Run, ADC on a developer box), so there
// is no SDK dependency and no key on disk.

import { createHash, createSign } from 'node:crypto';
import { Transform } from 'node:stream';
import { getGcpAccessToken, parseServiceAccount } from './gcp-auth.js';

const GCS_XML = 'https://storage.googleapis.com';
const TIMEOUT_MS = 30_000;

/** The configured fallback bucket name, or null when the failover is off. */
export function fallbackBucket() {
	const name = String(process.env.STORAGE_FALLBACK_BUCKET ?? '').trim();
	return name || null;
}

function objectUrl(bucket, key) {
	return `${GCS_XML}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function call(method, key, { headers = {}, body, duplex } = {}) {
	const bucket = fallbackBucket();
	if (!bucket) throw new Error('storage fallback bucket is not configured');
	const token = await getGcpAccessToken();
	return fetch(objectUrl(bucket, key), {
		method,
		headers: { authorization: `Bearer ${token}`, ...headers },
		body,
		// A streamed request body must declare half duplex in Node's fetch.
		...(duplex ? { duplex } : {}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
}

async function failure(res, op, key) {
	const text = await res.text().catch(() => '');
	const err = new Error(`gcs fallback ${op} ${res.status} for ${key}: ${text.slice(0, 160)}`);
	err.status = res.status;
	return err;
}

function metadataFrom(headers) {
	const out = {};
	headers.forEach((value, name) => {
		if (name.toLowerCase().startsWith('x-goog-meta-')) out[name.slice('x-goog-meta-'.length).toLowerCase()] = value;
	});
	return out;
}

/** Store an object, overwriting any previous copy under the same key. */
export async function fallbackPut({ key, body, contentType, metadata = {} }) {
	const headers = { 'content-type': contentType || 'application/octet-stream' };
	for (const [k, v] of Object.entries(metadata || {})) {
		if (v != null) headers[`x-goog-meta-${k.toLowerCase()}`] = String(v);
	}
	const payload = Buffer.isBuffer(body) || body instanceof Uint8Array || typeof body === 'string' ? body : Buffer.from(await new Response(body).arrayBuffer());
	const res = await call('PUT', key, { headers, body: payload });
	if (!res.ok) throw await failure(res, 'put', key);
}

/**
 * Conditional put for compare-and-swap state, GCS's spelling of S3's
 * If-None-Match / If-Match: `ifGenerationMatch` '0' creates only when the key
 * is absent, a generation replaces only that version, and null writes
 * unconditionally. Returns the new generation, or null when the precondition
 * lost the race.
 */
export async function fallbackPutIfGeneration({ key, body, contentType, ifGenerationMatch = null }) {
	const headers = { 'content-type': contentType || 'application/octet-stream' };
	if (ifGenerationMatch != null) headers['x-goog-if-generation-match'] = String(ifGenerationMatch);
	const res = await call('PUT', key, { headers, body });
	if (res.status === 412) {
		await res.body?.cancel?.();
		return null;
	}
	if (!res.ok) throw await failure(res, 'put', key);
	await res.body?.cancel?.();
	return res.headers.get('x-goog-generation');
}

/** Server-side copy inside the fallback bucket. Returns false when the source is absent. */
export async function fallbackCopy({ fromKey, toKey }) {
	const bucket = fallbackBucket();
	const source = `/${bucket}/${fromKey.split('/').map(encodeURIComponent).join('/')}`;
	const res = await call('PUT', toKey, { headers: { 'x-goog-copy-source': source } });
	if (res.status === 404) return false;
	if (!res.ok) throw await failure(res, 'copy', toKey);
	return true;
}

/**
 * The raw fetch Response for an object (optionally a byte range), for callers
 * that stream it. Null when the key is absent.
 */
export async function fallbackFetch(key, { range, method = 'GET' } = {}) {
	const res = await call(method, key, { headers: range ? { range } : {} });
	if (res.status === 404) {
		await res.body?.cancel?.();
		return null;
	}
	if (!res.ok && res.status !== 206) throw await failure(res, method.toLowerCase(), key);
	return res;
}

/** Whole object (or range) as a Buffer plus its stored type and metadata, or null. */
export async function fallbackGet(key, { range } = {}) {
	const res = await fallbackFetch(key, { range });
	if (!res) return null;
	return {
		body: Buffer.from(await res.arrayBuffer()),
		contentType: res.headers.get('content-type'),
		metadata: metadataFrom(res.headers),
		etag: res.headers.get('etag'),
		generation: res.headers.get('x-goog-generation'),
	};
}

/** HEAD in the S3 SDK's shape (ContentLength, ContentType, ETag, LastModified, Metadata), or null. */
export async function fallbackHead(key) {
	const res = await fallbackFetch(key, { method: 'HEAD' });
	if (!res) return null;
	const lastModified = res.headers.get('last-modified');
	return {
		ContentLength: Number(res.headers.get('content-length') ?? 0),
		ContentType: res.headers.get('content-type') || undefined,
		ETag: res.headers.get('etag') || undefined,
		LastModified: lastModified ? new Date(lastModified) : undefined,
		Metadata: metadataFrom(res.headers),
	};
}

/**
 * One page of keys under `prefix`, in the S3 lister's shape
 * ({ objects: [{ key, size, lastModified }], nextToken }). Uses the GCS JSON
 * API, since the XML endpoint above has no listing for a single prefix page.
 */
export async function fallbackList({ prefix, pageToken = null, maxKeys = 1000 }) {
	const bucket = fallbackBucket();
	if (!bucket) throw new Error('storage fallback bucket is not configured');
	const qs = new URLSearchParams({ prefix, maxResults: String(Math.max(1, Math.min(1000, maxKeys))), fields: 'items(name,size,updated),nextPageToken' });
	if (pageToken) qs.set('pageToken', pageToken);
	const token = await getGcpAccessToken();
	const res = await fetch(`${GCS_XML}/storage/v1/b/${encodeURIComponent(bucket)}/o?${qs}`, {
		headers: { authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) throw await failure(res, 'list', prefix);
	const data = await res.json();
	return {
		objects: (data.items || []).map((o) => ({ key: o.name, size: Number(o.size || 0), lastModified: o.updated ? new Date(o.updated) : null })),
		nextToken: data.nextPageToken || null,
	};
}

/** Delete an object; absent is success. Returns whether a copy existed. */
export async function fallbackDelete(key) {
	const res = await call('DELETE', key);
	if (res.ok) return true;
	if (res.status === 404) return false;
	throw await failure(res, 'delete', key);
}

// One warning per key per process, so an outage logs what it diverted without
// flooding the log on every retry of the same object.
const warned = new Set();
export function noteFallback(op, key, err) {
	const tag = `${op}:${key}`;
	if (warned.has(tag)) return;
	if (warned.size > 5000) warned.clear();
	warned.add(tag);
	console.warn(`[storage-fallback] ${op} ${key} served by GCS fallback (R2: ${err?.name || 'error'}: ${String(err?.message || err).slice(0, 120)})`);
}

// ── Copy-on-read from the R2 public domain ──────────────────────────────────
// Objects written BEFORE R2 started refusing our credential live in R2 only, so
// while the outage lasts the read helpers can serve them solely by streaming
// the bucket's rate-limited r2.dev domain. Measured 2026-11-25 that was 5000+
// reads a day, about 20 of which timed out after 20s and answered 502, and every
// object paid that hop again on each edge-cache miss. mirrorWhileServing() tees
// such a read: the caller serves one branch while the other is written into the
// fallback bucket under the same key, so the next read is the in-region GCS rung.
// The backfill skips a key R2 already holds at the same size, so a mirrored copy
// never travels back, and --delete-after clears it once R2 verifies.

export const MIRROR_MAX_BYTES = 64 * 1024 * 1024;
// How long a response may hold its final end for the copy to commit. Cloud Run
// throttles CPU once a response completes, so a copy left running after it can
// stall until the 30s upload timeout drops it (an uncommitted PUT leaves no
// object behind, so the worst case is a copy that did not happen).
export const MIRROR_HOLD_MS = 5_000;
const mirroring = new Set();

/**
 * Serve a public-domain read and copy it into the fallback bucket on the way.
 * Only a complete (200), uncompressed body under the size cap is copied: a
 * range is a fragment, and a decoded body no longer matches its length header.
 * One copy per key per process at a time.
 *
 * @param {string} key  the bucket key the bytes belong to
 * @param {Response} upstream  the public-domain response, body unread
 * @param {{ maxBytes?: number }} [opts]
 * @returns {{ body: ReadableStream | null, settled: Promise<boolean> }} the stream
 *   to serve, and a promise that resolves true once the copy committed or false
 *   when it was skipped or failed. It never rejects.
 */
export function mirrorWhileServing(key, upstream, { maxBytes = MIRROR_MAX_BYTES } = {}) {
	const skip = { body: upstream.body, settled: Promise.resolve(false) };
	if (!fallbackBucket() || !upstream.body || upstream.status !== 200) return skip;
	if (upstream.headers.get('content-encoding')) return skip;
	const length = Number(upstream.headers.get('content-length'));
	if (!Number.isFinite(length) || length <= 0 || length > maxBytes) return skip;
	if (mirroring.has(key)) return skip;
	mirroring.add(key);
	const [body, copy] = upstream.body.tee();
	const settled = (async () => {
		try {
			const res = await call('PUT', key, {
				headers: {
					'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
					'content-length': String(length),
					'x-goog-meta-mirrored-from': 'r2-public-domain',
				},
				body: copy,
				duplex: 'half',
			});
			if (!res.ok) throw await failure(res, 'mirror', key);
			await res.body?.cancel?.();
			return true;
		} catch (err) {
			// Release the copy branch so the tee stops buffering for it; the
			// client branch is unaffected.
			await copy.cancel().catch(() => {});
			console.warn(`[storage-fallback] mirror of ${key} into the fallback bucket failed: ${String(err?.message || err).slice(0, 200)}`);
			return false;
		} finally {
			mirroring.delete(key);
		}
	})();
	return { body, settled };
}

/**
 * Wait for a mirror to settle, at most `maxMs`. For a caller that buffers the
 * bytes and writes the response in one go.
 * @param {Promise<unknown>} settled
 * @param {number} [maxMs]
 * @returns {Promise<void>}
 */
export function mirrorSettledWithin(settled, maxMs = MIRROR_HOLD_MS) {
	let timer;
	const bound = new Promise((resolve) => {
		timer = setTimeout(resolve, maxMs);
		timer.unref?.();
	});
	return Promise.race([settled, bound]).then(
		() => clearTimeout(timer),
		() => clearTimeout(timer),
	);
}

/**
 * A pass-through stream that holds its end until `settled` resolves, at most
 * `maxMs`. Placed before the response in a pipeline, it keeps the response open
 * (and the instance's CPU allocated) while a mirror commits.
 * @param {Promise<unknown>} settled
 * @param {number} [maxMs]
 */
export function holdEndUntil(settled, maxMs = MIRROR_HOLD_MS) {
	return new Transform({
		transform(chunk, _enc, cb) {
			cb(null, chunk);
		},
		flush(cb) {
			mirrorSettledWithin(settled, maxMs).then(() => cb());
		},
	});
}

// ── Presigned browser uploads ───────────────────────────────────────────────
// A browser upload never passes through us: the endpoint hands the page a
// signed PUT URL. While R2 refuses our credential an R2-signed URL answers 401,
// so presignUpload() (r2.js) signs a GCS V4 URL for the same key instead and
// the object lands where every read helper and /cdn/ already look.
//
// Two signers, in order: the service-account key in GCP_SERVICE_ACCOUNT_JSON
// (signs locally, no network), then the runtime identity through the IAM
// Credentials signBlob API (Cloud Run's service account holds Token Creator on
// itself). Either identity needs object write on the fallback bucket.

const METADATA_EMAIL_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email';
let _runtimeEmail = null;

// RFC 3986 unreserved characters only: GCS rebuilds the canonical request with
// this exact encoding, and encodeURIComponent leaves !'()* bare.
function strictEncode(value) {
	return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function configuredServiceAccount() {
	const raw = String(process.env.GCP_SERVICE_ACCOUNT_JSON ?? '').trim();
	if (!raw) return null;
	return parseServiceAccount(raw);
}

async function runtimeServiceAccountEmail() {
	if (_runtimeEmail) return _runtimeEmail;
	const res = await fetch(METADATA_EMAIL_URL, {
		headers: { 'metadata-flavor': 'Google' },
		signal: AbortSignal.timeout(2_000),
	});
	if (!res.ok) throw new Error(`metadata server answered ${res.status} for the service account email`);
	_runtimeEmail = (await res.text()).trim();
	return _runtimeEmail;
}

async function resolveSigner() {
	const sa = configuredServiceAccount();
	if (sa) {
		return {
			email: sa.client_email,
			sign: async (text) => createSign('RSA-SHA256').update(text).sign(sa.private_key, 'hex'),
		};
	}
	const email = await runtimeServiceAccountEmail();
	return {
		email,
		sign: async (text) => {
			const token = await getGcpAccessToken();
			const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:signBlob`, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({ payload: Buffer.from(text).toString('base64') }),
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new Error(`signBlob ${res.status} for ${email}: ${body.slice(0, 160)}`);
			}
			const { signedBlob } = await res.json();
			return Buffer.from(signedBlob, 'base64').toString('hex');
		},
	};
}

/**
 * Whether this runtime can sign a fallback upload URL at all (a usable key, or
 * a metadata server to name the runtime identity). Cached once it succeeds.
 * @returns {Promise<boolean>}
 */
export async function fallbackCanPresign() {
	if (!fallbackBucket()) return false;
	try {
		await resolveSigner();
		return true;
	} catch {
		return false;
	}
}

/**
 * A GCS V4 signed URL the browser can PUT one object to, signed over
 * content-type and host so the upload must declare the type it was minted for.
 * @param {{ key: string, contentType: string, expiresIn?: number, now?: Date }} opts
 * @returns {Promise<string>}
 */
export async function fallbackPresignPut({ key, contentType, expiresIn = 300, now = new Date() }) {
	const bucket = fallbackBucket();
	if (!bucket) throw new Error('storage fallback bucket is not configured');
	const signer = await resolveSigner();
	const host = 'storage.googleapis.com';
	const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
	const scope = `${stamp.slice(0, 8)}/auto/storage/goog4_request`;
	const path = `/${bucket}/${key.split('/').map(strictEncode).join('/')}`;
	const query = {
		'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
		'X-Goog-Credential': `${signer.email}/${scope}`,
		'X-Goog-Date': stamp,
		'X-Goog-Expires': String(expiresIn),
		'X-Goog-SignedHeaders': 'content-type;host',
	};
	const canonicalQuery = Object.keys(query)
		.sort()
		.map((k) => `${strictEncode(k)}=${strictEncode(query[k])}`)
		.join('&');
	const canonicalRequest = [
		'PUT',
		path,
		canonicalQuery,
		`content-type:${String(contentType).trim()}`,
		`host:${host}`,
		'',
		'content-type;host',
		'UNSIGNED-PAYLOAD',
	].join('\n');
	const stringToSign = ['GOOG4-RSA-SHA256', stamp, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
	const signature = await signer.sign(stringToSign);
	return `https://${host}${path}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

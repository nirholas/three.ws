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

import { getGcpAccessToken } from './gcp-auth.js';

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

async function call(method, key, { headers = {}, body } = {}) {
	const bucket = fallbackBucket();
	if (!bucket) throw new Error('storage fallback bucket is not configured');
	const token = await getGcpAccessToken();
	return fetch(objectUrl(bucket, key), {
		method,
		headers: { authorization: `Bearer ${token}`, ...headers },
		body,
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

/** Delete an object; absent is success. */
export async function fallbackDelete(key) {
	const res = await call('DELETE', key);
	if (res.ok || res.status === 404) return;
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

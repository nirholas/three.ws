// S3-compatible storage client (works with AWS S3, Cloudflare R2, Backblaze B2, etc.)

import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
	CopyObjectCommand,
	ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

// Lazy client — S3Client constructor reads env credentials eagerly, so defer
// until first use to keep this module importable without storage configured.
let _r2;
function getR2() {
	if (!_r2) {
		_r2 = new S3Client({
			region: 'auto',
			endpoint: env.S3_ENDPOINT,
			credentials: {
				accessKeyId: env.S3_ACCESS_KEY_ID,
				secretAccessKey: env.S3_SECRET_ACCESS_KEY,
			},
			// AWS SDK v3 ≥ 3.730 adds CRC32 to every PutObject by default.
			// Browsers can't compute/send that header, so presigned PUT URLs
			// would be rejected by R2. Opt out until we add client-side CRC32.
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED',
		});
	}
	return _r2;
}
export const r2 = new Proxy(
	{},
	{
		get(_t, prop) {
			return getR2()[prop];
		},
	},
);

// True only when every var the read/write helpers below dereference is present:
// the client needs the endpoint plus credentials, putObject/presignGet need the
// bucket, and publicUrl() needs the public domain. Callers that would otherwise
// claim a batch of work and fail every item on `Missing required env var: S3_…`
// gate on this and skip the tick instead (api/cron/avatar-thumbnail-*.js).
export function objectStorageConfigured() {
	// Trimmed, because a credential that is nothing but a newline is not
	// configured storage: it signs every request into a `SignatureDoesNotMatch`
	// while every truthiness check above it reads healthy (see env.js secret()).
	const set = (name) => Boolean(String(process.env[name] ?? '').trim());
	return (
		set('S3_ENDPOINT') &&
		set('S3_BUCKET') &&
		set('S3_PUBLIC_DOMAIN') &&
		set('S3_ACCESS_KEY_ID') &&
		set('S3_SECRET_ACCESS_KEY')
	);
}

// A failure caused by object storage being unconfigured, unreachable, or
// rejecting our credentials says nothing about the asset being processed: the
// same GLB succeeds once storage is healthy. Batch runners working off a bounded
// retry ledger use this to hand the attempt back instead of permanently retiring
// a blameless row (see renderBatch in avatar-thumbs.js). Deliberately strict, as
// with isBrowserInfrastructureError: an unlisted error is the asset's fault, so a
// genuinely broken model still retires instead of being retried forever.
// Exported as a pattern string so the SQL repair path can ask the same question
// with `~*` instead of maintaining a second, drifting copy (see
// resetInfrastructureFailures in avatar-thumbs.js). JS/POSIX-ERE compatible.
// `does not match the signature` is the S3 error's human MESSAGE; the compact
// `SignatureDoesNotMatch` form only ever appears in err.name / err.Code, never in
// the sentence the SDK throws. Matching the name alone (as this did until
// 2026-09-07) meant the single most common credential fault sailed past every
// caller of this helper, including the batch runners that use it to decide
// whether an asset is blameless, and surfaced to users as a raw "Check your
// secret access key" in the browser.
// `unauthorized` covers the OTHER shape a bad token takes: a ROTATED secret
// answers SignatureDoesNotMatch, but a REVOKED or deleted access key id answers
// a bare `Unauthorized` instead, which nothing here matched. That gap is
// invisible until it fires, because both faults present identically to a user
// and only one of them reached the public-domain failover in cdn-object.js and
// the avatar GLB proxy. Object-level denial is `AccessDenied` (already listed
// above), so `Unauthorized` from S3 is always the credential and never the
// object: classifying it as infrastructure blames nothing that deserves blame.
export const STORAGE_ERROR_PATTERN =
	'missing required env var: s3_|invalidaccesskeyid|signaturedoesnotmatch|does not match the signature|unauthorized|nosuchbucket|access denied|econnrefused|enotfound|socket hang up|econnreset';

const STORAGE_ERROR_RE = new RegExp(STORAGE_ERROR_PATTERN, 'i');

export function isStorageInfrastructureError(err) {
	// The SDK splits one fault across three fields: name/Code carry the compact
	// code, message carries the sentence. Judge all of them, so neither shape
	// escapes.
	const text = [err?.name, err?.Code, err?.message ?? (err == null ? '' : String(err))]
		.filter(Boolean)
		.join(' ');
	return STORAGE_ERROR_RE.test(text);
}

// Cached liveness of the storage credential, for the one caller shape that
// cannot recover on its own: an endpoint that hands the BROWSER a presigned URL.
// objectStorageConfigured() above only proves the vars are present, and a
// present-but-rejected secret signs a URL that looks perfect and answers 403
// SignatureDoesNotMatch on use. That 403 carries no CORS header, so the page
// never sees a status at all: it sees a rejected fetch and reports a network
// fault, which is how a rotated R2 token read as "Network error during upload"
// to every /forge user on 2026-09-07 while the endpoint reported 200 OK.
//
// The probe is the same signed one-key list the health sensor uses (a rejected
// credential fails identically for reads and writes, so one read proves both).
// Results are cached and single-flighted so a six-slot burst costs one probe,
// and a rejection is re-checked often enough that a fixed credential recovers
// within seconds without a redeploy.
const CRED_OK_TTL_MS = 60_000;
const CRED_FAIL_TTL_MS = 15_000;
let _credProbe = null;
let _credProbeInFlight = null;

async function runCredProbe() {
	const started = Date.now();
	try {
		await r2.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, MaxKeys: 1 }), {
			abortSignal: AbortSignal.timeout(3_000),
		});
		return { at: started, ok: true, reason: null, message: null };
	} catch (err) {
		// Fail CLOSED only on the deterministic class (the credential itself was
		// rejected): that never fixes itself on retry, and every presigned URL we
		// hand out until it is fixed is guaranteed to fail in the browser. A
		// timeout or a dropped socket is transient and may well be the probe's own
		// bad luck, so fail OPEN there and let the real PUT decide rather than
		// taking uploads down over one flaky list.
		const transient = /timeout|aborted|econnreset|socket hang up/i.test(String(err?.message || ''));
		const rejected = isStorageInfrastructureError(err) && !transient;
		return {
			at: started,
			ok: !rejected,
			reason: rejected ? 'rejected' : null,
			message: rejected ? String(err?.message || err).slice(0, 200) : null,
		};
	}
}

/**
 * @returns {Promise<{ ok: boolean, reason: 'unconfigured'|'rejected'|null, message: string|null }>}
 */
export async function objectStorageUsable() {
	if (!objectStorageConfigured()) {
		return { ok: false, reason: /** @type {const} */ ('unconfigured'), message: null };
	}
	const ttl = _credProbe?.ok ? CRED_OK_TTL_MS : CRED_FAIL_TTL_MS;
	if (_credProbe && Date.now() - _credProbe.at < ttl) return _credProbe;
	if (!_credProbeInFlight) {
		_credProbeInFlight = runCredProbe()
			.then((result) => {
				_credProbe = result;
				return result;
			})
			.finally(() => {
				_credProbeInFlight = null;
			});
	}
	return _credProbeInFlight;
}

// Drops the cached verdict. Tests use it to probe a fresh state; production
// never needs it, because both TTLs above expire on their own.
export function resetObjectStorageUsableCache() {
	_credProbe = null;
	_credProbeInFlight = null;
}

// Short-lived signed URL for direct browser upload (PUT).
export async function presignUpload({ key, contentType, checksumSha256 }) {
	// Do NOT include ContentLength in the command — that adds content-length to
	// X-Amz-SignedHeaders, which browsers omit from CORS preflights (it is a
	// "forbidden" request header). R2 would then reject the preflight, causing
	// a network-level failure before the PUT response is ever checked.
	// Size is validated server-side via headObject after upload.
	const cmd = new PutObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: key,
		ContentType: contentType,
		ChecksumSHA256: checksumSha256,
	});
	return getSignedUrl(r2, cmd, { expiresIn: 300 });
}

// Signed URL for GET (used for private avatars or temporary shares).
export async function presignGet({ key, expiresIn = 600 }) {
	if (isAbsoluteUrl(key)) return key; // first-party/externally-hosted: already a public URL
	const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key });
	return getSignedUrl(r2, cmd, { expiresIn });
}

export async function headObject(key) {
	if (isAbsoluteUrl(key)) return null; // not a bucket object
	try {
		return await r2.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	} catch (err) {
		if (err?.$metadata?.httpStatusCode === 404) return null;
		throw err;
	}
}

export async function deleteObject(key) {
	if (isAbsoluteUrl(key)) return; // externally-hosted asset — nothing in our bucket to delete
	await r2.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

export async function putObject({ key, body, contentType, metadata = {} }) {
	await r2.send(
		new PutObjectCommand({
			Bucket: env.S3_BUCKET,
			Key: key,
			Body: body,
			ContentType: contentType,
			Metadata: metadata,
		}),
	);
}

// Server-side object copy (no download/re-upload). Used by avatar forks to
// duplicate a source GLB/thumbnail into the new owner's `u/{ownerId}/` namespace
// so the fork is a fully independent object. Returns false (and the caller can
// fall back to referencing the source URL) when the source is an absolute URL
// rather than a bucket object — those live outside our bucket and nothing needs
// copying.
export async function copyObject({ fromKey, toKey }) {
	if (isAbsoluteUrl(fromKey)) return false;
	await r2.send(
		new CopyObjectCommand({
			Bucket: env.S3_BUCKET,
			CopySource: `${env.S3_BUCKET}/${encodeR2Key(fromKey)}`,
			Key: toKey,
		}),
	);
	return true;
}

export async function getObjectBuffer(key) {
	const { Body } = await r2.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	const chunks = [];
	for await (const chunk of Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks);
}

// Read an object together with the user metadata it was stored with. Used by
// caches that key on a stable path and decide freshness from a stamp in the
// metadata (the glance PNG cache stores the card's ETag there), so a stale
// object is overwritten in place instead of piling up a new key per version.
// Returns null when the object does not exist.
export async function getObjectWithMetadata(key) {
	let out;
	try {
		out = await r2.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	} catch (err) {
		if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return null;
		throw err;
	}
	const chunks = [];
	for await (const chunk of out.Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return { body: Buffer.concat(chunks), metadata: out.Metadata || {}, contentType: out.ContentType || null };
}

// Read just the leading `length` bytes of an object via an HTTP Range request.
// Used by the rig classifier to read a GLB's glTF JSON chunk (which lives at
// the file head) without downloading the whole — potentially large — mesh.
export async function getObjectRange(key, length) {
	const { Body } = await r2.send(
		new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Range: `bytes=0-${length - 1}` }),
	);
	const chunks = [];
	for await (const chunk of Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks);
}

// Public CDN URL for objects served via R2 custom domain / r2.dev.
//
// First-party / externally-hosted avatars store an absolute URL in their
// `storage_key` (e.g. https://three.ws/avatars/realistic-male.glb) rather than
// an R2 object key — these models live outside the bucket and are already
// fully-qualified, so they pass through untouched. Every bucket-backed key
// (the `u/{ownerId}/…` form) resolves against the CDN domain exactly as before,
// so existing avatars are unaffected.
export function publicUrl(key) {
	if (isAbsoluteUrl(key)) return key;
	return `${env.S3_PUBLIC_DOMAIN}/${encodeR2Key(key)}`;
}

function isAbsoluteUrl(key) {
	return typeof key === 'string' && /^https?:\/\//i.test(key);
}

// publicUrl() for a READ path that only wants to render a stored object.
//
// `env.S3_PUBLIC_DOMAIN` throws when object storage isn't configured on a
// deployment, which is the right signal for an upload path (there is nowhere to
// put the bytes) but the wrong one for a feed: a missing thumbnail is a designed
// empty state, and one un-renderable key should never take down a whole list
// response. Read paths call this and render their placeholder on null; write
// paths keep calling publicUrl() so a misconfigured deployment still fails loud.
export function publicUrlOrNull(key) {
	if (!key) return null;
	try {
		return publicUrl(key);
	} catch {
		return null;
	}
}

// Reverse of publicUrl(): resolve a public CDN URL back to the bucket key it
// serves, or null when the URL lives outside our bucket. Lets deletion paths
// find the stored object behind a URL-bearing column (e.g. a forge creation's
// preview_image_url) so the bytes are actually removed, not just unlinked.
export function keyFromPublicUrl(url) {
	if (typeof url !== 'string' || !url.startsWith(`${env.S3_PUBLIC_DOMAIN}/`)) return null;
	const path = url.slice(`${env.S3_PUBLIC_DOMAIN}/`.length).split(/[?#]/)[0];
	if (!path) return null;
	try {
		return path.split('/').map(decodeURIComponent).join('/');
	} catch {
		return null;
	}
}

// A thumbnail_key written by the pre-fix avatar-OG cache (it derived `_og.png`
// from an absolute storage_key, so the "key" was a full origin URL that
// publicUrl() passes through verbatim — pointing at the site instead of the R2
// CDN, where no object exists). Such keys 404; callers use this to drop or
// self-heal them rather than surface a broken image.
export function isLegacyOgThumbnailKey(thumbnailKey) {
	return /^https?:\/\/.*_og\.png$/i.test(String(thumbnailKey || ''));
}

// The ONE way to turn a stored thumbnail_key into a URL for an <img>.
//
// A thumbnail_key only resolves to a real image when it is a relative R2 key.
// Legacy poisoned keys (absolute, origin-pointing `*_og.png`) 404 — and a 404
// answered with a `text/plain` body is refused by Chrome's Opaque Response
// Blocking when it was requested as an image (net::ERR_BLOCKED_BY_ORB), so the
// browser logs an error instead of quietly showing nothing. Return null and let
// the caller render its designed placeholder.
//
// Every read path that surfaces a thumbnail to a browser must go through this,
// not bare publicUrl(). See docs/avatar-thumbnails.md.
export function thumbnailUrl(thumbnailKey) {
	if (!thumbnailKey || isLegacyOgThumbnailKey(thumbnailKey)) return null;
	return publicUrlOrNull(thumbnailKey);
}

function encodeR2Key(key) {
	return key.split('/').map(encodeURIComponent).join('/');
}

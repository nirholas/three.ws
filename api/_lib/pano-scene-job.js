// Job handles and shared job state for /api/pano-scene (360 photo to a depth
// shell you can stand inside).
//
// The handle is a signed token, not a database row. Scene Capture keeps no job
// store of its own (its job id is an unsigned provider envelope), and a poll may
// land on any Cloud Run instance, so everything a poll needs travels in the
// token: the owner, the source kind and the worker task id known at submit time.
// It is HMAC-SHA256 signed with the server JWT_SECRET (the same canonical secret
// api/_lib/forge-job-token.js signs forge handles with), under a domain prefix so
// a token minted for another surface can never verify here. Without the
// signature a caller could poll someone else's worker task with our bearer key.
//
// A raw .insp runs two workers in sequence (stitch, then depth), and the depth
// task id only exists after the stitch finishes, so it cannot ride in a token
// the client already holds. That one fact lives in R2 beside the results:
//
//   captures/pano-scene/<owner>/<job>/state.json    { depth_task_id, equirect_url }
//   captures/pano-scene/<owner>/<job>/finalize.json  the copy-to-R2 claim
//   captures/pano-scene/<owner>/<job>/result.json    { glb_url, ply_url, stats } or { error }
//
// Claims use conditional writes (If-None-Match: * to create, If-Match: <etag>
// to take over a stale claim), so two polls racing on two instances submit the
// depth task once and copy the results once.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { env } from './env.js';
import { r2 } from './r2.js';

const TOKEN_PREFIX = 'ps1';
const SIGNING_DOMAIN = 'three.ws/pano-scene/v1:';

export const SOURCE_KINDS = Object.freeze(['equirect_image', 'insp']);

function sign(payload) {
	return createHmac('sha256', env.JWT_SECRET).update(SIGNING_DOMAIN + payload).digest('base64url');
}

/**
 * @param {{ owner: string|null, jobId: string, kind: string, stitchTaskId?: string|null,
 *           depthTaskId?: string|null, createdAt: number }} job
 */
export function encodeJobToken({ owner, jobId, kind, stitchTaskId = null, depthTaskId = null, createdAt }) {
	const body = { u: owner, j: jobId, k: kind, c: createdAt };
	if (stitchTaskId) body.s = stitchTaskId;
	if (depthTaskId) body.d = depthTaskId;
	const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
	return `${TOKEN_PREFIX}.${payload}.${sign(payload)}`;
}

/** Verified job, or null for anything unsigned, re-signed, truncated or malformed. */
export function decodeJobToken(token) {
	if (typeof token !== 'string' || token.length > 2048) return null;
	const parts = token.split('.');
	if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
	const [, payload, sig] = parts;
	if (!payload || !sig) return null;
	try {
		const expected = Buffer.from(sign(payload), 'utf8');
		const actual = Buffer.from(sig, 'utf8');
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
		const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		if (typeof obj?.j !== 'string' || !SOURCE_KINDS.includes(obj.k)) return null;
		if (obj.k === 'insp' && typeof obj.s !== 'string') return null;
		if (obj.k === 'equirect_image' && typeof obj.d !== 'string') return null;
		return {
			owner: typeof obj.u === 'string' ? obj.u : null,
			jobId: obj.j,
			kind: obj.k,
			stitchTaskId: obj.s ?? null,
			depthTaskId: obj.d ?? null,
			createdAt: Number(obj.c) || 0,
		};
	} catch {
		return null;
	}
}

// One storage path segment per owner. Account ids are UUID-like today; anything
// else is folded to a safe segment so a key can never climb out of the prefix.
function ownerSegment(owner) {
	return owner ? String(owner).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128) || 'user' : 'platform';
}

export function jobPrefix(owner, jobId) {
	return `captures/pano-scene/${ownerSegment(owner)}/${jobId}/`;
}

function statusOf(err) {
	return err?.$metadata?.httpStatusCode ?? err?.status ?? null;
}

/** Read a small JSON object: `{ data, etag }`, or null when it does not exist. */
export async function readJsonObject(key) {
	let out;
	try {
		out = await r2.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	} catch (err) {
		if (err?.name === 'NoSuchKey' || statusOf(err) === 404) return null;
		throw err;
	}
	const chunks = [];
	for await (const chunk of out.Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), etag: out.ETag ?? null };
}

/**
 * Write a small JSON object. `ifNoneMatch` creates only when absent, `ifMatch`
 * replaces only the version read. Returns the new etag, or null when the
 * precondition lost the race.
 */
export async function writeJsonObject(key, data, { ifNoneMatch = false, ifMatch = null } = {}) {
	const input = {
		Bucket: env.S3_BUCKET,
		Key: key,
		Body: JSON.stringify(data),
		ContentType: 'application/json',
	};
	if (ifNoneMatch) input.IfNoneMatch = '*';
	if (ifMatch) input.IfMatch = ifMatch;
	try {
		const out = await r2.send(new PutObjectCommand(input));
		return out?.ETag ?? '"written"';
	} catch (err) {
		const status = statusOf(err);
		if (status === 412 || status === 409 || err?.name === 'PreconditionFailed') return null;
		throw err;
	}
}

/**
 * Take a one-at-a-time claim on `key`. A claim older than `staleMs` belonged to
 * an instance that died mid-step and may be taken over.
 * @returns {Promise<{ won: true, etag: string } | { won: false, data: object|null }>}
 */
export async function claim(key, { staleMs, now = Date.now(), retried = false }) {
	const etag = await writeJsonObject(key, { claimed_at: now }, { ifNoneMatch: true });
	if (etag) return { won: true, etag };
	const current = await readJsonObject(key);
	// Deleted between our create and our read: one more create settles it.
	if (!current) return retried ? { won: false, data: null } : claim(key, { staleMs, now, retried: true });
	const claimedAt = Number(current.data?.claimed_at) || 0;
	if (current.data?.depth_task_id || now - claimedAt < staleMs) return { won: false, data: current.data };
	const taken = await writeJsonObject(key, { claimed_at: now }, { ifMatch: current.etag });
	return taken ? { won: true, etag: taken } : { won: false, data: current.data };
}

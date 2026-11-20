// Grok Imagine Video client (xAI), used by hero clips (docs/hero-clips.md).
//
// The REST flow is two steps (https://docs.x.ai/developers/model-capabilities/video/generation):
//   POST https://api.x.ai/v1/videos/generations  -> {"request_id": "..."}
//   GET  https://api.x.ai/v1/videos/{request_id} -> {"status": "pending"|"done"|"failed", ...}
// A finished job carries a TEMPORARY video URL, so the clip is downloaded into
// our own object store before anyone is handed a link.
//
// Model ids and per-model limits live in chat-models.js (XAI_VIDEO_MODELS).
// Only the full model accepts reference images; lite is image-to-video, so the
// request builder pins our real front render as the first frame on both and
// adds the other angles as references only where the model can use them.
//
// Failures surface as XaiVideoError with a stable `code` the endpoint maps to
// copy: not_configured, unauthorized, rate_limited, refused, bad_request,
// unavailable, failed, timeout. Upstream bodies are operator diagnostics and
// stay in `detail`; they are never shown to users.

import { env } from './env.js';
import { XAI_VIDEO_GENERATIONS_URL, XAI_VIDEO_STATUS_URL, XAI_VIDEO_MODELS } from './chat-models.js';
import { readBytesCapped, readTextCapped } from './read-capped.js';
import { fetchSafePublicUrl } from './ssrf-guard.js';
import { headObject, putObject, cdnUrl } from './r2.js';
import { recordEvent } from './usage.js';

export const XAI_VIDEO_CLIENT_ID = 'xai-video';
export const HERO_CLIP_KEY_PREFIX = 'hero-clips/';

const CREATE_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const ERROR_BODY_MAX = 16 * 1024;
const STATUS_BODY_MAX = 64 * 1024;
// A 15 s 720p clip is a few MB; anything near this cap is not a video we asked for.
const VIDEO_MAX_BYTES = 64 * 1024 * 1024;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,80}$/;
const MODERATION_RE = /moderat|content polic|safety|blocked|not allowed|violat/i;

export class XaiVideoError extends Error {
	/**
	 * @param {string} code stable failure code
	 * @param {string} message operator-facing description
	 * @param {{status?:number, retryAfter?:number, providerCode?:string, detail?:string, requestId?:string}} [extra]
	 */
	constructor(code, message, extra = {}) {
		super(message);
		this.name = 'XaiVideoError';
		this.code = code;
		Object.assign(this, extra);
	}
}

/** True when a platform xAI key is configured. */
export function xaiVideoConfigured() {
	return Boolean(env.GROK_API_KEY);
}

/** The model record for a tier ('lite' or 'full'). */
export function videoModel(tier = 'lite') {
	const model = XAI_VIDEO_MODELS[tier];
	if (!model) throw new XaiVideoError('bad_request', `unknown video tier: ${tier}`);
	return model;
}

/** Estimated list cost of a clip in micro-USD. */
export function clipCostMicroUsd(tier, seconds) {
	return Math.round(videoModel(tier).pricePerSecond * Number(seconds || 0) * 1_000_000);
}

/**
 * Build the POST /v1/videos/generations body.
 *
 * Lite: image-to-video, the front render pinned as the first frame.
 * Full: reference-to-video with a pinned first frame (the front render is
 * <IMAGE_0>, the other angles follow as <IMAGE_1>..), at the 720p ceiling
 * reference-to-video allows. `loop` also pins the last frame to the front
 * render, which full supports and which makes a turntable loop seamlessly.
 *
 * @param {object} opts
 * @param {'lite'|'full'} [opts.tier='lite']
 * @param {string} opts.prompt
 * @param {number} opts.duration seconds
 * @param {string} opts.firstFrame image URL or data URI
 * @param {string[]} [opts.references] further angles (full only)
 * @param {boolean} [opts.loop=false]
 */
export function buildVideoRequest({ tier = 'lite', prompt, duration, firstFrame, references = [], loop = false }) {
	const model = videoModel(tier);
	const seconds = Number(duration);
	if (!Number.isInteger(seconds) || seconds < 1 || seconds > model.maxSeconds) {
		throw new XaiVideoError('bad_request', `duration must be an integer from 1 to ${model.maxSeconds}`);
	}
	if (typeof prompt !== 'string' || !prompt.trim()) throw new XaiVideoError('bad_request', 'prompt required');
	if (typeof firstFrame !== 'string' || !firstFrame) throw new XaiVideoError('bad_request', 'firstFrame required');
	const body = {
		model: model.id,
		prompt: prompt.trim(),
		duration: seconds,
		resolution: model.resolution,
		generate_audio: false,
		image: { url: firstFrame },
	};
	if (model.referenceImages > 0) {
		const refs = references.filter((r) => typeof r === 'string' && r).slice(0, model.referenceImages);
		if (refs.length) body.reference_images = refs.map((url) => ({ url }));
		if (loop) body.last_frame = { url: firstFrame };
	}
	return body;
}

function retryAfterSeconds(res) {
	const raw = res.headers?.get?.('retry-after');
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function errorFromResponse(res, op) {
	const { text } = await readTextCapped(res, ERROR_BODY_MAX).catch(() => ({ text: '' }));
	let parsed = null;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = null;
	}
	const message = String(parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? text ?? '').slice(0, 300);
	const providerCode = String(parsed?.code ?? parsed?.error?.code ?? '') || undefined;
	const extra = { status: res.status, providerCode, detail: message };
	if (res.status === 401 || res.status === 403) {
		return new XaiVideoError('unauthorized', `xAI ${op} rejected the credentials (${res.status})`, extra);
	}
	// xAI answers a malformed or revoked key with 400 invalid-argument, not 401.
	if (res.status === 400 && /api key/i.test(message)) {
		return new XaiVideoError('unauthorized', `xAI ${op} rejected the API key (400)`, extra);
	}
	if (res.status === 429) {
		return new XaiVideoError('rate_limited', `xAI ${op} is rate limiting (429)`, { ...extra, retryAfter: retryAfterSeconds(res) });
	}
	if (res.status === 400 || res.status === 404 || res.status === 422) {
		if (MODERATION_RE.test(message)) return new XaiVideoError('refused', `xAI ${op} refused the request`, extra);
		return new XaiVideoError('bad_request', `xAI ${op} rejected the request (${res.status})`, extra);
	}
	return new XaiVideoError('unavailable', `xAI ${op} failed (${res.status})`, extra);
}

function apiKeyOrThrow(apiKey) {
	const key = apiKey ?? env.GROK_API_KEY;
	if (!key) throw new XaiVideoError('not_configured', 'GROK_API_KEY is not set');
	return key;
}

async function send(url, init, op, timeoutMs) {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
		throw new XaiVideoError(timedOut ? 'timeout' : 'unavailable', `xAI ${op} did not answer: ${err?.message || err}`);
	}
}

/**
 * Start a generation. Auth, unknown-model and rate-limit errors come back here
 * synchronously, before any job exists.
 *
 * @param {object} body from buildVideoRequest
 * @param {{apiKey?:string}} [opts] apiKey defaults to GROK_API_KEY; pass '' to
 *   send no credentials at all
 * @returns {Promise<{requestId:string}>}
 */
export async function createVideoJob(body, { apiKey } = {}) {
	const key = apiKey === '' ? '' : apiKeyOrThrow(apiKey);
	const headers = { 'content-type': 'application/json' };
	if (key) headers.authorization = `Bearer ${key}`;
	const res = await send(XAI_VIDEO_GENERATIONS_URL, { method: 'POST', headers, body: JSON.stringify(body) }, 'create', CREATE_TIMEOUT_MS);
	if (!res.ok) throw await errorFromResponse(res, 'create');
	const { text } = await readTextCapped(res, STATUS_BODY_MAX);
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw new XaiVideoError('unavailable', 'xAI create answered with a non-JSON body', { detail: text.slice(0, 200) });
	}
	const requestId = String(data?.request_id ?? '');
	if (!REQUEST_ID_RE.test(requestId)) {
		throw new XaiVideoError('unavailable', 'xAI create answered without a request_id', { detail: text.slice(0, 200) });
	}
	return { requestId };
}

function failureFromJob(error, requestId) {
	const providerCode = String(error?.code ?? '') || undefined;
	const detail = String(error?.message ?? '').slice(0, 300);
	const extra = { providerCode, detail, requestId };
	switch (providerCode) {
		case 'invalid_argument':
			// The docs fold moderation blocks into invalid_argument; the message
			// is the only thing that tells a refusal from a bad input.
			return MODERATION_RE.test(detail)
				? new XaiVideoError('refused', 'xAI declined to generate this clip', extra)
				: new XaiVideoError('bad_request', 'xAI rejected the clip inputs', extra);
		case 'permission_denied':
			return new XaiVideoError('unauthorized', 'the xAI key has no access to video generation', extra);
		case 'failed_precondition':
			return new XaiVideoError('bad_request', 'the model cannot run this request shape', extra);
		case 'service_unavailable':
			return new XaiVideoError('unavailable', 'xAI video generation is overloaded', extra);
		default:
			return new XaiVideoError('failed', 'xAI could not finish the clip', extra);
	}
}

/**
 * One status read, normalized.
 *
 * @returns {Promise<{status:'pending'} | {status:'done', videoUrl:string, duration:number|null, model:string|null} | {status:'failed', error:XaiVideoError}>}
 */
export async function getVideoJob(requestId, { apiKey } = {}) {
	if (!REQUEST_ID_RE.test(String(requestId ?? ''))) throw new XaiVideoError('bad_request', 'malformed request id');
	const key = apiKey === '' ? '' : apiKeyOrThrow(apiKey);
	const headers = key ? { authorization: `Bearer ${key}` } : {};
	const res = await send(`${XAI_VIDEO_STATUS_URL}/${encodeURIComponent(requestId)}`, { headers }, 'status', STATUS_TIMEOUT_MS);
	if (!res.ok) throw await errorFromResponse(res, 'status');
	const { text } = await readTextCapped(res, STATUS_BODY_MAX);
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		throw new XaiVideoError('unavailable', 'xAI status answered with a non-JSON body', { detail: text.slice(0, 200) });
	}
	if (data?.status === 'failed') return { status: 'failed', error: failureFromJob(data.error, requestId) };
	if (data?.status === 'done') {
		// respect_moderation false means the output was filtered: there is no
		// usable clip, and the honest answer is a refusal.
		if (data.video?.respect_moderation === false) {
			return {
				status: 'failed',
				error: new XaiVideoError('refused', 'xAI filtered the finished clip', { requestId, providerCode: 'moderated' }),
			};
		}
		const videoUrl = String(data.video?.url ?? '');
		if (!/^https:\/\//.test(videoUrl)) {
			throw new XaiVideoError('unavailable', 'xAI reported done without a video URL', { requestId, detail: text.slice(0, 200) });
		}
		const duration = Number(data.video?.duration);
		return {
			status: 'done',
			videoUrl,
			duration: Number.isFinite(duration) ? duration : null,
			model: data.model ? String(data.model) : null,
		};
	}
	return { status: 'pending' };
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until done or failed, backing off between reads, up to a hard timeout.
 * For scripts and workers that can hold a connection; the HTTP endpoint polls
 * once per client request instead.
 *
 * @returns {Promise<{status:'done', videoUrl:string, duration:number|null, model:string|null}>}
 */
export async function pollVideoJob(
	requestId,
	{ apiKey, timeoutMs = 10 * 60_000, initialDelayMs = 2_000, maxDelayMs = 10_000, factor = 1.5, sleep = realSleep, now = Date.now } = {},
) {
	const deadline = now() + timeoutMs;
	let delay = initialDelayMs;
	for (;;) {
		const job = await getVideoJob(requestId, { apiKey });
		if (job.status === 'done') return job;
		if (job.status === 'failed') throw job.error;
		const remaining = deadline - now();
		if (remaining <= 0) {
			throw new XaiVideoError('timeout', `xAI clip ${requestId} was not done after ${Math.round(timeoutMs / 1000)} s`, { requestId });
		}
		await sleep(Math.min(delay, remaining));
		delay = Math.min(Math.round(delay * factor), maxDelayMs);
	}
}

/** The object key a clip is stored under. */
export function clipKey(requestId) {
	return `${HERO_CLIP_KEY_PREFIX}${requestId}.mp4`;
}

/**
 * Copy a finished clip from xAI's temporary URL into our object store, once.
 * A second call for the same request finds the object and returns it without
 * downloading or metering again, so polling clients can race safely.
 *
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {string} opts.videoUrl xAI's temporary URL
 * @param {'lite'|'full'} opts.tier
 * @param {number} opts.seconds requested duration (metering)
 * @param {object} [opts.metadata] stored with the object (owner, preset, title)
 * @param {object} [opts.usage] extra usage fields (userId, meta)
 * @returns {Promise<{clipUrl:string, key:string, bytes:number|null, stored:boolean}>}
 */
export async function storeVideo({ requestId, videoUrl, tier, seconds, metadata = {}, usage = {} }) {
	const key = clipKey(requestId);
	const existing = await headObject(key);
	if (existing) return { clipUrl: cdnUrl(key), key, bytes: Number(existing.ContentLength ?? 0) || null, stored: false };

	const t0 = Date.now();
	let res;
	try {
		// Redirect-checked: every hop is re-validated as a public address.
		res = await fetchSafePublicUrl(videoUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
	} catch (err) {
		throw new XaiVideoError('unavailable', `xAI video download did not complete: ${err?.message || err}`, { requestId });
	}
	if (!res.ok) throw new XaiVideoError('unavailable', `xAI video download failed (${res.status})`, { requestId, status: res.status });
	const { bytes, truncated } = await readBytesCapped(res, VIDEO_MAX_BYTES);
	if (truncated) throw new XaiVideoError('failed', 'the finished clip is larger than any clip we request', { requestId });
	if (bytes.length < 1024) throw new XaiVideoError('failed', 'the finished clip is empty', { requestId });

	const model = videoModel(tier);
	const meta = Object.fromEntries(Object.entries({ ...metadata, model: model.id, request_id: requestId }).filter(([, v]) => v != null && v !== ''));
	await putObject({ key, body: bytes, contentType: 'video/mp4', metadata: meta });

	recordEvent({
		kind: 'xai_video',
		clientId: XAI_VIDEO_CLIENT_ID,
		provider: 'xai',
		model: model.id,
		tool: 'hero_clip',
		status: 'ok',
		bytes: bytes.length,
		latencyMs: Date.now() - t0,
		costMicroUsd: clipCostMicroUsd(tier, seconds),
		userId: usage.userId ?? null,
		meta: { request_id: requestId, seconds: Number(seconds), ...(usage.meta || {}) },
	});
	return { clipUrl: cdnUrl(key), key, bytes: bytes.length, stored: true };
}

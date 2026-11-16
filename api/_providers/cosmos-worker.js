// Self-hosted Cosmos 3 Nano world worker: the top rung of the /api/cosmos ladder.
//
// workers/model-cosmos runs nvidia/Cosmos3-Nano on a Cloud Run RTX PRO 6000 and
// serves four modes from one checkpoint: text, image (a still of the avatar's
// scene becomes frame 0), depth and edge (a three.js render of the scene steers
// the layout). This module is the Node client for that worker's contract:
//
//   POST {URL}/infer              -> 202 { task_id, status, queue_position, model }
//   GET  {URL}/tasks/{id}         -> { status, step, total_steps, progress, eta_seconds,
//                                      error_code?, error?, timings?, upsampler? }
//   GET  {URL}/tasks/{id}/video   -> video/mp4
//
// The worker keeps every task record in its private GCS bucket, so the task id is
// a durable handle across our instances and across a worker restart. When a task
// finishes, the clip is copied once into R2 at a key derived from the job id, so
// every later poll (another tab, a reload, another instance) serves the same URL
// without touching the worker again.
//
// Worker error bodies are FastAPI `{ detail }` strings written to be caller-safe
// (validation and queue messages). They are still length-capped before they are
// returned.

import { env } from '../_lib/env.js';

export const WORKER_MODEL_ID = 'cosmos3-nano';
export const WORKER_MODES = Object.freeze(['text', 'image', 'depth', 'edge']);
export const WORKER_PROMPT_MAX = 600;
export const WORKER_RESOLUTIONS = Object.freeze(['480', '720']);
export const WORKER_FRAMES = Object.freeze({ min: 33, max: 121, default: 121 });
// Decoded-byte ceilings, mirrored from workers/model-cosmos/generation_config.py.
export const WORKER_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const WORKER_MAX_CONTROL_BYTES = 48 * 1024 * 1024;

const SUBMIT_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 15_000;
const VIDEO_TIMEOUT_MS = 90_000;
const DETAIL_MAX = 240;

export function cosmosWorkerConfigured() {
	return Boolean(env.COSMOS_WORKER_URL && env.COSMOS_WORKER_KEY);
}

function baseUrl() {
	return String(env.COSMOS_WORKER_URL || '').replace(/\/+$/, '');
}

function authHeaders(extra = {}) {
	return { authorization: `Bearer ${env.COSMOS_WORKER_KEY}`, ...extra };
}

export function workerVideoKey(jobId) {
	return `forge/cosmos/${jobId}.mp4`;
}

async function readDetail(res) {
	try {
		const body = await res.json();
		const detail = body?.detail ?? body?.message ?? '';
		return (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, DETAIL_MAX);
	} catch {
		return '';
	}
}

function laneError(code, status, message, extra = {}) {
	return Object.assign(new Error(message), { code, status, ...extra });
}

// The worker body is exactly what the UI sent, minus anything the worker does
// not read. Validation of shapes and sizes is the worker's job (it is the one
// that decodes the media); the API only refuses what it can see is missing.
export function buildWorkerBody({ mode, prompt, seed, resolution, numFrames, image, controlVideo }) {
	const body = { mode, prompt };
	if (Number.isInteger(seed)) body.seed = seed;
	if (resolution) body.resolution = resolution;
	if (Number.isInteger(numFrames)) body.num_frames = numFrames;
	if (mode === 'image') body.image = image;
	if (mode === 'depth' || mode === 'edge') body.control_video = controlVideo;
	return body;
}

export async function submitWorld(input) {
	let res;
	try {
		res = await fetch(`${baseUrl()}/infer`, {
			method: 'POST',
			headers: authHeaders({ 'content-type': 'application/json', accept: 'application/json' }),
			body: JSON.stringify(buildWorkerBody(input)),
			signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
		});
	} catch (err) {
		throw laneError('provider_unreachable', 502, `cosmos worker unreachable: ${err?.message}`);
	}
	if (res.status === 202 || res.ok) {
		const data = await res.json().catch(() => null);
		if (!data?.task_id || !/^[a-f0-9]{32}$/.test(data.task_id)) {
			throw laneError('provider_error', 502, 'cosmos worker accepted the job without a task id');
		}
		return { taskId: data.task_id, queuePosition: data.queue_position ?? 0 };
	}
	const detail = await readDetail(res);
	if (res.status === 400) throw laneError('invalid_input', 400, detail || 'the worker refused this request', { userMessage: detail });
	if (res.status === 401 || res.status === 403) throw laneError('invalid_key', 401, `cosmos worker rejected the key: ${detail}`);
	if (res.status === 429) throw laneError('lane_busy', 429, detail || 'cosmos worker queue is full', { userMessage: detail });
	if (res.status === 503) throw laneError('lane_unavailable', 503, `cosmos worker model unavailable: ${detail}`);
	throw laneError('provider_error', 502, `cosmos worker returned ${res.status}: ${detail}`);
}

// Copy a finished clip into R2 once. The key is derived from the job id, so a
// HEAD answers every later poll without re-downloading from the worker.
async function persistOnce(jobId, taskId) {
	const { headObject, putObject, cdnUrl } = await import('../_lib/r2.js');
	const key = workerVideoKey(jobId);
	// The existence check is only a shortcut. When R2 cannot answer it (a
	// rejected credential reaches a HEAD as a bodiless 401), copy anyway:
	// putObject diverts to the GCS fallback bucket on exactly that error, and
	// /cdn serves the key from wherever it landed.
	const existing = await headObject(key).catch((err) => {
		console.warn('[cosmos-worker] R2 head %s failed, copying anyway: %s', key, err?.message || err);
		return null;
	});
	if (existing) return cdnUrl(key);
	const res = await fetch(`${baseUrl()}/tasks/${taskId}/video`, {
		headers: authHeaders({ accept: 'video/mp4' }),
		signal: AbortSignal.timeout(VIDEO_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`worker video fetch returned ${res.status}`);
	const body = Buffer.from(await res.arrayBuffer());
	if (body.length === 0) throw new Error('worker returned an empty video');
	await putObject({ key, body, contentType: 'video/mp4' });
	return cdnUrl(key);
}

const PASS_THROUGH = ['mode', 'resolution', 'num_frames', 'fps', 'seed', 'queue_position', 'step', 'total_steps', 'progress', 'eta_seconds', 'upsampler', 'detail'];

// Poll a task. Never throws: an unreachable worker reads as still queued so the
// client keeps its job, and only terminal worker states end it.
export async function worldStatus(jobId, taskId) {
	let res;
	try {
		res = await fetch(`${baseUrl()}/tasks/${taskId}`, {
			headers: authHeaders({ accept: 'application/json' }),
			signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
		});
	} catch (err) {
		return { status: 'queued', diagnostic: `worker poll failed: ${err?.message}` };
	}
	if (res.status === 404) {
		return { status: 'failed', error_code: 'expired', diagnostic: 'worker has no record of this task' };
	}
	if (!res.ok) {
		return { status: 'queued', diagnostic: `worker poll returned ${res.status}: ${await readDetail(res)}` };
	}
	const task = await res.json().catch(() => null);
	if (!task || typeof task.status !== 'string') {
		return { status: 'queued', diagnostic: 'worker poll returned an unreadable record' };
	}
	const out = { status: task.status };
	for (const key of PASS_THROUGH) if (task[key] != null) out[key] = task[key];
	if (task.timings) out.timings = task.timings;

	if (task.status === 'failed') {
		out.error_code = task.error_code || 'generation_failed';
		out.worker_error = typeof task.error === 'string' ? task.error.slice(0, DETAIL_MAX) : null;
		return out;
	}
	if (task.status === 'done') {
		try {
			out.video_url = await persistOnce(jobId, taskId);
		} catch (err) {
			// The clip is safe in the worker bucket for 14 days; report "encoding"
			// so the next poll retries the copy instead of losing a finished world.
			return { ...out, status: 'encoding', diagnostic: `R2 copy failed: ${err?.message}` };
		}
	}
	return out;
}

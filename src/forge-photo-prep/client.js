/**
 * Main-thread side of on-device photo preparation. One lazily created worker
 * (worker.js) serves every photo; nothing loads until the visitor picks one.
 *
 *   const caps = await photoPrepSupport();      // { run, provider, reason }
 *   const result = await preparePhoto(file, { provider: caps.provider, onProgress });
 *
 * See README.md in this directory for the model and docs/forge-photo-prep.md
 * for the measurements behind the defaults.
 */

import { decideOnDevice, PREP_WAIT } from './core.js';

/** Content-addressed, so the server can cache it as immutable. */
export const MODEL_URL = '/models/photo-prep/u2netp.309c8469.onnx';
export const MODEL_BYTES = 4574861;
/**
 * Which on-device output the Forge uploads when the visitor confirms:
 * 'prepared' (square crop of the original pixels, opaque, the server still
 * mattes it) or 'cutout' (the crop with the on-device alpha). Chosen from the
 * production runs in docs/forge-photo-prep.md.
 */
export const DEFAULT_UPLOAD = 'prepared';
/** onnxruntime-web's wasm, staged by scripts/copy-voice-models.mjs and shared with the voice loop. */
export const RUNTIME_PATH = '/models/voice/runtime/';

let supportPromise = null;
let worker = null;
let nextId = 1;
const pending = new Map();

/** Whether this device runs the pass and on which provider. Cached for the page. */
export function photoPrepSupport() {
	if (!supportPromise) supportPromise = detect();
	return supportPromise;
}

async function detect() {
	const g = globalThis;
	let webgpu = false;
	if (g.navigator?.gpu) {
		try {
			webgpu = Boolean(await g.navigator.gpu.requestAdapter());
		} catch {
			webgpu = false;
		}
	}
	return decideOnDevice({
		worker: typeof g.Worker === 'function',
		wasm: typeof g.WebAssembly === 'object',
		offscreenCanvas: typeof g.OffscreenCanvas === 'function',
		createImageBitmap: typeof g.createImageBitmap === 'function',
		deviceMemory: g.navigator?.deviceMemory,
		webgpu,
	});
}

/** Reject every waiting job and drop the worker, so the next photo starts a fresh one. */
function resetWorker(err) {
	const dead = worker;
	worker = null;
	const jobs = [...pending.values()];
	pending.clear();
	for (const job of jobs) job.fail(err);
	dead?.terminate();
}

function getWorker() {
	if (worker) return worker;
	worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
	worker.onmessage = (e) => {
		const { id, type } = e.data || {};
		const job = pending.get(id);
		if (!job) return;
		job.touch(e.data);
		if (type === 'progress') {
			job.onProgress?.(e.data);
			return;
		}
		pending.delete(id);
		job.done();
		if (type === 'result') job.resolve(e.data.result);
		else job.reject(new Error(e.data.message || 'Photo check failed.'));
	};
	worker.onerror = (e) => resetWorker(new Error(e.message || 'Photo check worker crashed.'));
	return worker;
}

/** The error preparePhoto rejects with when the pass stalls or runs too long. */
export class PrepTimeoutError extends Error {
	constructor(message) {
		super(message);
		this.name = 'PrepTimeoutError';
		this.code = 'prep_timeout';
	}
}

/**
 * Run the on-device pass over one photo. Resolves with
 * { provider, removal, warnings[], metrics, plan, prepared: Blob|null, cutout: Blob|null, timings }.
 *
 * Bounded: silence from the worker for PREP_WAIT.loadIdleMs (runtime and model
 * loading) or PREP_WAIT.runIdleMs (inference and encoding), or the whole pass
 * passing PREP_WAIT.totalMs, rejects with PrepTimeoutError and replaces the
 * worker, so a stalled download or a hung worker never holds a generation.
 */
export function preparePhoto(file, { provider = 'wasm', onProgress, wait = PREP_WAIT } = {}) {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		let idleTimer = null;
		let totalTimer = null;
		let stage = 'runtime';
		const stop = () => {
			clearTimeout(idleTimer);
			clearTimeout(totalTimer);
		};
		const timeout = (what) => {
			if (!pending.has(id)) return;
			resetWorker(new PrepTimeoutError(`The photo check stopped responding (${what}).`));
		};
		const armIdle = () => {
			clearTimeout(idleTimer);
			const limit = stage === 'runtime' || stage === 'model' ? wait.loadIdleMs : wait.runIdleMs;
			idleTimer = setTimeout(() => timeout(`no progress in ${Math.round(limit / 1000)} s while ${stage}`), limit);
		};
		pending.set(id, {
			resolve,
			reject,
			onProgress,
			touch: (msg) => {
				if (msg.type === 'progress' && msg.stage) stage = msg.stage;
				armIdle();
			},
			done: stop,
			fail: (err) => {
				stop();
				reject(err);
			},
		});
		totalTimer = setTimeout(() => timeout(`over ${Math.round(wait.totalMs / 1000)} s in total`), wait.totalMs);
		armIdle();
		try {
			getWorker().postMessage({ type: 'prepare', id, file, provider, modelUrl: MODEL_URL, runtimePath: RUNTIME_PATH });
		} catch (err) {
			pending.delete(id);
			stop();
			reject(err);
		}
	});
}

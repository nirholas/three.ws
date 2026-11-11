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

import { decideOnDevice } from './core.js';

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

function getWorker() {
	if (worker) return worker;
	worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
	worker.onmessage = (e) => {
		const { id, type } = e.data || {};
		const job = pending.get(id);
		if (!job) return;
		if (type === 'progress') {
			job.onProgress?.(e.data);
			return;
		}
		pending.delete(id);
		if (type === 'result') job.resolve(e.data.result);
		else job.reject(new Error(e.data.message || 'Photo check failed.'));
	};
	worker.onerror = (e) => {
		const err = new Error(e.message || 'Photo check worker crashed.');
		for (const job of pending.values()) job.reject(err);
		pending.clear();
		worker.terminate();
		worker = null;
	};
	return worker;
}

/**
 * Run the on-device pass over one photo. Resolves with
 * { provider, warnings[], metrics, plan, prepared: Blob|null, cutout: Blob|null, timings }.
 */
export function preparePhoto(file, { provider = 'wasm', onProgress } = {}) {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject, onProgress });
		getWorker().postMessage({ type: 'prepare', id, file, provider, modelUrl: MODEL_URL, runtimePath: RUNTIME_PATH });
	});
}

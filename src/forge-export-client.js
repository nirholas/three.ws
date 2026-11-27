// Page-side driver for the in-browser export formats (OBJ, STL, PLY, USDZ),
// shared by the Forge and Forge Studio export menus.
//
// OBJ, STL and PLY run in src/forge-export-worker.js so a dense model never
// freezes the page. If the browser cannot start a module worker, the same code
// runs here instead (src/mesh-ops/client.js uses the same pattern). USDZ needs
// a canvas to write its textures, so it always runs on the page.
//
// Every phase is real and reported through `onPhase`: the download percentage
// comes from the response stream, the rest from the worker as it reaches each
// step. Running out of memory is caught and turned into an error that says how
// big the model is and what to download instead.

import {
	GEOMETRY_FORMATS,
	collectMeshes,
	isOutOfMemory,
	parseGlb,
	tooLargeMessage,
	writeGeometryFormat,
	writeUsdz,
} from './forge-export-core.js';
import { withoutTextures } from './forge-export-files.js';

const DRACO_PATH = '/three/draco/gltf/';

/** An export failure with a message written for the person, not the console. */
export class ExportError extends Error {
	constructor(message, { outOfMemory = false, cause } = {}) {
		super(message, cause ? { cause } : undefined);
		this.name = 'ExportError';
		this.outOfMemory = outOfMemory;
	}
}

function oomError(format, triangles, cause) {
	return new ExportError(tooLargeMessage(format, triangles), { outOfMemory: true, cause });
}

/** Fetch the model, reporting download progress when the size is known. */
async function fetchModel(url, onPhase) {
	const res = await fetch(url);
	if (!res.ok) throw new ExportError(`Could not download the model (HTTP ${res.status}). Try again in a moment.`);
	const total = Number(res.headers.get('content-length')) || 0;
	if (!res.body || !total) {
		onPhase('downloading');
		return res.arrayBuffer();
	}
	const out = new Uint8Array(total);
	const reader = res.body.getReader();
	let got = 0;
	let lastPct = -1;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (got + value.byteLength > total) {
			// The server under-reported the size (compressed transfer): fall back
			// to collecting the stream without a percentage.
			const chunks = [out.subarray(0, got), value];
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				chunks.push(next.value);
			}
			return new Blob(chunks).arrayBuffer();
		}
		out.set(value, got);
		got += value.byteLength;
		const pct = Math.floor((got / total) * 100);
		if (pct !== lastPct) {
			lastPct = pct;
			onPhase(`downloading ${pct}%`);
		}
	}
	return got === total ? out.buffer : out.slice(0, got).buffer;
}

// ---- worker ----------------------------------------------------------------

let workerPromise = null;
let workerBroken = false;
let nextId = 1;

function startWorker() {
	if (workerBroken || typeof Worker === 'undefined') return Promise.resolve(null);
	if (workerPromise) return workerPromise;
	workerPromise = new Promise((resolve) => {
		let w;
		try {
			w = new Worker(new URL('./forge-export-worker.js', import.meta.url), { type: 'module' });
		} catch {
			workerBroken = true;
			resolve(null);
			return;
		}
		const onReady = (e) => {
			if (e.data?.type !== 'ready') return;
			w.removeEventListener('message', onReady);
			w.removeEventListener('error', onLoadError);
			resolve(w);
		};
		// An error before 'ready' means the worker could not load at all (no
		// module-worker support, a blocked script): convert on the page instead.
		const onLoadError = (e) => {
			e.preventDefault?.();
			workerBroken = true;
			w.terminate();
			resolve(null);
		};
		w.addEventListener('message', onReady);
		w.addEventListener('error', onLoadError);
	});
	return workerPromise;
}

function runInWorker(worker, format, bytes, onPhase) {
	const id = nextId++;
	let triangles = 0;
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onCrash);
		};
		const onMessage = (e) => {
			const msg = e.data;
			if (msg?.id !== id) return;
			if (msg.triangles) triangles = msg.triangles;
			if (msg.type === 'phase') {
				onPhase(msg.phase === 'converting' && triangles ? `converting ${triangles.toLocaleString('en-US')} triangles` : msg.phase);
			} else if (msg.type === 'done') {
				cleanup();
				resolve(msg.bytes);
			} else if (msg.type === 'error') {
				cleanup();
				reject(
					msg.outOfMemory
						? oomError(format, triangles)
						: new ExportError(`Could not convert this model to ${format.toUpperCase()}: ${msg.message}`),
				);
			}
		};
		// A worker that dies mid-job without posting an error was killed by the
		// browser, which in practice means it ran out of memory. Start a fresh
		// one next time.
		const onCrash = (e) => {
			e.preventDefault?.();
			cleanup();
			worker.terminate();
			workerPromise = null;
			reject(oomError(format, triangles));
		};
		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onCrash);
		worker.postMessage({ id, format, bytes, dracoPath: DRACO_PATH }, [bytes]);
	});
}

async function runOnPage(format, bytes, onPhase) {
	let triangles = 0;
	try {
		onPhase('reading');
		const scene = await parseGlb(withoutTextures(bytes), { dracoPath: DRACO_PATH });
		const baked = collectMeshes(scene);
		triangles = baked.triangles;
		if (baked.meshes.length === 0) throw new ExportError('The model has no triangle meshes to export.');
		onPhase(`converting ${triangles.toLocaleString('en-US')} triangles`);
		return await writeGeometryFormat(format, baked.meshes);
	} catch (err) {
		if (err instanceof ExportError) throw err;
		if (isOutOfMemory(err)) throw oomError(format, triangles, err);
		throw new ExportError(`Could not convert this model to ${format.toUpperCase()}: ${err?.message || err}`, { cause: err });
	}
}

// ---- USDZ (page only) ------------------------------------------------------

let sceneCache = { url: null, scene: null };

/** Forget the cached scene (call when the model changes). */
export function resetExportCache() {
	sceneCache = { url: null, scene: null };
}

async function exportUsdz(url, onPhase) {
	let triangles = 0;
	try {
		let scene = sceneCache.url === url ? sceneCache.scene : null;
		if (!scene) {
			const bytes = await fetchModel(url, onPhase);
			onPhase('reading');
			scene = await parseGlb(bytes, { dracoPath: DRACO_PATH });
			sceneCache = { url, scene };
		}
		scene.traverse((o) => {
			if (o.isMesh && o.geometry) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
		});
		onPhase(`converting ${Math.round(triangles).toLocaleString('en-US')} triangles`);
		return await writeUsdz(scene);
	} catch (err) {
		if (err instanceof ExportError) throw err;
		if (isOutOfMemory(err)) throw oomError('usdz', triangles, err);
		throw new ExportError(`Could not convert this model to USDZ: ${err?.message || err}`, { cause: err });
	}
}

// ---- entry -----------------------------------------------------------------

/**
 * Convert the model at `url` to `format` in the browser.
 * @param {'obj'|'stl'|'ply'|'usdz'} format
 * @param {string} url  the model (a storage URL, or a blob: URL for a local edit)
 * @param {{ onPhase?: (label: string) => void }} [opts]
 * @returns {Promise<Uint8Array>}
 * @throws {ExportError}
 */
export async function exportInBrowser(format, url, { onPhase = () => {} } = {}) {
	if (format === 'usdz') return exportUsdz(url, onPhase);
	if (!GEOMETRY_FORMATS.includes(format)) throw new ExportError(`${format} is not converted in the browser.`);
	let bytes;
	try {
		bytes = await fetchModel(url, onPhase);
	} catch (err) {
		if (err instanceof ExportError) throw err;
		if (isOutOfMemory(err)) throw oomError(format, 0, err);
		throw new ExportError(`Could not download the model: ${err?.message || err}. Check your connection and try again.`, {
			cause: err,
		});
	}
	const worker = await startWorker();
	if (worker) return runInWorker(worker, format, bytes, onPhase);
	return runOnPage(format, bytes, onPhase);
}

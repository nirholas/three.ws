/**
 * Photo-prep worker: background removal and photo checks on the visitor's
 * device, before anything is uploaded.
 *
 *   photo ─▶ U²-Netp (ONNX Runtime Web, WebGPU or WASM) ─▶ 320 px mask
 *         ─▶ subject box, square crop plan, sharpness / exposure / blob checks
 *         ─▶ prepared image (crop of the original pixels) + cutout preview
 *
 * A photo that is already cut out (transparent background) skips the model: its
 * own alpha is the mask and the upload is its alpha crop. A mask that is empty
 * or kept the whole frame is a failed removal: no crop is offered, only the
 * original.
 *
 * Messages in:  { type: 'prepare', id, file, provider, modelUrl, runtimePath }
 * Messages out: { type: 'progress', id, stage: 'model'|'runtime'|'inference'|'encode', loaded?, total? }
 *               { type: 'result', id, result } | { type: 'error', id, message }
 *
 * The session is created once and reused for every later photo.
 */

import {
	MODEL_SIZE,
	THRESHOLDS,
	buildInputTensor,
	normalizeMask,
	analyzeMask,
	maskBoxToImage,
	squareCropPlan,
	laplacianVariance,
	toGray,
	exposureStats,
	assessPhoto,
	alphaChannel,
	detectCutout,
	maskVerdict,
} from './core.js';

const MODEL_CACHE = 'three-ws-photo-prep-v1';

let sessionPromise = null;
let sessionProvider = null;

self.onmessage = async (event) => {
	const msg = event.data;
	if (msg?.type !== 'prepare') return;
	const post = (data) => self.postMessage({ id: msg.id, ...data });
	try {
		const result = await prepare(msg, (p) => post({ type: 'progress', ...p }));
		post({ type: 'result', result });
	} catch (err) {
		post({ type: 'error', message: err?.message || String(err) });
	}
};

async function prepare({ file, provider, modelUrl, runtimePath }, progress) {
	const t0 = performance.now();
	// Only a format that can carry transparency may already be cut out. Those are
	// decoded before the model starts loading, so a cut-out never downloads it;
	// a JPEG cannot have alpha, so its model load overlaps the decode.
	const mayHaveAlpha = file.type !== 'image/jpeg';
	let sessionReady = mayHaveAlpha ? null : getSession(provider, modelUrl, runtimePath, progress);
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	const small = drawScaled(bitmap, MODEL_SIZE, MODEL_SIZE);
	const alpha = mayHaveAlpha ? detectCutout(small.data, MODEL_SIZE) : { cutout: false };

	let mask;
	let used;
	let tLoaded;
	if (alpha.cutout) {
		mask = alphaChannel(small.data);
		used = 'alpha';
		tLoaded = performance.now();
	} else {
		sessionReady ??= getSession(provider, modelUrl, runtimePath, progress);
		const loaded = await sessionReady;
		used = loaded.provider;
		tLoaded = performance.now();
		progress({ stage: 'inference' });
		const input = buildInputTensor(small.data, MODEL_SIZE);
		const outputs = await loaded.session.run({
			[loaded.session.inputNames[0]]: new loaded.ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]),
		});
		mask = normalizeMask(outputs[loaded.session.outputNames[0]].data);
		for (const t of Object.values(outputs)) t.dispose?.();
	}
	const tInfer = performance.now();

	const W = bitmap.width;
	const H = bitmap.height;
	const analysis = analyzeMask(mask, MODEL_SIZE, MODEL_SIZE);
	const exposure = exposureStats(small.data, mask);
	const timings = () => ({
		modelMs: Math.round(tLoaded - t0),
		inferenceMs: Math.round(tInfer - tLoaded),
		totalMs: Math.round(performance.now() - t0),
	});

	const verdict = maskVerdict(analysis);
	if (!verdict.ok) {
		bitmap.close();
		return {
			provider: used,
			width: W,
			height: H,
			removal: { status: 'failed', reason: verdict.reason },
			warnings: assessPhoto({ ...analysis, subjectPx: 0, sharpness: 0, exposure }),
			metrics: { coverage: analysis.coverage, components: analysis.components.length },
			prepared: null,
			cutout: null,
			timings: timings(),
		};
	}

	const box = maskBoxToImage(analysis.box, MODEL_SIZE, W, H);
	const plan = squareCropPlan(box, W, H, { center: alpha.cutout });
	const maskCanvas = maskToCanvas(mask);
	const sharpness = measureSharpness(bitmap, maskCanvas, plan, W, H);
	const metrics = {
		coverage: analysis.coverage,
		subjectPx: Math.max(box.w, box.h),
		components: analysis.components,
		touchesEdge: analysis.touchesEdge,
		sharpness,
		exposure,
	};
	const warnings = assessPhoto(metrics);

	progress({ stage: 'encode' });
	let prepared;
	let cutout;
	if (alpha.cutout) {
		// The photo's own alpha, centred and padded: uploaded as is, never re-matted.
		cutout = await renderAlphaCrop(bitmap, plan);
		prepared = cutout;
	} else {
		prepared = await renderPrepared(bitmap, plan);
		cutout = await renderCutout(bitmap, maskCanvas, plan, W, H);
	}
	bitmap.close();

	return {
		provider: used,
		width: W,
		height: H,
		box,
		plan,
		removal: { status: alpha.cutout ? 'alpha' : 'model', reason: null },
		warnings,
		metrics: { ...metrics, components: analysis.components.length, secondBlobRatio: analysis.components[1] ? analysis.components[1] / analysis.components[0] : 0 },
		prepared,
		cutout,
		timings: timings(),
	};
}

function getSession(provider, modelUrl, runtimePath, progress) {
	if (sessionPromise && sessionProvider === provider) return sessionPromise;
	sessionProvider = provider;
	sessionPromise = (async () => {
		progress({ stage: 'runtime' });
		const ort = provider === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
		ort.env.wasm.wasmPaths = runtimePath;
		ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
		ort.env.logLevel = 'error';
		const bytes = await fetchModel(modelUrl, progress);
		if (provider === 'webgpu') {
			try {
				const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
				return { session, ort, provider: 'webgpu' };
			} catch {
				// An adapter that exists but cannot compile this graph: the WASM
				// provider in the same bundle still runs it.
			}
		}
		const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
		return { session, ort, provider: 'wasm' };
	})();
	sessionPromise.catch(() => {
		sessionPromise = null;
	});
	return sessionPromise;
}

/** The model bytes, from the Cache API when a previous visit stored them. */
async function fetchModel(url, progress) {
	let cache = null;
	try {
		cache = await caches.open(MODEL_CACHE);
		const hit = await cache.match(url);
		if (hit) {
			const buf = new Uint8Array(await hit.arrayBuffer());
			progress({ stage: 'model', loaded: buf.length, total: buf.length, cached: true });
			return buf;
		}
	} catch {
		cache = null; // storage blocked (private mode): fetch every time
	}
	const res = await fetch(url);
	if (!res.ok || !res.body) throw new Error(`Photo check model unavailable (HTTP ${res.status}).`);
	const total = Number(res.headers.get('content-length')) || 0;
	const reader = res.body.getReader();
	const chunks = [];
	let loaded = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.length;
		progress({ stage: 'model', loaded, total });
	}
	const buf = new Uint8Array(loaded);
	let off = 0;
	for (const c of chunks) {
		buf.set(c, off);
		off += c.length;
	}
	if (cache) {
		try {
			await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
		} catch {
			// quota exceeded: still usable this session
		}
	}
	return buf;
}

function drawScaled(bitmap, w, h) {
	const c = new OffscreenCanvas(w, h);
	const ctx = c.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(bitmap, 0, 0, w, h);
	return ctx.getImageData(0, 0, w, h);
}

/** The 320 px mask as an alpha-only canvas, so it upsamples with bilinear filtering. */
function maskToCanvas(mask) {
	const c = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
	const ctx = c.getContext('2d');
	const img = ctx.createImageData(MODEL_SIZE, MODEL_SIZE);
	for (let i = 0; i < mask.length; i++) {
		img.data[i * 4] = 255;
		img.data[i * 4 + 1] = 255;
		img.data[i * 4 + 2] = 255;
		img.data[i * 4 + 3] = mask[i];
	}
	ctx.putImageData(img, 0, 0);
	return c;
}

/** Draw the source so that the plan's square fills an n x n canvas. */
function drawPlan(ctx, source, plan, n, W, H) {
	const k = n / plan.side;
	ctx.drawImage(source, -plan.sx * k, -plan.sy * k, W * k, H * k);
}

function measureSharpness(bitmap, maskCanvas, plan, W, H) {
	// Always the same scale, so a small crop is not scored at a flattering 1:1.
	const n = THRESHOLDS.sharpnessSide;
	const c = new OffscreenCanvas(n, n);
	const ctx = c.getContext('2d', { willReadFrequently: true });
	drawPlan(ctx, bitmap, plan, n, W, H);
	const gray = toGray(ctx.getImageData(0, 0, n, n).data);
	ctx.clearRect(0, 0, n, n);
	drawPlan(ctx, maskCanvas, plan, n, W, H);
	const m = ctx.getImageData(0, 0, n, n).data;
	const weight = new Uint8Array(n * n);
	for (let i = 0; i < weight.length; i++) weight[i] = m[i * 4 + 3];
	return laplacianVariance(gray, n, n, weight);
}

/**
 * The prepared upload: the square crop of the original pixels, opaque, at most
 * THRESHOLDS.maxSide on an edge. Padding beyond the photo is white.
 */
async function renderPrepared(bitmap, plan) {
	const n = plan.outSize;
	const c = new OffscreenCanvas(n, n);
	const ctx = c.getContext('2d');
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, n, n);
	ctx.imageSmoothingQuality = 'high';
	drawPlan(ctx, bitmap, plan, n, bitmap.width, bitmap.height);
	return c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

/** The same square with the on-device mask applied, for the preview and the alpha option. */
async function renderCutout(bitmap, maskCanvas, plan, W, H) {
	const n = plan.outSize;
	const c = new OffscreenCanvas(n, n);
	const ctx = c.getContext('2d');
	ctx.imageSmoothingQuality = 'high';
	drawPlan(ctx, bitmap, plan, n, W, H);
	ctx.globalCompositeOperation = 'destination-in';
	drawPlan(ctx, maskCanvas, plan, n, W, H);
	const webp = await c.convertToBlob({ type: 'image/webp', quality: 0.92 });
	return webp.type === 'image/webp' ? webp : c.convertToBlob({ type: 'image/png' });
}

/** An already cut-out photo's own pixels and alpha in the plan's square, never upscaled. */
async function renderAlphaCrop(bitmap, plan) {
	const n = plan.outSize;
	const c = new OffscreenCanvas(n, n);
	const ctx = c.getContext('2d');
	ctx.imageSmoothingQuality = 'high';
	drawPlan(ctx, bitmap, plan, n, bitmap.width, bitmap.height);
	const webp = await c.convertToBlob({ type: 'image/webp', quality: 0.95 });
	return webp.type === 'image/webp' ? webp : c.convertToBlob({ type: 'image/png' });
}

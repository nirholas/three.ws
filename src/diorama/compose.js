// Diorama — generation orchestration.
//
// One sentence becomes a tiny explorable 3D world in two acts:
//
//   1. COMPOSE — POST /api/diorama {action:'compose'} asks the platform's
//      free-first LLM chain to decompose the sentence into a placed *plan*:
//      a mood, palette, ground, island shape, and a handful of single-object
//      forge prompts (each object status:'pending', no mesh yet).
//
//   2. FORGE — every object's prompt is turned into a real GLB on the EXISTING
//      free text→3D lane (POST /api/forge {tier:'draft', path:'image'}). Forges
//      run a few at a time so the world materializes progressively, and a failed
//      object never sinks the whole world — partial worlds are real and shareable.
//
// A third act runs for PHOTO worlds (composeWorldFromPhoto): the photo is read
// by the vision chain (POST /api/diorama {action:'compose-photo'}), every
// fully visible object is cropped out of the photo and forged image→3D so it
// keeps the real thing's shape and colour, and anything occluded or too small
// to crop is forged from the description the vision model wrote for it. A crop
// that fails to forge falls back to that description, so a photo world never
// loses an object to one lane being down.
//
// This module owns only the orchestration + the per-browser client identity.
// The shape of a Diorama lives in ./schema.js; the controller (./main.js) drives
// the DOM from the callbacks below.

import { normalizeDiorama, MAX_PROMPT_LEN } from './schema.js';

// ── Per-browser identity ────────────────────────────────────────────────────
// A stable id so forge jobs are scoped per browser (sent as `x-forge-client`).
// Persisted in localStorage; falls back to a fresh UUID, and degrades to an
// in-memory id if storage is unavailable (private mode) so forging still works.
export const CLIENT_ID = resolveClientId();

function resolveClientId() {
	const KEY = 'dio_client';
	const fresh = () =>
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `dio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	try {
		const existing = localStorage.getItem(KEY);
		if (existing) return existing;
		const id = fresh();
		localStorage.setItem(KEY, id);
		return id;
	} catch {
		return fresh();
	}
}

// ── Tuning ──────────────────────────────────────────────────────────────────
const FORGE_CONCURRENCY = 3; // objects forged at once on the free lane
const POLL_INTERVAL_MS = 2500; // how often a queued forge job is polled
const FORGE_DEADLINE_MS = 180_000; // 3 min per object before we mark it failed
// Image→3D runs on self-hosted GPU workers that may need a cold start, so a
// crop gets longer before it falls back to the text lane.
const IMAGE_FORGE_DEADLINE_MS = 300_000;
const FORGE_ENDPOINT = '/api/forge';
const PHOTO_MAX_SIDE = 1600; // px; the photo is downscaled to this before upload
const INLINE_MAX_SIDE = 1024; // px; the no-storage fallback sends a smaller photo inline
const INLINE_MAX_BYTES = 650_000; // under the API's 700 KB inline cap
const CROP_PAD = 0.12; // each crop keeps this fraction of the box as margin
const CROP_MIN_SIDE = 512; // px; small crops are upscaled so image→3D sees detail
const CROP_MAX_SIDE = 1024;

const sleep = (ms, signal) =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortError());
		const t = setTimeout(() => {
			signal?.removeEventListener?.('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(t);
			reject(abortError());
		};
		signal?.addEventListener?.('abort', onAbort, { once: true });
	});

function abortError() {
	const e = new Error('Cancelled.');
	e.name = 'AbortError';
	e.code = 'aborted';
	return e;
}

const forgeHeaders = () => ({ 'content-type': 'application/json', 'x-forge-client': CLIENT_ID });

/**
 * Compose a world from a sentence, then forge every object into a real mesh.
 *
 * @param {string} prompt                       the user's sentence
 * @param {Object} [opts]
 * @param {(diorama:import('./schema.js').Diorama)=>void} [opts.onPlan]
 *        called once the plan returns, before any mesh exists, so the UI can
 *        render the island + seeds + object chips immediately.
 * @param {(objectId:string, patch:{status:string, glbUrl?:string})=>void} [opts.onObject]
 *        called as each object moves through forging → ready | failed.
 * @param {AbortSignal} [opts.signal]           abort the compose + all forges.
 * @returns {Promise<import('./schema.js').Diorama>} the final, populated diorama.
 */
export async function composeWorld(prompt, { onPlan, onObject, signal } = {}) {
	const sentence = String(prompt ?? '')
		.slice(0, MAX_PROMPT_LEN)
		.trim();
	if (!sentence) {
		const e = new Error('Describe your world in a sentence.');
		e.code = 'prompt_required';
		throw e;
	}

	// ── 1. Compose the plan ──────────────────────────────────────────────────
	let payload;
	try {
		const res = await fetch('/api/diorama', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'compose', prompt: sentence }),
			signal,
		});
		payload = await res.json().catch(() => ({}));
		if (!res.ok) {
			const e = new Error(payload?.message || `The composer returned ${res.status}.`);
			e.code = payload?.error || 'compose_failed';
			throw e;
		}
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		if (err instanceof TypeError) {
			// Network boundary: fetch itself failed (offline, DNS, CORS).
			const e = new Error('Could not reach the world composer. Check your connection and try again.');
			e.code = 'network';
			throw e;
		}
		throw err;
	}

	// Normalize the untrusted plan into a guaranteed-renderable diorama.
	const { ok, diorama, errors } = normalizeDiorama(payload?.diorama);
	if (!ok || !diorama.objects.length) {
		const e = new Error('The composer could not place that world. Try a more concrete sentence.');
		e.code = 'compose_invalid';
		e.detail = errors;
		throw e;
	}
	// Plan objects start clean: pending, no mesh.
	for (const o of diorama.objects) {
		o.status = 'pending';
		o.glbUrl = null;
	}

	onPlan?.(diorama);

	// ── 2. Forge every object with bounded concurrency ───────────────────────
	await forgeAll(diorama, { signal, onObject });

	return diorama;
}

/**
 * Forge a single object's mesh. An object with a `refImage` (its crop of the
 * source photo) goes image→3D first; everything else, and any image forge that
 * fails, goes through the free text→3D lane. Resolves with
 * `{ status:'ready', glbUrl, forgeFrom? }` on success or `{ status:'failed' }`
 * on any failure or timeout. It never throws for a forge failure (a partial
 * world is fine), but it DOES propagate an AbortError so the controller can
 * stop cleanly.
 *
 * Exported so the controller can retry one failed object in place.
 *
 * @param {import('./schema.js').DioramaObject} object
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {(objectId:string, patch:{status:string, glbUrl?:string, forgeFrom?:string})=>void} [opts.onObject]
 * @returns {Promise<{status:'ready'|'failed', glbUrl:string|null, forgeFrom?:string}>}
 */
export async function forgeObject(object, { signal, onObject } = {}) {
	onObject?.(object.id, { status: 'forging' });
	// A photo object with an uploaded crop forges image→3D first; any failure
	// there falls through to its text description rather than failing the piece.
	if (object.refImage) {
		try {
			const glbUrl = await runForge({ image_urls: [object.refImage], tier: 'draft' }, signal, IMAGE_FORGE_DEADLINE_MS);
			if (glbUrl) {
				onObject?.(object.id, { status: 'ready', glbUrl, forgeFrom: 'photo' });
				return { status: 'ready', glbUrl, forgeFrom: 'photo' };
			}
		} catch (err) {
			if (err?.name === 'AbortError') throw err;
		}
	}
	try {
		const glbUrl = await runForge({ prompt: object.prompt, tier: 'draft', path: 'image' }, signal, FORGE_DEADLINE_MS);
		if (glbUrl) {
			const patch = { status: 'ready', glbUrl, ...(object.forgeFrom ? { forgeFrom: 'text' } : {}) };
			onObject?.(object.id, patch);
			return patch;
		}
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		// Any other failure is non-fatal: this object simply didn't materialize.
	}
	onObject?.(object.id, { status: 'failed' });
	return { status: 'failed', glbUrl: null };
}

// Kick a single free-lane forge and resolve to a durable GLB url (or throw).
async function runForge(request, signal, deadlineMs) {
	const res = await fetch(FORGE_ENDPOINT, {
		method: 'POST',
		headers: forgeHeaders(),
		body: JSON.stringify(request),
		signal,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data?.message || `The forge returned ${res.status}.`);
	}
	// The sync lane can return the finished mesh immediately (job_id null).
	if (data.status === 'done' && data.glb_url) return data.glb_url;
	if (data.status === 'failed') throw new Error(data.error || 'Forge failed.');
	if (!data.job_id) throw new Error('The forge did not start a job.');
	return pollForge(data.job_id, signal, deadlineMs);
}

// Poll a queued forge job until it produces a mesh, fails, or hits the deadline.
async function pollForge(jobId, signal, deadlineMs = FORGE_DEADLINE_MS) {
	const deadline = Date.now() + deadlineMs;
	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS, signal);
		const res = await fetch(`${FORGE_ENDPOINT}?job=${encodeURIComponent(jobId)}`, {
			headers: { 'x-forge-client': CLIENT_ID },
			signal,
		});
		const data = await res.json().catch(() => ({}));
		if (data.status === 'done' && data.glb_url) return data.glb_url;
		if (data.status === 'failed') throw new Error(data.error || 'Forge failed.');
		// queued | running → keep polling.
	}
	throw new Error('This piece took too long to forge.');
}

/**
 * Forge every object of a plan, FORGE_CONCURRENCY at a time, writing each
 * result back onto the plan's own objects. `prepare(object)` runs inside the
 * object's slot before it forges (the photo flow crops and uploads there, so
 * crops overlap with other objects' forges instead of blocking the queue).
 */
async function forgeAll(diorama, { signal, onObject, prepare } = {}) {
	const queue = diorama.objects.slice();
	async function worker() {
		for (;;) {
			if (signal?.aborted) throw abortError();
			const object = queue.shift();
			if (!object) return;
			if (prepare) await prepare(object);
			const result = await forgeObject(object, { signal, onObject });
			object.status = result.status;
			object.glbUrl = result.glbUrl ?? null;
			if (result.forgeFrom) object.forgeFrom = result.forgeFrom;
		}
	}
	await Promise.all(Array.from({ length: Math.min(FORGE_CONCURRENCY, queue.length) }, worker));
}

// ── Photo worlds ────────────────────────────────────────────────────────────

/**
 * Rebuild a photo as a diorama: read it, place every object where it is in the
 * photo, then forge each one (from its crop where it is fully visible).
 *
 * @param {Blob|string} source   a photo File/Blob, or the https URL of a photo
 *                               already on storage (remixing a saved photo world)
 * @param {Object} [opts]
 * @param {(stage:'reading'|'uploading'|'analyzing'|'forging')=>void} [opts.onStage]
 * @param {(diorama:object, photo:{src:string, width:number, height:number})=>void} [opts.onPlan]
 * @param {(objectId:string, patch:object)=>void} [opts.onObject]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object>} the final, populated diorama.
 */
export async function composeWorldFromPhoto(source, { onStage, onPlan, onObject, signal } = {}) {
	onStage?.('reading');
	const photo = await loadPhoto(source);
	if (signal?.aborted) throw abortError();

	// ── 1. Put the photo somewhere the vision chain and image→3D can read it ──
	let request;
	let storageUsable = true;
	if (typeof source === 'string') {
		request = { imageUrl: source };
	} else {
		onStage?.('uploading');
		try {
			const blob = await canvasToBlob(photo.canvas, 'image/jpeg', 0.9);
			request = { imageUrl: await uploadImage(blob, signal) };
		} catch (err) {
			if (err?.name === 'AbortError') throw err;
			// No storage on this deployment (or it is refusing uploads): send the
			// photo inline. Crops need storage too, so every object then forges
			// from its description instead of failing.
			storageUsable = false;
			request = { imageBase64: await inlinePhoto(photo.canvas) };
		}
	}

	// ── 2. Read the scene ─────────────────────────────────────────────────────
	onStage?.('analyzing');
	const payload = await postDiorama({ action: 'compose-photo', ...request }, signal);
	const { ok, diorama, errors } = normalizeDiorama(payload?.diorama);
	if (!ok || !diorama.objects.length) {
		const e = new Error('Could not place the objects from that photo. Try another shot.');
		e.code = 'compose_invalid';
		e.detail = errors;
		throw e;
	}
	for (const o of diorama.objects) {
		o.status = 'pending';
		o.glbUrl = null;
	}
	onPlan?.(diorama, { src: photo.src, width: photo.width, height: photo.height });

	// ── 3. Crop + forge ───────────────────────────────────────────────────────
	onStage?.('forging');
	const canCrop = storageUsable && !photo.tainted;
	await forgeAll(diorama, {
		signal,
		onObject,
		prepare: async (object) => {
			if (!canCrop || object.forgeFrom !== 'photo' || !object.box || object.refImage) return;
			try {
				const blob = await canvasToBlob(cropToCanvas(photo.canvas, object.box), 'image/jpeg', 0.92);
				object.refImage = await uploadImage(blob, signal);
				onObject?.(object.id, { refImage: object.refImage });
			} catch (err) {
				if (err?.name === 'AbortError') throw err;
				// The crop could not be stored: this object forges from its description.
			}
		},
	});
	return diorama;
}

// POST to /api/diorama and return the JSON body, mapping failures to errors
// that carry the API's code and a message a person can act on.
async function postDiorama(body, signal) {
	let res;
	try {
		res = await fetch('/api/diorama', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal,
		});
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		const e = new Error('Could not reach the world composer. Check your connection and try again.');
		e.code = 'network';
		throw e;
	}
	const payload = await res.json().catch(() => ({}));
	if (!res.ok) {
		const e = new Error(payload?.message || `The composer returned ${res.status}.`);
		e.code = payload?.error || 'compose_failed';
		throw e;
	}
	return payload;
}

/**
 * Decode a photo (EXIF orientation applied) onto a canvas no larger than
 * PHOTO_MAX_SIDE. `tainted` is true when the pixels cannot be read back (a
 * cross-origin URL without CORS), in which case crops are skipped.
 */
export async function loadPhoto(source) {
	let image;
	let src;
	if (typeof source === 'string') {
		src = source;
		const load = (cors) =>
			new Promise((resolve, reject) => {
				const img = new Image();
				if (cors) img.crossOrigin = 'anonymous';
				img.decoding = 'async';
				img.onload = () => resolve(img);
				img.onerror = () => {
					const e = new Error('Could not load that photo. It may have been removed.');
					e.code = 'photo_load_failed';
					reject(e);
				};
				img.src = source;
			});
		// A host without CORS headers fails the anonymous load outright; loading
		// it plainly still shows the photo (the canvas is then tainted and the
		// objects forge from their descriptions instead of crops).
		image = await load(true).catch(() => load(false));
	} else {
		if (!source || !/^image\/(png|jpeg|webp|gif|avif|heic|heif)$/i.test(source.type || '')) {
			const e = new Error('That file is not a photo. Use a JPEG, PNG or WebP image.');
			e.code = 'photo_type';
			throw e;
		}
		try {
			image = await createImageBitmap(source, { imageOrientation: 'from-image' });
		} catch {
			const e = new Error('Could not open that photo. Try a JPEG or PNG.');
			e.code = 'photo_decode';
			throw e;
		}
		src = URL.createObjectURL(source);
	}
	const w0 = image.naturalWidth || image.width;
	const h0 = image.naturalHeight || image.height;
	const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(w0, h0));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(w0 * k));
	canvas.height = Math.max(1, Math.round(h0 * k));
	canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
	image.close?.();
	let tainted = false;
	try {
		canvas.getContext('2d').getImageData(0, 0, 1, 1);
	} catch {
		tainted = true;
	}
	return { canvas, src, width: canvas.width, height: canvas.height, tainted };
}

/** Cut one object out of the photo with a margin, sized for image→3D. */
export function cropToCanvas(photoCanvas, box) {
	const W = photoCanvas.width;
	const H = photoCanvas.height;
	const [x0, y0, x1, y1] = box;
	const padX = (x1 - x0) * CROP_PAD;
	const padY = (y1 - y0) * CROP_PAD;
	const sx = Math.max(0, Math.floor((x0 - padX) * W));
	const sy = Math.max(0, Math.floor((y0 - padY) * H));
	const sw = Math.max(1, Math.min(W, Math.ceil((x1 + padX) * W)) - sx);
	const sh = Math.max(1, Math.min(H, Math.ceil((y1 + padY) * H)) - sy);
	const longest = Math.max(sw, sh);
	const k = longest < CROP_MIN_SIDE ? CROP_MIN_SIDE / longest : Math.min(1, CROP_MAX_SIDE / longest);
	const out = document.createElement('canvas');
	out.width = Math.max(1, Math.round(sw * k));
	out.height = Math.max(1, Math.round(sh * k));
	const ctx = out.getContext('2d');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(photoCanvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
	return out;
}

function canvasToBlob(canvas, type, quality) {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), type, quality);
	});
}

// The no-storage fallback: a smaller JPEG as a data URL, stepping quality
// down until it fits under the API's inline cap.
async function inlinePhoto(canvas) {
	const k = Math.min(1, INLINE_MAX_SIDE / Math.max(canvas.width, canvas.height));
	const small = document.createElement('canvas');
	small.width = Math.max(1, Math.round(canvas.width * k));
	small.height = Math.max(1, Math.round(canvas.height * k));
	small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
	for (const q of [0.85, 0.72, 0.6, 0.48]) {
		const url = small.toDataURL('image/jpeg', q);
		if ((url.length - url.indexOf(',') - 1) * 0.75 <= INLINE_MAX_BYTES) return url;
	}
	const e = new Error('That photo is too detailed to send. Try a smaller image.');
	e.code = 'photo_too_large';
	throw e;
}

/** Upload an image blob through /api/forge-upload's presigned PUT; resolves to its public URL. */
async function uploadImage(blob, signal) {
	const presignRes = await fetch('/api/forge-upload', {
		method: 'POST',
		headers: forgeHeaders(),
		body: JSON.stringify({ content_type: blob.type, size_bytes: blob.size }),
		signal,
	});
	const presign = await presignRes.json().catch(() => ({}));
	if (!presignRes.ok || !presign.upload_url || !presign.public_url) {
		const e = new Error(presign?.message || `Upload unavailable (${presignRes.status}).`);
		e.code = presign?.error || 'upload_unavailable';
		throw e;
	}
	const putRes = await fetch(presign.upload_url, {
		method: presign.method || 'PUT',
		headers: presign.headers || { 'content-type': blob.type },
		body: blob,
		signal,
	});
	if (!putRes.ok) {
		const e = new Error(`Upload failed (${putRes.status}).`);
		e.code = 'upload_failed';
		throw e;
	}
	return presign.public_url;
}

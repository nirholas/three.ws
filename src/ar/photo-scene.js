// photo-scene: the AR Studio "From a photo" lane, client half.
//
// One photo of a room in, one GLB with a node per object out (SAM 3D Objects,
// workers/model-sam3d-objects, behind /api/forge-scene-objects). Four legs, each
// with its own failure vocabulary so the tray can say what actually went wrong:
//
//   1. probe:   GET  /api/forge-scene-objects?status   is the lane on, here?
//   2. prepare: decode any photo the browser can read (a camera frame, a picked
//               file, iPhone HEIC included where Safari decodes it), cap the long
//               edge, re-encode as JPEG. The worker accepts PNG/JPEG/WebP only
//               and a 12 MP original is wasted upload on a phone connection.
//   3. upload:  POST /api/forge-upload presigns, the browser PUTs straight to
//               object storage, the public URL goes to the worker. A pasted
//               https link skips this leg.
//   4. job:     POST /api/forge-scene-objects, then poll ?job=<id> until done.
//
// DOM use is limited to canvas/bitmap work in prepare and captureFrame; the
// network legs take an injectable fetch so they are unit-tested directly.

export const PHOTO_MAX_EDGE_PX = 2048;
export const PHOTO_JPEG_QUALITY = 0.9;
/** Larger than this and the original is refused before decoding (a phone RAW, a panorama). */
export const PHOTO_MAX_INPUT_BYTES = 40 * 1024 * 1024;
/** Matches ANON_UPLOAD_LIMITS['forge/uploads/'] on the server. */
export const PHOTO_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const POLL_INTERVAL_MS = 4000;
/** A cold 96 GB GPU instance loads the weights before the first job runs. */
export const POLL_DEADLINE_MS = 20 * 60 * 1000;

export class PhotoSceneError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'PhotoSceneError';
		this.code = code;
	}
}

async function readBody(res) {
	return res.json().catch(() => ({}));
}

function networkError(err) {
	if (err?.name === 'AbortError') return err;
	return new PhotoSceneError('No connection. Check your network and try again.', 'network');
}

/**
 * Ask whether the lane is switched on for this visitor. Never throws: a probe
 * that cannot reach the server reports that as its reason.
 *
 * @returns {Promise<{ available: boolean, reason: string|null, message: string|null, maxObjects: number, defaultObjects: number }>}
 */
export async function probePhotoScene({ fetchImpl = fetch, signal } = {}) {
	try {
		const res = await fetchImpl('/api/forge-scene-objects?status', { credentials: 'include', signal });
		const body = await readBody(res);
		if (!res.ok) {
			return { available: false, reason: 'probe_failed', message: body.message || `Status check failed (${res.status}).`, maxObjects: 12, defaultObjects: 8 };
		}
		return {
			available: body.available === true,
			reason: body.reason ?? null,
			message: body.message ?? null,
			maxObjects: Number(body.max_objects) || 12,
			defaultObjects: Number(body.default_objects) || 8,
		};
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		return { available: false, reason: 'network', message: 'Could not reach three.ws to check this feature.', maxObjects: 12, defaultObjects: 8 };
	}
}

/**
 * Long-edge cap for a photo, preserving aspect ratio. Pure.
 *
 * @returns {{ width: number, height: number }}
 */
export function fitPhotoSize(width, height, maxEdge = PHOTO_MAX_EDGE_PX) {
	const w = Math.max(1, Math.round(Number(width) || 1));
	const h = Math.max(1, Math.round(Number(height) || 1));
	const k = Math.min(1, maxEdge / Math.max(w, h));
	return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

function canvasToJpeg(source, width, height) {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new PhotoSceneError('This browser cannot prepare the photo.', 'decode_failed');
	ctx.drawImage(source, 0, 0, width, height);
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new PhotoSceneError('This browser cannot prepare the photo.', 'decode_failed'))),
			'image/jpeg',
			PHOTO_JPEG_QUALITY,
		);
	});
}

/**
 * Decode a picked photo, apply its EXIF orientation, cap the long edge and
 * re-encode as JPEG.
 *
 * @param {Blob} file
 * @returns {Promise<Blob>} image/jpeg
 */
export async function preparePhoto(file) {
	if (!file || !file.size) throw new PhotoSceneError('That file is empty. Choose another photo.', 'empty');
	if (file.type && !file.type.startsWith('image/')) {
		throw new PhotoSceneError('That is not a photo. Choose a JPG, PNG, WebP or HEIC image.', 'not_image');
	}
	if (file.size > PHOTO_MAX_INPUT_BYTES) {
		throw new PhotoSceneError('That photo is larger than 40 MB. Choose a smaller one.', 'too_large');
	}
	let bitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		throw new PhotoSceneError('This browser cannot read that photo. Try a JPG or PNG.', 'decode_failed');
	}
	try {
		const { width, height } = fitPhotoSize(bitmap.width, bitmap.height);
		return await canvasToJpeg(bitmap, width, height);
	} finally {
		bitmap.close?.();
	}
}

/**
 * Grab what the live camera sees right now (the raw passthrough frame, without
 * the placed models drawn over it) as a JPEG.
 *
 * @param {HTMLVideoElement} video
 * @returns {Promise<Blob>}
 */
export async function captureFrame(video) {
	if (!video || !video.videoWidth || !video.videoHeight) {
		throw new PhotoSceneError('The camera has no picture yet. Wait a moment and try again.', 'no_frame');
	}
	const { width, height } = fitPhotoSize(video.videoWidth, video.videoHeight);
	return canvasToJpeg(video, width, height);
}

function clientHeaders(clientId) {
	return { 'content-type': 'application/json', 'x-forge-client': clientId };
}

/**
 * Upload a prepared photo and return its public URL.
 *
 * @param {Blob} blob  image/jpeg from preparePhoto or captureFrame.
 */
export async function uploadPhoto(blob, { clientId, fetchImpl = fetch, signal } = {}) {
	if (blob.size > PHOTO_MAX_UPLOAD_BYTES) {
		throw new PhotoSceneError('That photo is still larger than 8 MB after resizing. Choose a simpler one.', 'too_large');
	}
	let presignRes;
	let presign;
	try {
		presignRes = await fetchImpl('/api/forge-upload', {
			method: 'POST',
			headers: clientHeaders(clientId),
			body: JSON.stringify({ content_type: blob.type || 'image/jpeg', size_bytes: blob.size }),
			signal,
		});
		presign = await readBody(presignRes);
	} catch (err) {
		throw networkError(err);
	}
	if (presignRes.status === 429) {
		throw new PhotoSceneError('Too many uploads just now. Wait a minute and try again.', 'rate_limited');
	}
	if (presignRes.status === 503) {
		throw new PhotoSceneError(
			presign.error === 'storage_unavailable'
				? 'Photo uploads are down for a moment. Paste a public photo link instead, or try again shortly.'
				: 'Photo uploads are not available here. Paste a public photo link instead.',
			'upload_unavailable',
		);
	}
	if (!presignRes.ok || !presign.upload_url || !presign.public_url) {
		throw new PhotoSceneError(presign.message || 'The upload could not start. Try again.', 'upload_failed');
	}
	let put;
	try {
		put = await fetchImpl(presign.upload_url, {
			method: presign.method || 'PUT',
			headers: presign.headers || { 'content-type': blob.type || 'image/jpeg' },
			body: blob,
			signal,
		});
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		throw new PhotoSceneError('Storage refused the upload. Try again shortly.', 'upload_failed');
	}
	if (!put.ok) throw new PhotoSceneError(`Storage rejected the photo (${put.status}). Try again.`, 'upload_failed');
	return presign.public_url;
}

const START_ERRORS = {
	503: ['Scene-from-a-photo is not switched on yet.', 'unconfigured'],
	451: ['This model is not licensed for your region.', 'unavailable_in_region'],
	429: ['Too many scenes just now. Wait a minute and try again.', 'rate_limited'],
};

/**
 * Queue the reconstruction. Resolves with the server's 202 body.
 *
 * @returns {Promise<{ job_id: string, eta_seconds: number, source: string, objects: Array<{label: string}> }>}
 */
export async function startPhotoScene(imageUrl, { clientId, maxObjects, fetchImpl = fetch, signal } = {}) {
	let res;
	let body;
	try {
		res = await fetchImpl('/api/forge-scene-objects', {
			method: 'POST',
			credentials: 'include',
			headers: clientHeaders(clientId),
			body: JSON.stringify(maxObjects ? { image_url: imageUrl, max_objects: maxObjects } : { image_url: imageUrl }),
			signal,
		});
		body = await readBody(res);
	} catch (err) {
		throw networkError(err);
	}
	if (res.ok && body.job_id) return body;
	const known = START_ERRORS[res.status];
	if (known) throw new PhotoSceneError(body.message || known[0], known[1]);
	throw new PhotoSceneError(body.message || `The scene could not start (${res.status}). Try again.`, body.error || 'start_failed');
}

/**
 * Poll until the scene is ready. `onTick(elapsedMs, status)` fires after every
 * poll so the tray can show real elapsed time and the worker's real status.
 *
 * @returns {Promise<{ result_url: string, objects: Array|null, skipped: Array|null, leveling: object|null }>}
 */
export async function waitForPhotoScene(jobId, {
	fetchImpl = fetch, signal, onTick, intervalMs = POLL_INTERVAL_MS, deadlineMs = POLL_DEADLINE_MS,
	sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(),
} = {}) {
	const started = now();
	for (;;) {
		await sleep(intervalMs);
		if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
		let res;
		let body;
		try {
			res = await fetchImpl(`/api/forge-scene-objects?job=${encodeURIComponent(jobId)}`, { credentials: 'include', signal });
			body = await readBody(res);
		} catch (err) {
			throw networkError(err);
		}
		if (!res.ok) throw new PhotoSceneError(body.message || `Status check failed (${res.status}).`, body.error || 'status_failed');
		if (body.status === 'failed' || body.error) {
			throw new PhotoSceneError(body.error || 'The reconstruction failed. Try a photo with clearer, whole objects.', 'failed');
		}
		if (body.result_url) return body;
		const elapsed = now() - started;
		onTick?.(elapsed, body.status || 'queued');
		if (elapsed > deadlineMs) {
			throw new PhotoSceneError('The reconstruction is taking too long. Try again in a few minutes.', 'timeout');
		}
	}
}

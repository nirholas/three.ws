// splat-generate: one photo in, one Gaussian splat out, from the browser.
//
// The client half of the Forge "Image to splat" lane. The Splat Viewer
// (`src/splat-viewer.js`) calls `generateSplat()` and loads the returned
// `splat_url` straight into the stage. The server half is `/api/forge-splat`,
// which routes to the TripoSplat GPU worker (`workers/model-triposplat`, MIT).
//
// Three legs, each with its own failure vocabulary so the page can tell the
// user what actually went wrong:
//   1. upload: a local photo is presigned by `/api/forge-upload` and PUT
//      straight to object storage, the same path the /forge view slots use.
//      An image the user pasted as a URL skips this leg.
//   2. submit: POST /api/forge-splat queues the GPU job.
//   3. poll: GET /api/forge-splat?job=<id> until `done` or `failed`.

export const ACCEPTED_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
// Matches ANON_UPLOAD_LIMITS['forge/uploads/'] on the server.
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
// TripoSplat's pipeline asserts 32768..262144 (see api/forge-splat.js).
export const GAUSSIAN_PRESETS = Object.freeze([
	{ value: 65536, label: 'Light' },
	{ value: 131072, label: 'Balanced' },
	{ value: 262144, label: 'Maximum detail' },
]);
export const DEFAULT_GAUSSIANS = 131072;

const POLL_INTERVAL_MS = 3000;
// A cold GPU instance pulls 4 GB of weights before the first job runs, so a
// first request after idle can take several minutes. Past this, the job is
// treated as lost rather than polled forever.
const POLL_DEADLINE_MS = 15 * 60 * 1000;

export class SplatGenerateError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'SplatGenerateError';
		this.code = code;
	}
}

function clientHeaders() {
	// Same anonymous browser handle /forge uses, so a photo uploaded here lands
	// under the same client prefix as that browser's other Forge uploads.
	let id;
	try {
		id = localStorage.getItem('forge:cid');
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem('forge:cid', id);
		}
	} catch {
		id = crypto.randomUUID();
	}
	return { 'x-forge-client': id, 'x-witness': 'handled' };
}

/** Validate a picked file before any network call. Returns an error string or null. */
export function validatePhoto(file) {
	if (!file) return 'Choose a photo first.';
	if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Use a PNG, JPG or WebP photo.';
	if (file.size === 0) return 'That file is empty.';
	if (file.size > MAX_PHOTO_BYTES) return 'That photo is larger than 8 MB. Resize it and try again.';
	return null;
}

async function readBody(res) {
	return res.json().catch(() => ({}));
}

async function uploadPhoto(file, { fetchImpl, signal }) {
	let presignRes;
	let presign;
	try {
		presignRes = await fetchImpl('/api/forge-upload', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...clientHeaders() },
			body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
			signal,
		});
		presign = await readBody(presignRes);
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		throw new SplatGenerateError('No connection. Check your network and try again.', 'network');
	}
	if (presignRes.status === 429) {
		throw new SplatGenerateError('Too many uploads just now. Wait a minute and try again.', 'rate_limited');
	}
	if (presignRes.status === 503) {
		throw new SplatGenerateError(
			presign.error === 'storage_unavailable'
				? 'Photo uploads are down right now. Paste a public image URL instead, or try again shortly.'
				: 'Photo uploads are not available on this deployment. Paste a public image URL instead.',
			'upload_unavailable',
		);
	}
	if (!presignRes.ok || !presign.upload_url || !presign.public_url) {
		throw new SplatGenerateError(presign.message || 'The upload could not start. Try again.', 'upload_failed');
	}
	let put;
	try {
		put = await fetchImpl(presign.upload_url, {
			method: presign.method || 'PUT',
			headers: presign.headers || { 'content-type': file.type },
			body: file,
			signal,
		});
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		throw new SplatGenerateError('Storage refused the upload. Try again shortly.', 'upload_failed');
	}
	if (!put.ok) throw new SplatGenerateError(`Storage rejected the photo (${put.status}). Try again.`, 'upload_failed');
	return presign.public_url;
}

async function submitJob(imageUrl, numGaussians, { fetchImpl, signal }) {
	let res;
	let body;
	try {
		res = await fetchImpl('/api/forge-splat', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-witness': 'handled' },
			body: JSON.stringify({ image_url: imageUrl, num_gaussians: numGaussians }),
			signal,
		});
		body = await readBody(res);
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		throw new SplatGenerateError('No connection. Check your network and try again.', 'network');
	}
	if (res.status === 503) {
		throw new SplatGenerateError('Image to splat is not switched on for this deployment yet.', 'unconfigured');
	}
	if (res.status === 429) {
		throw new SplatGenerateError('Too many generations just now. Wait a minute and try again.', 'rate_limited');
	}
	if (res.status === 400) {
		throw new SplatGenerateError(body.message || 'That image could not be used.', body.error || 'invalid_input');
	}
	if (!res.ok || !body.job_id) {
		throw new SplatGenerateError(body.message || 'The GPU did not accept the job. Try again.', 'submit_failed');
	}
	return body.job_id;
}

function wait(ms, signal) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(t);
			reject(new DOMException('Aborted', 'AbortError'));
		}, { once: true });
	});
}

async function pollJob(jobId, { fetchImpl, signal, onStatus, now, pollIntervalMs, deadlineMs }) {
	const started = now();
	for (;;) {
		let res;
		let body;
		try {
			res = await fetchImpl(`/api/forge-splat?job=${encodeURIComponent(jobId)}`, {
				headers: { 'x-witness': 'handled' },
				signal,
			});
			body = await readBody(res);
		} catch (err) {
			if (err?.name === 'AbortError') throw err;
			// One dropped poll is not a failed job: keep polling until the deadline.
			body = null;
		}
		if (body && res.ok) {
			if (body.status === 'done' && body.splat_url) return body;
			if (body.status === 'failed') {
				throw new SplatGenerateError(
					body.error ? `Generation failed: ${body.error}` : 'Generation failed on the GPU. Try a different photo.',
					'job_failed',
				);
			}
			onStatus?.({ phase: body.status === 'running' ? 'running' : 'queued', elapsedMs: now() - started });
		}
		if (now() - started > deadlineMs) {
			throw new SplatGenerateError('The GPU took too long to answer. Try again in a few minutes.', 'timeout');
		}
		await wait(pollIntervalMs, signal);
	}
}

/**
 * Generate a splat from a photo.
 *
 * @param {object} opts
 * @param {File} [opts.file]        a local photo (uploaded first)
 * @param {string} [opts.imageUrl]  a public https image URL (used as-is)
 * @param {number} [opts.numGaussians]
 * @param {(s: {phase: string, elapsedMs?: number}) => void} [opts.onStatus]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{job_id: string, splat_url: string, ply_url: string|null, num_gaussians: number|null}>}
 */
export async function generateSplat({
	file,
	imageUrl,
	numGaussians = DEFAULT_GAUSSIANS,
	onStatus,
	signal,
	fetchImpl = globalThis.fetch.bind(globalThis),
	now = () => Date.now(),
	pollIntervalMs = POLL_INTERVAL_MS,
	deadlineMs = POLL_DEADLINE_MS,
} = {}) {
	let source = imageUrl ? String(imageUrl).trim() : '';
	if (file) {
		const invalid = validatePhoto(file);
		if (invalid) throw new SplatGenerateError(invalid, 'invalid_input');
		onStatus?.({ phase: 'uploading' });
		source = await uploadPhoto(file, { fetchImpl, signal });
	} else if (!/^https:\/\//i.test(source)) {
		throw new SplatGenerateError('Choose a photo, or paste a public https image URL.', 'invalid_input');
	}
	onStatus?.({ phase: 'submitting' });
	const jobId = await submitJob(source, numGaussians, { fetchImpl, signal });
	onStatus?.({ phase: 'queued', elapsedMs: 0 });
	const result = await pollJob(jobId, { fetchImpl, signal, onStatus, now, pollIntervalMs, deadlineMs });
	return {
		job_id: jobId,
		splat_url: result.splat_url,
		ply_url: result.ply_url || null,
		num_gaussians: result.num_gaussians ?? null,
	};
}

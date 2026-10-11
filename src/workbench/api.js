// Workbench network client. Every call here is a real platform endpoint:
//   /api/forge-upload       presigned image upload
//   /api/forge              image or prompt to 3D, plus ?catalog, ?health, ?action=rig
//   /api/forge-rembg        background removal
//   /api/forge-remesh       server-side retopology
//   /api/material-studio    durable GLB checkpoint + AI material restyle
//
// Failures surface as WorkbenchError with a `kind` the UI branches on, and a
// message written for the person looking at the screen.

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_MS = 12 * 60 * 1000;

export class WorkbenchError extends Error {
	constructor(message, { kind = 'failed', retryAfter = null, retryBackends = null, status = null } = {}) {
		super(message);
		this.kind = kind;
		this.retryAfter = retryAfter;
		this.retryBackends = retryBackends;
		this.status = status;
	}
}

// The same anonymous browser handle /forge uses, so creations made here land in
// the same per-browser gallery.
export const CLIENT_ID = (() => {
	const KEY = 'forge:cid';
	try {
		let id = localStorage.getItem(KEY);
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem(KEY, id);
		}
		return id;
	} catch {
		return crypto.randomUUID();
	}
})();

const baseHeaders = (extra) => ({ 'x-forge-client': CLIENT_ID, ...extra });

const sleep = (ms, signal) =>
	new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(t);
				reject(new WorkbenchError('Cancelled.', { kind: 'cancelled' }));
			},
			{ once: true },
		);
	});

async function request(url, init = {}) {
	let res;
	try {
		res = await fetch(url, init);
	} catch (err) {
		if (err?.name === 'AbortError') throw new WorkbenchError('Cancelled.', { kind: 'cancelled' });
		throw new WorkbenchError('No connection to three.ws. Check your network and try again.', { kind: 'network' });
	}
	const data = await res.json().catch(() => ({}));
	return { res, data };
}

/** Map an error response from any forge endpoint onto a WorkbenchError. */
function toError(res, data, fallback) {
	const message = data?.message || fallback;
	const code = data?.error;
	if (res.status === 429 || code === 'rate_limited') {
		const header = Number(res.headers.get('ratelimit-reset'));
		const secs = Number(data?.retry_after) > 0 ? Math.ceil(Number(data.retry_after)) : header > 0 ? Math.ceil(header) : 30;
		return new WorkbenchError(data?.message || `Rate limit reached. It resets in about ${secs}s.`, {
			kind: 'rate_limited',
			retryAfter: secs,
			status: 429,
		});
	}
	if (code === 'provider_busy' || code === 'free_lane_unavailable') {
		return new WorkbenchError(message, {
			kind: 'busy',
			retryAfter: Number(data?.retry_after) > 0 ? Math.ceil(Number(data.retry_after)) : 15,
			retryBackends: Array.isArray(data?.retry_backends) ? data.retry_backends : null,
			status: res.status,
		});
	}
	if (res.status === 402 && code === 'three_hold_required') {
		return new WorkbenchError(
			data?.message || 'High quality is a $THREE holder perk. Switch to Draft or Standard, or unlock High on /forge.',
			{ kind: 'hold_required', status: 402 },
		);
	}
	if (res.status === 422 && code === 'image_not_usable') return new WorkbenchError(message, { kind: 'not_usable', status: 422 });
	if (res.status === 403 && code === 'region_restricted') return new WorkbenchError(message, { kind: 'region', status: 403 });
	if (code === 'needs_key' || code === 'invalid_key') return new WorkbenchError(message, { kind: 'needs_key', status: res.status });
	if (res.status === 503 || code === 'unconfigured') return new WorkbenchError(message, { kind: 'unconfigured', status: res.status });
	if (res.status === 400) return new WorkbenchError(message, { kind: 'invalid', status: 400 });
	return new WorkbenchError(message, { status: res.status });
}

/** Upload an image file and return its public https URL. */
export async function uploadImage(file, { signal } = {}) {
	if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
		throw new WorkbenchError('Use a PNG, JPG or WebP image.', { kind: 'invalid' });
	}
	if (file.size > 8 * 1024 * 1024) throw new WorkbenchError('Images must be 8 MB or smaller.', { kind: 'invalid' });
	const { res, data } = await request('/api/forge-upload', {
		method: 'POST',
		signal,
		headers: baseHeaders({ 'content-type': 'application/json' }),
		body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
	});
	if (res.status === 503) {
		throw new WorkbenchError(
			data.error === 'storage_unavailable' ? 'Uploads are down right now. Try again shortly.' : 'Uploads are unavailable on this deployment.',
			{ kind: 'unconfigured' },
		);
	}
	if (!res.ok || !data.upload_url || !data.public_url) throw toError(res, data, 'The upload could not start.');
	let put;
	try {
		put = await fetch(data.upload_url, { method: 'PUT', signal, headers: { 'content-type': file.type }, body: file });
	} catch {
		throw new WorkbenchError('Storage refused the upload. Try again shortly.', { kind: 'network' });
	}
	if (!put.ok) throw new WorkbenchError(`Storage rejected the file (${put.status}).`);
	return data.public_url;
}

/** Persist a GLB blob and return a durable https URL other tools can read. */
export async function uploadGlb(blob, { signal } = {}) {
	const { res, data } = await request('/api/material-studio?action=upload', {
		method: 'POST',
		signal,
		headers: { 'content-type': 'model/gltf-binary' },
		body: blob,
	});
	if (!res.ok || !data.url) throw toError(res, data, 'The model could not be saved for the next step.');
	return data.url;
}

export async function fetchCatalog() {
	const { res, data } = await request('/api/forge?catalog=1', { headers: baseHeaders() });
	if (!res.ok || !Array.isArray(data.backends)) throw toError(res, data, 'The engine catalog is unavailable.');
	return data;
}

export async function fetchHealth() {
	const { res, data } = await request('/api/forge?health=1', { headers: baseHeaders() });
	if (!res.ok || !data.backends) throw toError(res, data, 'Lane health is unavailable.');
	return data;
}

/**
 * Submit an image (or prompt) to 3D job and poll it to completion.
 * @returns {Promise<{glb_url:string, backend?:string, tier?:string}>}
 */
export async function generateMesh(body, { signal, onStatus } = {}) {
	const { res, data } = await request('/api/forge', {
		method: 'POST',
		signal,
		headers: baseHeaders({ 'content-type': 'application/json', 'x-witness': 'handled' }),
		body: JSON.stringify(body),
	});
	if (!res.ok || data.error) throw toError(res, data, `The generator returned ${res.status}.`);
	if (data.status === 'done' && data.glb_url) return data;
	if (!data.job_id) throw new WorkbenchError('The generator did not return a job.');
	onStatus?.({ status: data.status || 'queued', eta: data.eta_seconds, coldStart: data.cold_start });
	return pollForge(data.job_id, { signal, onStatus });
}

async function pollForge(jobId, { signal, onStatus }) {
	let deadline = performance.now() + MAX_POLL_MS;
	while (performance.now() < deadline) {
		await sleep(POLL_INTERVAL_MS, signal);
		const { res, data } = await request(`/api/forge?job=${encodeURIComponent(jobId)}`, { signal, headers: baseHeaders() });
		if (data.error === 'unconfigured') throw toError(res, data, 'This engine is not configured.');
		if (data.status === 'done' && data.glb_url) return data;
		if (data.status === 'failed') {
			throw new WorkbenchError(data.error || 'Generation failed.', {
				kind: data.retryable && data.retry_backends?.length ? 'lane_failed' : 'failed',
				retryBackends: data.retry_backends || null,
			});
		}
		// Waiting for a GPU is progress, not a stall: keep the budget for run time.
		if (data.status === 'queued') deadline = performance.now() + MAX_POLL_MS;
		if (data.status) onStatus?.({ status: data.status, eta: data.eta_seconds, coldStart: data.cold_start });
	}
	throw new WorkbenchError('Generation timed out after 12 minutes. Try a lower quality or another engine.', { kind: 'timeout' });
}

/** Submit-then-poll for the GCP tool lanes that share the { job_id } → ?job= contract. */
async function runToolJob(path, body, { signal, onStatus, label }) {
	const { res, data } = await request(path, {
		method: 'POST',
		signal,
		headers: baseHeaders({ 'content-type': 'application/json' }),
		body: JSON.stringify(body),
	});
	if (!res.ok || !data.job_id) throw toError(res, data, `${label} could not start.`);
	onStatus?.({ status: 'queued', eta: data.eta_seconds });
	const deadline = performance.now() + MAX_POLL_MS;
	while (performance.now() < deadline) {
		await sleep(POLL_INTERVAL_MS, signal);
		const poll = await request(`${path}?job=${encodeURIComponent(data.job_id)}`, { signal, headers: baseHeaders() });
		const s = poll.data;
		if (poll.res.status === 429) continue;
		if (s.status === 'done' && s.result_url) return s;
		if (s.status === 'failed') throw new WorkbenchError(s.error ? `${label} failed: ${s.error}` : `${label} failed.`);
		if (s.status) onStatus?.({ status: s.status });
	}
	throw new WorkbenchError(`${label} timed out.`, { kind: 'timeout' });
}

export function removeBackground(imageUrl, model, opts) {
	return runToolJob('/api/forge-rembg', { image_url: imageUrl, model }, { ...opts, label: 'Background removal' });
}

export function remesh(meshUrl, { mode, targetFaces }, opts) {
	return runToolJob(
		'/api/forge-remesh',
		{ mesh_url: meshUrl, remesh_mode: mode, target_faces: targetFaces, output_format: 'glb' },
		{ ...opts, label: 'Remesh' },
	);
}

export async function rig(glbUrl, { signal, onStatus } = {}) {
	const { res, data } = await request('/api/forge?action=rig', {
		method: 'POST',
		signal,
		headers: baseHeaders({ 'content-type': 'application/json' }),
		body: JSON.stringify({ glb_url: glbUrl }),
	});
	if (data.error === 'rig_unconfigured') {
		throw new WorkbenchError('Auto-rigging is not configured on this deployment.', { kind: 'unconfigured' });
	}
	if (!res.ok || !data.job_id) throw toError(res, data, 'Rigging could not start.');
	onStatus?.({ status: 'queued' });
	return pollForge(data.job_id, { signal, onStatus });
}

export async function restyle(glbUrl, instruction, { signal } = {}) {
	const { res, data } = await request('/api/material-studio?action=restyle', {
		method: 'POST',
		signal,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ glb_url: glbUrl, instruction }),
	});
	if (!res.ok || !data.glbUrl) throw toError(res, data, 'The material restyle failed.');
	return data;
}

// Forge Workflows: what each node actually does.
//
// Every executor calls a real three.ws endpoint (or the user's own Modly app on
// localhost) and returns { outputs, result }. `outputs` feeds the next node;
// `result` is what the node card shows (a viewer, a download, a saved link).
//
// Contracts used, all documented in docs/forge-workflows.md:
//   POST /api/forge                      generate (text or image)    GET ?job=  poll
//   POST /api/forge?action=rig           auto-rig                    GET ?job=  poll
//   POST /api/forge-remesh | -segment | -stylize | -gameready        GET ?job=  poll
//   POST /api/forge-upload               presigned PUT for a photo
//   POST /api/scene-glb-upload           presigned PUT for a GLB
//   POST /api/avatars/from-forge         save to the signed-in library
//   POST /api/creations {op:'publish'}   publish to the public gallery

import { StepError } from './runner.js';
import { attachTierPass, getAccess, getTierPass } from '../three-access.js';
import { generateWithModly, MODLY_INSTALL_URL } from '../modly-local.js';

const POLL_MS = 2500;
const POLL_MAX_BACKOFF_MS = 15000;
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const GLB_MAX_BYTES = 200 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// ── Identity ─────────────────────────────────────────────────────────────────

// The same anonymous handle /forge uses, so a workflow's generations land in the
// same "My creations" list as the ones made on /forge.
const CLIENT_ID = (() => {
	const KEY = 'forge:cid';
	try {
		let id = localStorage.getItem(KEY);
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem(KEY, id);
		}
		return id;
	} catch {
		return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}
})();

// `x-witness: handled`: this page renders a designed state for every error the
// forge endpoints answer with, so the session recorder should not treat them as
// unhandled failures.
export const CLIENT_HEADERS = Object.freeze({ 'x-forge-client': CLIENT_ID, 'x-witness': 'handled' });

function headers(extra = {}) {
	return attachTierPass({ ...CLIENT_HEADERS, ...extra });
}

// ── Plumbing ─────────────────────────────────────────────────────────────────

function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
		const t = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(t);
			reject(new DOMException('Cancelled', 'AbortError'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

async function request(url, { method = 'GET', body, signal, extraHeaders = {}, credentials } = {}) {
	let res;
	try {
		res = await fetch(url, {
			method,
			signal,
			credentials,
			headers: headers(body !== undefined ? { 'content-type': 'application/json', ...extraHeaders } : extraHeaders),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	} catch (err) {
		if (signal?.aborted) throw err;
		const e = new StepError('Could not reach three.ws. Check your connection, then retry this step.', { code: 'network' });
		e.transport = true;
		throw e;
	}
	const data = await res.json().catch(() => ({}));
	return { res, data };
}

const SIGN_IN = () => ({ label: 'Sign in', href: `/login?next=${encodeURIComponent(location.pathname + location.search)}` });

/** Turn a non-2xx endpoint answer into an error the node card can act on. */
export function errorFromResponse(res, data, what) {
	const msg = (fallback) => data?.message || data?.error_description || fallback;
	if (res.status === 429 || data?.error === 'rate_limited') {
		const secs = Math.max(1, Math.ceil(Number(data?.retry_after) || Number(res.headers?.get?.('ratelimit-reset')) || 30));
		return new StepError(`${what} is rate limited right now. Retry in about ${secs}s.`, { code: 'rate_limited', retryAfter: secs });
	}
	if (res.status === 402 && data?.error === 'three_hold_required') {
		const actions = [];
		if (data.acquire?.swap_url) actions.push({ label: 'Get $THREE', href: data.acquire.swap_url });
		actions.push({ label: 'Holder perks', href: '/three' });
		return new StepError(msg(`${what} is a $THREE holder perk.`), { code: 'hold_required', actions });
	}
	if (res.status === 401) {
		return new StepError(msg(`Sign in to use ${what}.`), { code: 'auth', action: SIGN_IN() });
	}
	if (data?.error === 'needs_key' || data?.error === 'invalid_key') {
		return new StepError(msg('This engine needs your own API key.'), { code: data.error, action: { label: 'Open Forge', href: '/forge' } });
	}
	if (data?.error === 'image_not_usable') {
		return new StepError(msg('That photo does not look usable for 3D. Try a clearer photo of a single object.'), { code: 'image_not_usable' });
	}
	if (res.status === 503 || data?.error === 'unconfigured' || data?.error === 'storage_unavailable' || data?.error === 'provider_busy') {
		const secs = Number(data?.retry_after) > 0 ? Math.ceil(Number(data.retry_after)) : 0;
		return new StepError(msg(`${what} is temporarily unavailable.`) + (secs ? ` Retry in about ${secs}s.` : ''), { code: data?.error || 'unavailable', retryAfter: secs });
	}
	return new StepError(msg(`${what} failed (HTTP ${res.status}).`), { code: data?.error || `http_${res.status}` });
}

// A time-based estimate only while the job is inside its ETA. Past it, the bar
// switches to an honest "taking longer" readout instead of parking at 95%.
function estimateProgress(elapsedSec, etaSec) {
	if (!(etaSec > 0) || !(elapsedSec >= 0) || elapsedSec > etaSec) return null;
	return Math.min(95, Math.round((elapsedSec / etaSec) * 100));
}

/**
 * Poll a job until it finishes. `read(data)` maps a poll answer to
 * { done: value } | { failed: message } | { pending: 'queued'|'running' }.
 * Transport hiccups back off and keep going; the server owns the job.
 */
async function pollJob(url, { signal, progress, what, etaSeconds, read }) {
	const started = Date.now();
	let delay = POLL_MS;
	for (;;) {
		await sleep(delay, signal);
		if (Date.now() - started > JOB_TIMEOUT_MS) {
			throw new StepError(`${what} did not finish within ${Math.round(JOB_TIMEOUT_MS / 60000)} minutes. Retry this step.`, { code: 'timeout' });
		}
		let res, data;
		try {
			({ res, data } = await request(url, { signal }));
		} catch (err) {
			if (err?.transport) {
				progress({ label: 'Connection unstable, still waiting', pct: null });
				delay = Math.min(POLL_MAX_BACKOFF_MS, delay * 2);
				continue;
			}
			throw err;
		}
		delay = POLL_MS;
		if (res.status === 429) {
			delay = Math.min(POLL_MAX_BACKOFF_MS, Math.max(POLL_MS, (Number(data?.retry_after) || 5) * 1000));
			continue;
		}
		// A 502 without a status is the worker blinking; keep polling.
		if (res.status >= 500 && !data?.status) continue;
		if (!res.ok) throw errorFromResponse(res, data, what);
		const step = read(data);
		if (step.done) return step.done;
		if (step.failed) throw new StepError(`${what} failed: ${step.failed}`, { code: 'job_failed' });
		const elapsed = Number.isFinite(data.elapsed_seconds) ? data.elapsed_seconds : (Date.now() - started) / 1000;
		const eta = Number(data.eta_seconds) || etaSeconds || 0;
		const pct = estimateProgress(elapsed, eta);
		progress({
			label: step.pending === 'queued' ? 'Queued for a GPU' : 'Working',
			pct,
			estimate: pct != null,
			elapsed: Math.round(elapsed),
			eta: eta || null,
		});
	}
}

// ── Uploads ──────────────────────────────────────────────────────────────────

// Local bytes for URLs this page uploaded, so a Modly run can send the original
// photo without downloading it again.
const localBlobs = new Map();

async function presignAndPut(endpoint, file, contentType, { signal, what }) {
	const { res, data } = await request(endpoint, { method: 'POST', body: { content_type: contentType, size_bytes: file.size }, signal });
	if (!res.ok || !data.upload_url) throw errorFromResponse(res, data, what);
	let put;
	try {
		put = await fetch(data.upload_url, { method: data.method || 'PUT', headers: data.headers || { 'content-type': contentType }, body: file, signal });
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new StepError(`${what} could not reach storage. Check your connection and try again.`, { code: 'network' });
	}
	if (!put.ok) throw new StepError(`${what} was rejected by storage (HTTP ${put.status}). Try again.`, { code: 'upload_failed' });
	localBlobs.set(data.public_url, file);
	return data.public_url;
}

/** Upload a photo the user picked. Resolves { url, name }. */
export async function uploadImage(file, { signal } = {}) {
	const type = IMAGE_TYPES.includes(file.type) ? file.type : null;
	if (!type) throw new StepError('Use a PNG, JPEG or WebP photo.', { code: 'bad_type' });
	if (file.size > IMAGE_MAX_BYTES) throw new StepError('That photo is over 8 MB. Use a smaller one.', { code: 'too_large' });
	const url = await presignAndPut('/api/forge-upload', file, type, { signal, what: 'The photo upload' });
	return { url, name: file.name || 'photo' };
}

/** Upload a GLB (a local file, or a mesh made on the user's GPU). Resolves the public URL. */
export async function uploadGlb(blob, { signal } = {}) {
	if (blob.size > GLB_MAX_BYTES) throw new StepError('That model is over 200 MB, the upload limit.', { code: 'too_large' });
	const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
	if (String.fromCharCode(...head) !== 'glTF') throw new StepError('That file is not a binary glTF (.glb).', { code: 'bad_type' });
	return presignAndPut('/api/scene-glb-upload', blob, 'model/gltf-binary', { signal, what: 'The model upload' });
}

// The processing workers fetch the model themselves, so the URL they get must be
// public http(s), short enough for the API (2048 chars) and not on this machine.
const WORKER_URL_MAX = 2048;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

function workerReachable(url) {
	if (typeof url !== 'string' || url.length > WORKER_URL_MAX) return false;
	try {
		const u = new URL(url);
		return (u.protocol === 'https:' || u.protocol === 'http:') && !LOCAL_HOSTS.has(u.hostname);
	} catch {
		return false;
	}
}

async function fetchMeshBlob(url, signal) {
	let res;
	try {
		res = await fetch(new URL(url, location.href), { signal });
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new StepError('Could not read the model from the previous step. Run that step again.', { code: 'network' });
	}
	if (!res.ok) throw new StepError(`The model from the previous step is no longer available (HTTP ${res.status}). Run that step again.`, { code: 'gone' });
	return res.blob();
}

/**
 * A mesh value as a URL a processing worker can fetch. Local bytes (a model made
 * on the user's GPU), same-origin paths and over-long signed links are uploaded
 * to three.ws storage first.
 */
async function publicMeshUrl(mesh, { signal, progress }) {
	if (!mesh) throw new StepError('No model arrived from the previous step.', { code: 'no_input' });
	if (mesh.publicUrl) return mesh.publicUrl;
	if (workerReachable(mesh.url)) return mesh.url;
	let blob = mesh.blob;
	if (!blob && mesh.url) {
		if (!/^(https?:|blob:|\/)/i.test(mesh.url)) {
			throw new StepError('The engine returned the model in private storage. Run Generate again with Run fresh.', { code: 'unreachable_url' });
		}
		progress({ label: 'Fetching the model', pct: null });
		blob = await fetchMeshBlob(mesh.url, signal);
	}
	if (!blob) throw new StepError('The previous step produced no model.', { code: 'no_input' });
	progress({ label: 'Uploading the model', pct: null });
	mesh.publicUrl = await uploadGlb(blob, { signal });
	return mesh.publicUrl;
}

async function imageBlob(image, signal) {
	if (image.blob) return image.blob;
	const cached = localBlobs.get(image.url);
	if (cached) return cached;
	let res;
	try {
		res = await fetch(image.url, { signal });
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new StepError('Could not download the photo to send to Modly. Upload it again.', { code: 'network' });
	}
	if (!res.ok) throw new StepError(`The photo is no longer available (HTTP ${res.status}). Upload it again.`, { code: 'gone' });
	return res.blob();
}

// $THREE gated calls carry the holder's tier pass. A wallet-only holder signs a
// free message once; a non-holder is never asked to sign.
async function primeTierProof(feature) {
	try {
		const access = await getAccess(feature, { fresh: true });
		await getTierPass({ interactive: Boolean(access?.access?.eligible ?? access?.eligible) });
	} catch {
		// No proof just means the request goes out unproven and the server answers
		// with its normal hold-or-pay message.
	}
}

// ── Generation ───────────────────────────────────────────────────────────────

function mintProgressId() {
	return crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

const CRUMB_LABEL = {
	directed: 'Prompt art-directed',
	reference: 'Reference image ready',
	views: 'Turnaround views painted',
	submitting: 'Sending to the 3D engine',
};

// While the generate POST is still open (prompt direction, reference image),
// read the server's milestone crumbs so the node shows real stages instead of a
// silent spinner.
function watchCrumbs(traceId, progress, signal) {
	let stopped = false;
	const tick = async () => {
		while (!stopped && !signal.aborted) {
			await sleep(POLL_MS, signal).catch(() => {});
			if (stopped || signal.aborted) return;
			try {
				const res = await fetch(`/api/forge?progress=${encodeURIComponent(traceId)}`, { headers: CLIENT_HEADERS, signal });
				if (!res.ok) {
					if (res.status !== 429) return;
					continue;
				}
				const data = await res.json();
				const last = Array.isArray(data?.progress) ? data.progress[data.progress.length - 1] : null;
				const reference = data.progress.find((c) => c.stage === 'reference')?.preview_image_url || null;
				if (!stopped && CRUMB_LABEL[last?.stage]) progress({ label: CRUMB_LABEL[last.stage], pct: null, preview: reference });
			} catch {
				return;
			}
		}
	};
	tick();
	return () => {
		stopped = true;
	};
}

async function generateOnCloud({ params, inputs, signal, progress }) {
	const text = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
	const body = { tier: params.tier || 'draft', path: 'image' };
	if (params.engine && params.engine !== 'auto') body.backend = params.engine;
	if (params.mode === 'image') {
		if (!inputs.image?.url) throw new StepError('No photo arrived from the previous step.', { code: 'no_input' });
		body.image_urls = [inputs.image.url];
		if (text) body.prompt = text.slice(0, 1000);
	} else {
		if (!text) throw new StepError('The prompt is empty.', { code: 'no_input' });
		body.prompt = text.slice(0, 1000);
		body.director = true;
	}
	if (body.tier === 'high') await primeTierProof('forge.high');
	const traceId = mintProgressId();
	body.progress_id = traceId;

	progress({ label: params.mode === 'image' ? 'Submitting the photo' : 'Art-directing the prompt', pct: null });
	const stopCrumbs = watchCrumbs(traceId, progress, signal);
	let res, data;
	try {
		({ res, data } = await request('/api/forge', { method: 'POST', body, signal }));
	} finally {
		stopCrumbs();
	}
	if (!res.ok) throw errorFromResponse(res, data, 'Generation');

	let done = data;
	if (!(data.status === 'done' && data.glb_url)) {
		if (!data.job_id) throw new StepError(data.message || 'The generator did not return a job.', { code: 'no_job' });
		progress({ label: 'Queued for a GPU', pct: 0, estimate: true, eta: data.eta_seconds || null, preview: data.preview_image_url || null });
		done = await pollJob(`/api/forge?job=${encodeURIComponent(data.job_id)}`, {
			signal,
			progress,
			what: 'Generation',
			etaSeconds: data.eta_seconds,
			read: (d) => (d.status === 'done' && d.glb_url ? { done: d } : d.status === 'failed' ? { failed: d.error || d.message || 'the engine gave up' } : { pending: d.status }),
		});
	}
	const mesh = {
		url: done.glb_url,
		filename: 'forge-model.glb',
		creationId: done.creation_id || data.creation_id || null,
		jobId: data.job_id || null,
		backend: done.backend || data.backend || null,
		previewImageUrl: done.preview_image_url || data.preview_image_url || null,
		prompt: body.prompt || null,
	};
	return {
		outputs: { mesh },
		result: {
			mesh,
			note: mesh.creationId ? 'Saved to My creations automatically.' : '',
			links: mesh.creationId ? [{ label: 'Open model page', href: `/m/${encodeURIComponent(mesh.creationId)}` }] : [],
			cached: Boolean(data.cached),
		},
	};
}

async function generateOnModly({ params, inputs, signal, progress, modly }) {
	if (!modly?.origin) throw new StepError('Connect Modly first: select this node and press Connect.', { code: 'modly_offline' });
	if (!inputs.image) throw new StepError('No photo arrived from the previous step.', { code: 'no_input' });
	const image = await imageBlob(inputs.image, signal);
	try {
		const out = await generateWithModly(modly.origin, {
			image,
			modelId: params.modlyModel,
			signal,
			onProgress: (pct, step) => progress({ label: step || 'Generating on your GPU', pct, estimate: false }),
		});
		const mesh = { url: null, blob: out.blob, filename: out.filename, jobId: out.jobId, backend: `modly:${out.modelId}` };
		return { outputs: { mesh }, result: { mesh, note: 'Made on your GPU. It uploads to three.ws only if a later step needs it.' } };
	} catch (err) {
		if (signal.aborted || err?.code === 'CANCELLED') throw err;
		throw new StepError(err?.message || 'Modly could not finish the generation.', { code: `modly_${String(err?.code || 'failed').toLowerCase()}`, action: { label: 'Get Modly', href: MODLY_INSTALL_URL } });
	}
}

// ── Processing ───────────────────────────────────────────────────────────────

/** Submit a mesh job to one of the forge processing endpoints and wait for it. */
async function processMesh({ endpoint, what, body, signal, progress, feature, pick }) {
	if (feature) await primeTierProof(feature);
	progress({ label: `Submitting to ${what}`, pct: null });
	const { res, data } = await request(endpoint, { method: 'POST', body, signal });
	if (!res.ok || !data.job_id) throw errorFromResponse(res, data, what);
	const done = await pollJob(`${endpoint}?job=${encodeURIComponent(data.job_id)}`, {
		signal,
		progress,
		what,
		etaSeconds: data.eta_seconds,
		read: (d) => {
			if (d.status === 'failed') return { failed: d.error || 'the worker gave up' };
			const url = d.status === 'done' ? pick(d) : null;
			return url ? { done: d } : { pending: d.status };
		},
	});
	return { done, url: pick(done) };
}

function meshFrom(prev, url, extra = {}) {
	return { url, filename: prev?.filename || 'forge-model.glb', prompt: prev?.prompt || null, creationId: null, ...extra };
}

// ── Export ───────────────────────────────────────────────────────────────────

let threePromise = null;
function loadThree() {
	threePromise ||= Promise.all([
		import('three/addons/loaders/GLTFLoader.js'),
		import('three/addons/loaders/DRACOLoader.js'),
		import('three/addons/libs/meshopt_decoder.module.js'),
		import('three/addons/exporters/STLExporter.js'),
		import('three/addons/exporters/OBJExporter.js'),
		import('three/addons/exporters/PLYExporter.js'),
	]).then(([gltf, draco, meshopt, stl, obj, ply]) => ({ gltf, draco, meshopt, stl, obj, ply }));
	return threePromise;
}

async function meshArrayBuffer(mesh, signal) {
	if (mesh.blob) return mesh.blob.arrayBuffer();
	let res;
	try {
		res = await fetch(mesh.url, { signal });
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new StepError('Could not download the model to convert it. Check your connection and retry.', { code: 'network' });
	}
	if (!res.ok) throw new StepError(`The model is no longer available (HTTP ${res.status}).`, { code: 'gone' });
	return res.arrayBuffer();
}

async function convertInBrowser(mesh, format, signal) {
	const t = await loadThree();
	const buf = await meshArrayBuffer(mesh, signal);
	const loader = new t.gltf.GLTFLoader();
	const draco = new t.draco.DRACOLoader();
	draco.setDecoderPath('/three/draco/gltf/');
	loader.setDRACOLoader(draco);
	loader.setMeshoptDecoder(t.meshopt.MeshoptDecoder);
	let gltf;
	try {
		gltf = await loader.parseAsync(buf, '');
	} catch (err) {
		throw new StepError(`Could not read the model to convert it: ${err?.message || 'invalid glTF'}.`, { code: 'parse_failed' });
	} finally {
		draco.dispose();
	}
	if (format === 'stl') return new Blob([new t.stl.STLExporter().parse(gltf.scene, { binary: true })], { type: 'model/stl' });
	if (format === 'obj') return new Blob([new t.obj.OBJExporter().parse(gltf.scene)], { type: 'model/obj' });
	const ply = await new Promise((resolve, reject) => {
		try {
			new t.ply.PLYExporter().parse(gltf.scene, resolve, { binary: true });
		} catch (err) {
			reject(err);
		}
	});
	return new Blob([ply], { type: 'application/octet-stream' });
}

function triggerDownload(href, filename) {
	const a = document.createElement('a');
	a.href = href;
	a.download = filename;
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
}

// ── Executors ────────────────────────────────────────────────────────────────

export const EXECUTORS = {
	async prompt({ params }) {
		return { outputs: { text: String(params.text || '').trim() } };
	},

	async image({ params }) {
		const image = (params.images || [])[0];
		if (!image?.url) throw new StepError('Upload a photo first.', { code: 'no_input' });
		return { outputs: { image: { url: image.url, name: image.name } }, result: { image } };
	},

	async loadMesh({ params }) {
		const url = String(params.url || '').trim();
		if (!/^https:\/\//i.test(url)) throw new StepError('Add an https link to a .glb, or upload one.', { code: 'no_input' });
		const mesh = { url, filename: (params.name || url.split('/').pop() || 'model.glb').replace(/[?#].*$/, ''), creationId: null };
		return { outputs: { mesh }, result: { mesh } };
	},

	async generate(ctx) {
		return ctx.params.engine === 'modly' ? generateOnModly(ctx) : generateOnCloud(ctx);
	},

	async rig({ inputs, signal, progress }) {
		const glbUrl = await publicMeshUrl(inputs.mesh, { signal, progress });
		progress({ label: 'Submitting to the rigger', pct: null });
		const { res, data } = await request('/api/forge?action=rig', { method: 'POST', body: { glb_url: glbUrl }, signal });
		if (!res.ok || !data.job_id) {
			if (res.status === 501 || data.error === 'rig_unconfigured') throw new StepError(data.message || 'Auto-rigging is not available right now.', { code: 'rig_unconfigured' });
			throw errorFromResponse(res, data, 'Auto-rig');
		}
		const done = await pollJob(`/api/forge?job=${encodeURIComponent(data.job_id)}`, {
			signal,
			progress,
			what: 'Auto-rig',
			etaSeconds: data.eta_seconds || 90,
			read: (d) => (d.status === 'done' && d.glb_url ? { done: d } : d.status === 'failed' ? { failed: d.error || 'the rigger gave up' } : { pending: d.status }),
		});
		const mesh = meshFrom(inputs.mesh, done.glb_url, { creationId: done.creation_id || null, rigged: true });
		return {
			outputs: { mesh },
			result: { mesh, links: mesh.creationId ? [{ label: 'Open model page', href: `/m/${encodeURIComponent(mesh.creationId)}` }] : [] },
		};
	},

	async remesh({ params, inputs, signal, progress }) {
		const meshUrl = await publicMeshUrl(inputs.mesh, { signal, progress });
		const body = { mesh_url: meshUrl, remesh_mode: params.mode, target_faces: Number(params.targetFaces), texture_size: Number(params.textureSize), output_format: 'glb' };
		if (params.mode === 'triangle') body.operation = params.operation;
		const { done, url } = await processMesh({ endpoint: '/api/forge-remesh', what: 'Remesh', body, signal, progress, pick: (d) => d.result_url });
		const mesh = meshFrom(inputs.mesh, url, { faceCount: done.face_count ?? null });
		return { outputs: { mesh }, result: { mesh, stats: done.face_count ? `${done.face_count.toLocaleString('en-US')} faces` : '' } };
	},

	async segment({ params, inputs, signal, progress }) {
		const meshUrl = await publicMeshUrl(inputs.mesh, { signal, progress });
		const body = { mesh_url: meshUrl, method: params.method, max_parts: Number(params.maxParts) };
		const { done, url } = await processMesh({ endpoint: '/api/forge-segment', what: 'Segment', body, signal, progress, pick: (d) => d.result_url });
		const mesh = meshFrom(inputs.mesh, url, { parts: done.parts || null });
		const count = done.part_count ?? done.parts?.length;
		return { outputs: { mesh }, result: { mesh, stats: count ? `${count} parts` : '' } };
	},

	async stylize({ params, inputs, signal, progress }) {
		const meshUrl = await publicMeshUrl(inputs.mesh, { signal, progress });
		const { done, url } = await processMesh({ endpoint: '/api/forge-stylize', what: 'Stylize', body: { mesh_url: meshUrl, style: params.style, output_format: 'glb' }, signal, progress, pick: (d) => d.result_url });
		const mesh = meshFrom(inputs.mesh, url, { faceCount: done.face_count ?? null });
		return { outputs: { mesh }, result: { mesh, stats: done.face_count ? `${done.face_count.toLocaleString('en-US')} faces` : '' } };
	},

	async gameready({ params, inputs, signal, progress }) {
		const meshUrl = await publicMeshUrl(inputs.mesh, { signal, progress });
		const body = { mesh_url: meshUrl, topology: params.topology, poly_budget: Number(params.polyBudget), texture_size: Number(params.textureSize), formats: ['glb', 'fbx'] };
		const { done, url } = await processMesh({
			endpoint: '/api/forge-gameready',
			what: 'Game-ready',
			body,
			signal,
			progress,
			feature: 'forge.gameready',
			pick: (d) => d.outputs?.glb?.url,
		});
		const mesh = meshFrom(inputs.mesh, url, { fbxUrl: done.outputs?.fbx?.url || null, faceCount: done.face_count ?? null });
		const links = mesh.fbxUrl ? [{ label: 'Download FBX', href: mesh.fbxUrl, download: true }] : [];
		return { outputs: { mesh }, result: { mesh, links, stats: done.face_count ? `${done.face_count.toLocaleString('en-US')} faces` : '' } };
	},

	async preview({ inputs }) {
		if (!inputs.mesh) throw new StepError('No model arrived to preview.', { code: 'no_input' });
		return { result: { mesh: inputs.mesh } };
	},

	async export({ params, inputs, iter, signal, progress }) {
		const mesh = inputs.mesh;
		if (!mesh) throw new StepError('No model arrived to export.', { code: 'no_input' });
		const base = String(params.filename || 'forge-model').trim() + (iter != null ? `-${iter + 1}` : '');
		const format = params.format || 'glb';
		const filename = `${base}.${format}`;
		let href;
		let objectUrl = null;
		if (format === 'glb') {
			if (mesh.blob) href = objectUrl = URL.createObjectURL(mesh.blob);
			else {
				progress({ label: 'Downloading the GLB', pct: null });
				href = objectUrl = URL.createObjectURL(new Blob([await meshArrayBuffer(mesh, signal)], { type: 'model/gltf-binary' }));
			}
		} else if (format === 'fbx') {
			if (mesh.fbxUrl) href = mesh.fbxUrl;
			else {
				const meshUrl = await publicMeshUrl(mesh, { signal, progress });
				const { url } = await processMesh({
					endpoint: '/api/forge-remesh',
					what: 'FBX conversion',
					body: { mesh_url: meshUrl, operation: 'convert', remesh_mode: 'triangle', output_format: 'fbx' },
					signal,
					progress,
					pick: (d) => d.result_url,
				});
				href = url;
			}
		} else {
			progress({ label: `Converting to ${format.toUpperCase()}`, pct: null });
			href = objectUrl = URL.createObjectURL(await convertInBrowser(mesh, format, signal));
		}
		if (params.autoDownload !== false) triggerDownload(href, filename);
		return { result: { download: { href, filename, objectUrl } } };
	},

	async save({ params, inputs, signal, progress }) {
		const mesh = inputs.mesh;
		const glbUrl = await publicMeshUrl(mesh, { signal, progress });
		const name = String(params.name || 'Forge workflow model').trim().slice(0, 80);
		progress({ label: params.destination === 'gallery' ? 'Publishing to the gallery' : 'Saving to your library', pct: null });
		if (params.destination === 'gallery') {
			const { res, data } = await request('/api/creations', {
				method: 'POST',
				body: { op: 'publish', prompt: (mesh.prompt || name).slice(0, 1000), glbUrl, title: name, previewImageUrl: mesh.previewImageUrl || undefined, backend: mesh.backend || undefined },
				signal,
			});
			if (res.status === 400 && data.error === 'invalid_glb_url') {
				throw new StepError('The gallery only accepts models stored on three.ws. Add a Remesh or Save to library step instead.', { code: 'invalid_glb_url' });
			}
			if (!res.ok) throw errorFromResponse(res, data, 'Publishing');
			return { result: { saved: true, links: [{ label: 'View in gallery', href: '/creations' }] } };
		}
		const { res, data } = await request('/api/avatars/from-forge', {
			method: 'POST',
			credentials: 'include',
			body: { glb_url: glbUrl, name, visibility: params.visibility || 'unlisted', source_prompt: mesh.prompt || undefined, rigged: Boolean(mesh.rigged), tags: ['forge-workflow'] },
			signal,
		});
		if (res.status === 401) throw new StepError('Sign in to save models to your library, then retry this step.', { code: 'auth', action: SIGN_IN() });
		if (!res.ok) throw errorFromResponse(res, data, 'Saving');
		const href = data.view_url || (data.avatar?.id ? `/avatars/${data.avatar.id}` : '/dashboard');
		return { result: { saved: true, links: [{ label: 'Open in library', href }] } };
	},
};

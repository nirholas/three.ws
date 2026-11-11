// TRELLIS.2 lab: talking to the forge.
//
//   GET  /api/forge?catalog=1         which lanes this deployment has configured
//   GET  /api/forge?health=1          live reachability per lane
//   POST /api/forge                   submit one image-to-3D run
//   GET  /api/forge?job=<id>          poll; reports queued vs running, elapsed,
//                                     the lane that actually served, worker_stats
//   GET  /api/forge-creation?id=<id>  a finished creation (shared compare links)
//   GET  /api/forge-gallery?scope=community   recent public photos to start from
//
// Upload and error mapping are shared with Forge Workflows so both surfaces say
// the same thing for the same failure.

import { CLIENT_HEADERS, errorFromResponse, uploadImage } from '../forge-workflows/executors.js';
import { attachTierPass } from '../three-access.js';

export { uploadImage };

const POLL_MS = 2500;
const POLL_MAX_BACKOFF_MS = 15_000;
const JOB_TIMEOUT_MS = 20 * 60 * 1000;

export class LabError extends Error {
	constructor(message, { code = 'error', retryAfter = 0, action = null } = {}) {
		super(message);
		this.code = code;
		this.retryAfter = retryAfter;
		this.action = action;
	}
}

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

async function getJson(url, { signal } = {}) {
	let res;
	try {
		res = await fetch(url, { headers: CLIENT_HEADERS, signal });
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new LabError('Could not reach three.ws. Check your connection and retry.', { code: 'network' });
	}
	const data = await res.json().catch(() => ({}));
	return { res, data };
}

/** Catalog + health, folded into one lane list for the image path. */
export async function loadLanes({ signal } = {}) {
	const [cat, health] = await Promise.all([
		getJson('/api/forge?catalog=1', { signal }),
		getJson('/api/forge?health=1', { signal }).catch(() => ({ res: { ok: false }, data: {} })),
	]);
	if (!cat.res.ok) throw new LabError(`The engine catalog did not load (HTTP ${cat.res.status}).`, { code: 'catalog' });
	const backends = Array.isArray(cat.data.backends) ? cat.data.backends : [];
	const live = health.res.ok ? health.data.backends || {} : {};
	return backends
		.filter((b) => Array.isArray(b.paths) && b.paths.includes('image'))
		.map((b) => ({
			id: b.id,
			label: b.label || b.id,
			vendor: b.vendor || '',
			configured: b.configured === true,
			// A BYOK lane with no house key needs the caller's own vendor key,
			// which the lab does not collect; it is listed but not runnable here.
			needsKey: b.byok === true && !b.house_key_available,
			health: live[b.id]?.status || null,
			healthMessage: live[b.id]?.message || '',
			eta: b.estimates?.image || [],
		}));
}

/**
 * Submit a run and poll it to completion.
 * onProgress receives { phase: 'submitting'|'queued'|'running', elapsed, eta, backend }.
 * Resolves { jobId, glbUrl, creationId, backend, workerStats, elapsedSeconds, wallSeconds }.
 */
export async function runJob(body, { signal, onProgress }) {
	const started = performance.now();
	onProgress({ phase: 'submitting', elapsed: 0, eta: null, backend: body.backend });
	let res;
	try {
		res = await fetch('/api/forge', {
			method: 'POST',
			signal,
			headers: attachTierPass({ ...CLIENT_HEADERS, 'content-type': 'application/json' }),
			body: JSON.stringify(body),
		});
	} catch (err) {
		if (signal?.aborted) throw err;
		throw new LabError('Could not reach three.ws to submit the run. Check your connection and retry.', { code: 'network' });
	}
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const e = errorFromResponse(res, data, 'This run');
		throw new LabError(e.message, { code: e.code, retryAfter: e.retryAfter || 0, action: e.actions?.[0] || null });
	}
	const wall = () => (performance.now() - started) / 1000;
	if (data.status === 'done' && data.glb_url) {
		return finish(data, data, wall());
	}
	if (!data.job_id) throw new LabError(data.message || 'The forge did not return a job id.', { code: 'no_job' });

	const jobId = data.job_id;
	let delay = POLL_MS;
	for (;;) {
		await sleep(delay, signal);
		if (wall() * 1000 > JOB_TIMEOUT_MS) {
			throw new LabError(`No result after ${Math.round(JOB_TIMEOUT_MS / 60000)} minutes. The job id is ${jobId}; try again later.`, { code: 'timeout' });
		}
		const poll = await getJson(`/api/forge?job=${encodeURIComponent(jobId)}`, { signal }).catch((err) => {
			if (signal?.aborted) throw err;
			return null;
		});
		if (!poll) {
			delay = Math.min(POLL_MAX_BACKOFF_MS, delay * 2);
			continue;
		}
		delay = POLL_MS;
		if (poll.res.status === 429) {
			delay = Math.min(POLL_MAX_BACKOFF_MS, Math.max(POLL_MS, (Number(poll.data?.retry_after) || 5) * 1000));
			continue;
		}
		if (poll.res.status >= 500 && !poll.data?.status) continue;
		if (!poll.res.ok) {
			const e = errorFromResponse(poll.res, poll.data, 'This run');
			throw new LabError(e.message, { code: e.code, action: e.actions?.[0] || null });
		}
		const d = poll.data;
		if (d.status === 'done' && d.glb_url) return finish({ ...d, job_id: jobId }, data, wall());
		if (d.status === 'failed') {
			throw new LabError(`The run failed: ${d.error || d.message || 'the engine gave up'}.`, { code: 'job_failed' });
		}
		onProgress({
			phase: d.status === 'queued' ? 'queued' : 'running',
			elapsed: Number.isFinite(d.elapsed_seconds) ? d.elapsed_seconds : wall(),
			eta: Number(d.eta_seconds) || Number(data.eta_seconds) || null,
			backend: d.backend || data.backend || body.backend,
		});
	}
}

function finish(done, submitted, wallSeconds) {
	return {
		jobId: done.job_id || submitted.job_id || null,
		glbUrl: done.glb_url,
		creationId: done.creation_id || submitted.creation_id || null,
		backend: done.backend || submitted.backend || null,
		workerStats: done.worker_stats || null,
		elapsedSeconds: Number.isFinite(done.elapsed_seconds) ? done.elapsed_seconds : null,
		wallSeconds,
	};
}

/** A finished creation by id (for ?a=&b= compare links), or null if gone. */
export async function loadCreation(id, { signal } = {}) {
	const { res, data } = await getJson(`/api/forge-creation?id=${encodeURIComponent(id)}`, { signal });
	if (!res.ok) throw new LabError(`That shared model did not load (HTTP ${res.status}).`, { code: 'creation' });
	return data.creation || null;
}

/** Recent public image-to-3D reference photos to start from. */
export async function loadCommunityPhotos({ signal, limit = 8 } = {}) {
	const { res, data } = await getJson('/api/forge-gallery?scope=community&limit=48', { signal });
	if (!res.ok) throw new LabError(`Community photos did not load (HTTP ${res.status}).`, { code: 'gallery' });
	const seen = new Set();
	const out = [];
	for (const c of data.creations || []) {
		if (c.path !== 'image' || !c.preview_image_url || seen.has(c.preview_image_url)) continue;
		seen.add(c.preview_image_url);
		out.push({ url: c.preview_image_url, label: c.prompt || 'Community photo', creationId: c.id });
		if (out.length >= limit) break;
	}
	return out;
}

// Forge-in-world: turn a text prompt (or a reference photo) into a placeable
// GLB prop without leaving /play. This module is the network half only; it
// drives the same free draft lane the /forge page uses (POST /api/forge →
// poll GET /api/forge?job=) and resolves to a durable R2-hosted GLB URL that
// the multiplayer server's asset allow-list accepts, so the finished model can
// ride the existing obj:spawn channel and appear for everyone in the world.
// The UI/placement half lives in coincommunities.js (_forgeProp) and reuses
// the uploaded-prop pipeline (world-objects.js registerUploadedProp).

import { log } from '../shared/log.js';
import { coldStartLabel } from '../shared/forge-frames.js';
import {
	propBudget, overBudget, simplifyTarget, describeSize, countGlbTriangles, MEASURE_MAX_BYTES,
} from './prop-budget.js';

const SUBMIT_URL = '/api/forge';
const REMESH_URL = '/api/forge-remesh';
const UPLOAD_URL = '/api/forge-upload';
const POLL_MS = 2500;
// Draft-tier generations land in ~30-60s; leave generous headroom for a cold
// GPU start (the submit response advertises 90s of cold-start alone).
const MAX_WAIT_MS = 6 * 60 * 1000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // mirrors /api/forge-upload's cap
// The simplify pass is a GPU job of its own (retopology plus a texture re-bake).
const REMESH_MAX_WAIT_MS = 4 * 60 * 1000;

// Same anonymous handle the /forge page keys creations to, so items forged
// in-world show up in the same gallery/history as the rest of this browser's
// forges instead of forming a disconnected second identity.
function forgeClientId() {
	const KEY = 'forge:cid';
	try {
		let id = localStorage.getItem(KEY);
		if (!id) {
			id =
				crypto?.randomUUID?.() ||
				`c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
			localStorage.setItem(KEY, id);
		}
		return id;
	} catch {
		return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}
}

function headers(extra = {}) {
	return { 'x-forge-client': forgeClientId(), ...extra };
}

// A short palette-friendly display name for the forged prop.
export function forgePropName(prompt, file) {
	const base = String(prompt || '').trim() || String(file?.name || '').replace(/\.[a-z0-9]+$/i, '');
	// Trim after clamping so a cut mid-phrase does not leave a dangling space.
	return ((base || 'Forged item').slice(0, 24).trim()) || 'Forged item';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function throwIfAborted(signal) {
	if (signal?.aborted) throw new ForgeError('Forge cancelled.', { cancelled: true });
}

/**
 * Error with user-facing message plus machine flags: rateLimited (with the
 * server's retryAfter seconds and which `scope` tripped), cancelled, and
 * oversize (the model could not be brought inside the world's size ceiling).
 */
export class ForgeError extends Error {
	constructor(message, { rateLimited = false, cancelled = false, oversize = false, retryAfter = null, scope = null } = {}) {
		super(message);
		this.name = 'ForgeError';
		this.rateLimited = rateLimited;
		this.cancelled = cancelled;
		this.oversize = oversize;
		this.retryAfter = retryAfter;
		this.scope = scope;
	}
}

async function readJson(res) {
	try { return await res.json(); } catch { return {}; }
}

function submitError(res, data) {
	if (res.status === 429) {
		const retryAfter = Number.isFinite(Number(data?.retry_after)) && Number(data.retry_after) > 0 ? Math.ceil(Number(data.retry_after)) : null;
		const scope = data?.scope === 'player' || data?.scope === 'world' ? data.scope : null;
		let message = 'The forge is busy right now. Give it a minute and try again.';
		if (scope === 'player') {
			message = `You forged one a moment ago. You can forge again in ${retryAfter ?? 'a few'} s.`;
		} else if (scope === 'world') {
			message = `This world's forge is full right now. A slot opens in about ${retryAfter ?? 'a minute'} s.`;
		}
		return new ForgeError(message, { rateLimited: true, retryAfter, scope });
	}
	const detail = typeof data?.error === 'string' && data.error.length < 200 ? data.error : '';
	return new ForgeError(detail ? `The forge refused that: ${detail}` : 'The forge could not take that request.');
}

// Push the reference image into forge storage via the presigned-PUT path the
// /forge page uses, returning a public URL /api/forge accepts in image_urls.
async function uploadReferenceImage(file, { onStatus, signal } = {}) {
	if (!IMAGE_TYPES.has(file.type)) {
		throw new ForgeError('Reference images must be a PNG, JPEG, or WebP.');
	}
	if (file.size > MAX_IMAGE_BYTES) {
		throw new ForgeError('That image is over 8 MB. Shrink it and try again.');
	}
	onStatus?.('Uploading your reference image…');
	const presign = await fetch(UPLOAD_URL, {
		method: 'POST',
		headers: headers({ 'content-type': 'application/json' }),
		body: JSON.stringify({ content_type: file.type, size_bytes: file.size }),
		signal,
	});
	const grant = await readJson(presign);
	if (!presign.ok || !grant.upload_url || !grant.public_url) {
		if (presign.status === 503) {
			throw new ForgeError('Image uploads are unavailable right now. Try a text prompt instead.');
		}
		throw submitError(presign, grant);
	}
	const put = await fetch(grant.upload_url, {
		method: grant.method || 'PUT',
		headers: grant.headers || { 'content-type': file.type },
		body: file,
		signal,
	});
	if (!put.ok) throw new ForgeError('The image upload failed. Check your connection and try again.');
	return grant.public_url;
}

// One progress line from a real /api/forge frame. Every number here is read off
// the payload; nothing is timed locally, so a slow job reports its own age
// rather than the tab's.
//
// Two states this used to flatten into "waiting for a slot":
//   • A scale-to-zero GPU worker booting. That is a nameable wait with a stated
//     budget, not an anonymous queue (coldStartLabel owns that wording, shared
//     with the homepage chamber and the Studio so the three cannot drift).
//   • The countdown. It printed `eta_seconds`, the lane's static TOTAL, on every
//     frame, so a two-minute wait read as a bar stuck at the same "~60s" the
//     whole time. `eta_remaining_seconds` is the live figure and leads now.
function statusLine(job = {}) {
	const cold = coldStartLabel(job);
	if (cold) return `${cold}, then forging…`;
	const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
	const remaining = num(job.eta_remaining_seconds) ?? num(job.eta_seconds);
	const elapsed = num(job.elapsed_seconds);
	// Elapsed is only worth showing once it means something; under 5s it just
	// flickers as the first polls land.
	const notes = [elapsed && elapsed >= 5 ? `${elapsed}s in` : null, remaining ? `~${remaining}s left` : null].filter(
		Boolean,
	);
	const suffix = notes.length ? ` (${notes.join(', ')})` : '';
	return job.status === 'queued'
		? `Forging: waiting for a slot${suffix}…`
		: `Forging your model${suffix}…`;
}

const oversizeError = (measured) => new ForgeError(
	`That model was too detailed for this world${measured?.triangles ? ` (${describeSize(measured)})` : ''} and could not be simplified enough. Try a simpler description.`,
	{ oversize: true },
);

const UNMEASURABLE = "We could not check that model's size, so it was not placed. Try forging it again.";

// Download the GLB and read its size and triangle count. The Content-Length
// header settles the byte question before any body is read, so a runaway result
// is never pulled into the tab just to be measured.
async function measureModel(url, { signal } = {}) {
	let res;
	try {
		res = await fetch(url, { signal });
	} catch (err) {
		if (signal?.aborted) throw new ForgeError('Forge cancelled.', { cancelled: true });
		throw new ForgeError(UNMEASURABLE);
	}
	if (!res.ok) throw new ForgeError(UNMEASURABLE);
	const declared = Number(res.headers?.get?.('content-length'));
	if (Number.isFinite(declared) && declared > MEASURE_MAX_BYTES) {
		return { bytes: declared, triangles: null };
	}
	try {
		const buffer = await res.arrayBuffer();
		return { bytes: buffer.byteLength, triangles: countGlbTriangles(buffer) };
	} catch (err) {
		if (signal?.aborted) throw new ForgeError('Forge cancelled.', { cancelled: true });
		throw new ForgeError(UNMEASURABLE);
	}
}

// Ask the remesh worker to decimate the model, polling until the simplified GLB
// is mirrored into world-loadable storage. Resolves to its URL, or null when the
// simplifier could not produce something the world can load.
async function simplifyModel(url, budget, { onStatus, signal } = {}) {
	onStatus?.('That model is very detailed. Simplifying it for this world…');
	let start;
	try {
		start = await fetch(REMESH_URL, {
			method: 'POST',
			headers: headers({ 'content-type': 'application/json' }),
			body: JSON.stringify({
				mesh_url: url,
				remesh_mode: 'triangle',
				operation: 'simplify',
				target_faces: simplifyTarget(budget),
				texture_size: 1024,
				output_format: 'glb',
			}),
			signal,
		});
	} catch (err) {
		if (signal?.aborted) throw new ForgeError('Forge cancelled.', { cancelled: true });
		log.warn('[forge-prop] simplify submit failed:', err?.message || err);
		return null;
	}
	const job = await readJson(start);
	if (!start.ok || !job.job_id) return null;

	const deadline = Date.now() + REMESH_MAX_WAIT_MS;
	while (Date.now() < deadline) {
		throwIfAborted(signal);
		await sleep(POLL_MS);
		throwIfAborted(signal);
		let poll;
		try {
			poll = await fetch(`${REMESH_URL}?job=${encodeURIComponent(job.job_id)}&mirror=r2`, { headers: headers(), signal });
		} catch (err) {
			if (signal?.aborted) throw new ForgeError('Forge cancelled.', { cancelled: true });
			continue; // a dropped poll is not a dropped job
		}
		if (poll.status === 429) { await sleep(POLL_MS * 2); continue; }
		const frame = await readJson(poll);
		if (frame.status === 'failed') return null;
		if (frame.status === 'done') {
			return frame.result_url && frame.durable !== false ? frame.result_url : null;
		}
		onStatus?.('Simplifying the model for this world…');
	}
	return null;
}

/**
 * Hold a finished model to the world's size ceiling before anything can place
 * it. Inside the ceiling it passes untouched; over it, it is simplified and
 * re-measured; still over (or the simplifier is unavailable) it is rejected.
 * Nothing raw over the ceiling is ever returned.
 *
 * @returns {Promise<{url: string, simplified: boolean, triangles: number, bytes: number}>}
 */
export async function enforcePropBudget(url, { budget, onStatus, signal } = {}) {
	const limit = budget || propBudget();
	onStatus?.('Checking the model fits this world…');
	const measured = await measureModel(url, { signal });
	if (overBudget(measured, limit).length === 0) {
		return { url, simplified: false, triangles: measured.triangles, bytes: measured.bytes };
	}
	const simplifiedUrl = await simplifyModel(url, limit, { onStatus, signal });
	if (!simplifiedUrl) throw oversizeError(measured);
	const after = await measureModel(simplifiedUrl, { signal });
	if (overBudget(after, limit).length > 0) throw oversizeError(after);
	return { url: simplifiedUrl, simplified: true, triangles: after.triangles, bytes: after.bytes };
}

/**
 * Generate a placeable 3D prop from a prompt and/or reference image.
 * Resolves once the free draft lane finishes and the GLB has a stable URL.
 *
 * @param {object} req
 * @param {string} [req.prompt]  what to forge (3+ chars; required without a file)
 * @param {File}   [req.file]    optional reference image (png/jpeg/webp ≤ 8 MB)
 * @param {(msg: string) => void} [req.onStatus]  live progress line for the UI
 * @param {AbortSignal} [req.signal]
 * @param {string} [req.worldId]  the world this is for; the server applies the per-player and per-world limits to it
 * @param {{maxTriangles:number,maxBytes:number}} [req.budget]  size ceiling (default: this device's tier)
 * @returns {Promise<{url: string, name: string, durable: boolean, creationId: string|null, simplified: boolean, triangles: number, bytes: number}>}
 * @throws {ForgeError} with a user-facing message on every failure path
 */
export async function forgeWorldProp({ prompt = '', file = null, onStatus, signal, worldId = '', budget } = {}) {
	const text = String(prompt || '').trim();
	if (!file && text.length < 3) {
		throw new ForgeError('Describe the item in a few words (or attach a photo).');
	}

	const body = { tier: 'draft', path: 'image' };
	if (worldId) body.world = String(worldId).slice(0, 120);
	if (file) {
		body.image_urls = [await uploadReferenceImage(file, { onStatus, signal })];
		if (text) body.prompt = text;
	} else {
		body.prompt = text;
	}

	throwIfAborted(signal);
	onStatus?.('Sending to the forge…');
	const res = await fetch(SUBMIT_URL, {
		method: 'POST',
		headers: headers({ 'content-type': 'application/json' }),
		body: JSON.stringify(body),
		signal,
	});
	const data = await readJson(res);
	if (!res.ok) throw submitError(res, data);

	const name = forgePropName(text, file);
	const finish = async (frame) => {
		const sized = await enforcePropBudget(frame.glb_url, { budget, onStatus, signal });
		return {
			...sized,
			name,
			// A simplified model is mirrored into world storage by the server, so it is durable by construction.
			durable: sized.simplified ? true : frame.durable !== false,
			creationId: frame.creation_id || null,
		};
	};
	if (data.status === 'done' && data.glb_url) return finish(data);
	if (!data.job_id) throw new ForgeError('The forge did not accept that request. Try rephrasing it.');

	onStatus?.(statusLine({ ...data, status: 'queued' }));
	const deadline = Date.now() + MAX_WAIT_MS;
	while (Date.now() < deadline) {
		throwIfAborted(signal);
		await sleep(POLL_MS);
		throwIfAborted(signal);
		let poll;
		try {
			poll = await fetch(`${SUBMIT_URL}?job=${encodeURIComponent(data.job_id)}`, { headers: headers(), signal });
		} catch (err) {
			if (signal?.aborted) throw new ForgeError('Forge cancelled.', { cancelled: true });
			// A dropped poll is not a dropped job: the generation keeps running
			// server-side, so ride out transient network blips and poll again.
			log.warn('[forge-prop] poll transport error, retrying:', err?.message || err);
			continue;
		}
		if (poll.status === 429) { onStatus?.('Forging: easing off the status checks…'); await sleep(POLL_MS * 2); continue; }
		const job = await readJson(poll);
		if (job.status === 'done' && job.glb_url) return finish(job);
		if (job.status === 'failed') {
			const detail = typeof job.error === 'string' && job.error.length < 200 ? job.error : '';
			throw new ForgeError(detail ? `The forge could not build that: ${detail}` : 'The forge could not build that. Try different wording.');
		}
		onStatus?.(statusLine(job));
	}
	throw new ForgeError('The forge is taking too long. Your item may still finish in the /forge gallery.');
}

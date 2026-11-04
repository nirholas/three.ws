// Cartographer (capability bit 3) — builds a 3D scene / diorama plan from one
// sentence. Backed by @three-ws/scene over the public /api/diorama composer,
// which decomposes the prompt into a placed set of single-object forge prompts.
// The deliverable is the canonical diorama plan; the proof is sha256 of it.
// Same `run<Profession>` contract as work/fetcher.js.

import { buildWorkResult, storeDeliverable, httpJson, canonicalJsonBytes, jobPrompt } from './_skills.js';

const DEFAULT_BRIEFS = [
	'a lonely lighthouse on a stormy cliff',
	'a cozy campsite in a pine clearing at dusk',
	'a bustling night market stall under paper lanterns',
	'a quiet zen garden with a stone bridge',
];

function briefFor(citizen, job) {
	const explicit = jobPrompt(job);
	if (explicit) return explicit;
	const seed = String(citizen?.agentIdHex || job?.taskPda || '0');
	let h = 0;
	for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return DEFAULT_BRIEFS[h % DEFAULT_BRIEFS.length];
}

// Budget for the compose call. Measured against the public lane on 2026-11-04
// (see work/README.md): a single Gemini/LLM call, typically 6 to 12 s and capped
// server-side at 30 s. The citizen's job window is AGORA_TASK_DEADLINE_SECS
// (3600 s default), so 60 s leaves headroom without letting a hung call stall
// the daily loop. Override with AGORA_CARTOGRAPHER_TIMEOUT_MS.
export const DEFAULT_COMPOSE_TIMEOUT_MS = 60_000;

/** Typed failure: `code` is one of compose_timeout | compose_failed | compose_invalid. */
export class CartographerError extends Error {
	constructor(code, message, cause) {
		super(`cartographer: ${message}`);
		this.name = 'CartographerError';
		this.code = code;
		if (cause) this.cause = cause;
	}
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** A placed object must name something to forge and sit at a real [x, y, z]. */
function objectIsPlaceable(o) {
	return (
		o &&
		typeof o.prompt === 'string' &&
		o.prompt.trim().length > 0 &&
		Array.isArray(o.position) &&
		o.position.length === 3 &&
		o.position.every(finite)
	);
}

export async function runCartographer({ cfg, citizen, job } = {}) {
	const apiBase = cfg?.apiBase || 'https://three.ws';
	const log = cfg?.log || (() => {});
	const prompt = briefFor(citizen, job);

	log?.(`cartographer: composing diorama for "${prompt.slice(0, 80)}"`);
	const timeoutMs = Number(cfg?.cartographerTimeoutMs) > 0 ? Number(cfg.cartographerTimeoutMs) : DEFAULT_COMPOSE_TIMEOUT_MS;
	let res;
	try {
		res = await httpJson(apiBase, '/api/diorama', {
			method: 'POST',
			body: { action: 'compose', prompt },
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
			throw new CartographerError('compose_timeout', `composer did not answer within ${timeoutMs} ms`, err);
		}
		throw new CartographerError('compose_failed', `composer failed (${err?.code || 'error'}): ${err?.message || err}`, err);
	}
	const diorama = res?.diorama || res?.data?.diorama || null;
	if (!diorama || !Array.isArray(diorama.objects) || diorama.objects.length === 0) {
		throw new CartographerError('compose_invalid', 'composer returned no diorama plan');
	}
	if (!diorama.objects.every(objectIsPlaceable)) {
		throw new CartographerError('compose_invalid', 'composer returned an object that cannot be placed');
	}

	const bytes = canonicalJsonBytes({ kind: 'agora.diorama.v1', prompt, diorama });
	const deliverable = await storeDeliverable({
		profession: 'cartographer',
		ext: 'json',
		contentType: 'application/json',
		bytes,
		optional: true,
	});

	return buildWorkResult({
		profession: 'cartographer',
		citizen,
		deliverableUrl: deliverable.url,
		deliverableBytes: bytes,
		summary: `Composed "${diorama.title || prompt}" — ${diorama.objects.length} placed objects (${diorama.mood || 'day'})`,
		meta: { prompt, objects: diorama.objects.length, mood: diorama.mood || null, stored: deliverable.stored },
	});
}

export default runCartographer;

// Poll-time lane failover for /api/forge generation jobs.
//
// Submit-time failover (api/forge.js startJob) already walks the free-first
// lane chain when a SUBMIT is rejected. But a self-host worker can accept a
// task and then fail it asynchronously — the failure only surfaces on a later
// GET ?job=<id> poll, in a separate invocation that no longer holds the
// request. Before this module, that poll dead-ended: the user got a terminal
// "hit a snag" with the original inputs still sitting in forge_creations.
//
// This module closes that gap in two layers:
//   1. Automatic re-dispatch. The failed poll recovers the original inputs
//      (prompt + reference image) from the creation row, resubmits to the next
//      configured lane, and binds old-handle → new-handle in Redis. The client
//      keeps polling the SAME job id and simply sees status:"running" with a
//      new `backend` — the failure is invisible. Capped at MAX_FAILOVER_HOPS
//      successors, so a request tries at most 1 primary + 3 backup lanes.
//   2. Designed terminal failure. When no successor is possible (nothing
//      configured, cap reached, no stored inputs, Redis off), the failed
//      response carries `retryable: true` + `retry_backends: [...]` — the
//      ordered, configured lanes a client can one-click resubmit to — instead
//      of a bare error string.
//
// Ordering policy mirrors forge-tiers.js exactly: our own GPU workers first
// (zero vendor cost), then free external lanes, then the paid platform default,
// then the geometry-only TripoSG lane as the final rung. HuggingFace Spaces cannot be auto-redispatched from a poll (its
// provider blocks through the whole generation), so it appears only in the
// retry_backends suggestions, where the client's fresh POST can ride it.
//
// Everything here is best-effort and fail-open: without Redis the successor
// chain silently disables and callers fall back to the suggestion layer;
// without the DB store there are no recoverable inputs and only suggestions
// apply. A failover must never turn a clean failure into a hang — bind first,
// respond "running" only once the successor handle is durably chased.

import { getRedis } from './redis.js';
import { BACKENDS, backendIsConfigured, resolveTier } from './forge-tiers.js';
import { laneHealthSnapshot } from './forge-lane-health.js';
import { encodeJobToken } from './forge-job-token.js';
import { laneAllowedInTerritory } from './forge-territory.js';

const PREFIX = 'fr:successor:';
// Outlive the polling window of a slow cold-start generation, with margin.
const TTL_S = 2 * 3600;

// Successor hops per original job: primary lane + up to 3 automatic backups.
export const MAX_FAILOVER_HOPS = 3;

// Lanes that can be re-dispatched FROM A POLL: async submit/status providers
// only, ordered self-host free → paid → geometry-only last resort. HuggingFace
// is excluded (blocking submit, see module header); NVIDIA is excluded
// (text-only, and a poll-time redispatch always reconstructs from a stored
// reference image).
//
// TripoSG closes the chain. It returns an untextured mesh, so it only runs
// once every textured lane has failed or is marked down. Without it the
// 2026-09-18..28 worker outage, which took Hunyuan3D and TRELLIS self-host
// down together, ended roughly 400 photo jobs a day in a hard failure while
// the TripoSG worker sat healthy.
//
// The Modly lanes (workers/modly) are geometry-only too, so they sit with
// TripoSG at the tail, ahead of it: the Modly worker repairs the mesh and
// decimates it to the tier's budget, and it is a separate service, so it still
// serves when the TripoSG sketch worker is the one that is down.
const ASYNC_REDISPATCH_ORDER = ['trellis2', 'trellis_selfhost', 'hunyuan3d', 'trellis', 'modly', 'modly_hunyuan', 'triposg'];

// Lanes a CLIENT can retry with a fresh POST, per input mode. A fresh POST may
// ride blocking lanes too, so HuggingFace joins here; NVIDIA only serves text.
// TripoSG is absent: its public lane is sketch-only, so a fresh photo POST
// naming it would be refused. It serves photos only as the poll-time rung.
// The Modly lanes are public image lanes, so they close both lists: untextured
// geometry is the last thing to suggest, never the first.
const SUGGESTION_ORDER_IMAGE = ['trellis2', 'trellis_selfhost', 'hunyuan3d', 'huggingface', 'trellis', 'modly', 'modly_hunyuan'];
const SUGGESTION_ORDER_TEXT = ['nvidia', 'trellis2', 'trellis_selfhost', 'hunyuan3d', 'huggingface', 'trellis', 'modly', 'modly_hunyuan'];

function client(override) {
	return override || getRedis();
}

/**
 * Durably record that `originalHandle`'s generation continues on a new lane.
 * Returns true only when the binding is confirmed written — the caller must
 * NOT report status:"running" for a successor that isn't chaseable, or the
 * client would poll a dead handle forever.
 */
export async function bindJobSuccessor(originalHandle, { handle, backend, hop, attempted }, { redis } = {}) {
	const r = client(redis);
	if (!r || !originalHandle || !handle) return false;
	try {
		await r.set(
			`${PREFIX}${originalHandle}`,
			JSON.stringify({ handle, backend, hop, attempted: attempted || [] }),
			{ ex: TTL_S },
		);
		return true;
	} catch {
		return false;
	}
}

async function successorFor(handle, redis) {
	try {
		const raw = await redis.get(`${PREFIX}${handle}`);
		if (!raw) return null;
		const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return value && typeof value.handle === 'string' ? value : null;
	} catch {
		return null;
	}
}

/**
 * Chase the successor chain from the handle the client is polling to the live
 * job. Returns null when no failover ever happened (the overwhelmingly common
 * case), else { handle, backend, hop, attempted } of the newest successor.
 */
export async function resolveLiveJob(originalHandle, { redis } = {}) {
	const r = client(redis);
	if (!r || !originalHandle) return null;
	let current = null;
	let cursor = originalHandle;
	// Cap chase depth defensively at one past MAX_FAILOVER_HOPS — the bind cap
	// makes deeper chains unwritable, this just bounds the loop against a
	// corrupt record.
	for (let i = 0; i <= MAX_FAILOVER_HOPS; i++) {
		const next = await successorFor(cursor, r);
		if (!next) break;
		current = next;
		cursor = next.handle;
	}
	return current;
}

/**
 * The next lane an automatic poll-time redispatch should try, or null. Skips
 * lanes already attempted for this job, lanes not configured on this
 * deployment, and lanes the health snapshot marks down/cooled.
 */
export async function pickRedispatchLane({ attempted = [], country = null } = {}) {
	const candidates = ASYNC_REDISPATCH_ORDER.filter(
		(id) =>
			!attempted.includes(id) &&
			BACKENDS[id] &&
			backendIsConfigured(id) &&
			laneAllowedInTerritory(id, country),
	);
	if (!candidates.length) return null;
	try {
		const snap = await laneHealthSnapshot(candidates);
		for (const id of candidates) {
			if (snap.byId?.[id]?.status !== 'down') return id;
		}
		return null;
	} catch {
		// No telemetry → first configured candidate; a bad pick fails over again.
		return candidates[0];
	}
}

/**
 * Ordered, configured lanes for the terminal-failure `retry_backends` hint.
 * `hasImage` scopes to reconstruct-capable lanes (NVIDIA's hosted preview is
 * text-only and would 4xx a photo).
 */
export function retryBackendSuggestions({ attempted = [], hasImage = false, country = null } = {}) {
	const order = hasImage ? SUGGESTION_ORDER_IMAGE : SUGGESTION_ORDER_TEXT;
	return order.filter(
		(id) =>
			!attempted.includes(id) &&
			BACKENDS[id] &&
			backendIsConfigured(id) &&
			laneAllowedInTerritory(id, country),
	);
}

/**
 * Resubmit a failed generation to `backend` from its stored inputs. Returns
 * { extJobId, handle } — `handle` is what polling routes on (a gcp/replicate
 * job token, or Replicate's bare prediction id for the paid default lane).
 * Providers are dynamic-imported so an unused SDK never loads in the poll path.
 */
export async function submitFailoverJob({ backend, imageUrl, prompt, tierId, path }) {
	if (!imageUrl) throw new Error('failover needs a stored reference image');
	const tier = resolveTier(tierId);

	if (backend === 'trellis2') {
		const { createRegenProvider } = await import('../_providers/gcp.js');
		const job = await createRegenProvider().submit({
			mode: 'trellis2',
			sourceUrl: imageUrl,
			params: { images: [imageUrl], tier: tier.id },
		});
		return { extJobId: job.extJobId, handle: encodeJobToken({ provider: 'gcp', kind: null, taskId: job.extJobId }) };
	}

	if (backend === 'modly' || backend === 'modly_hunyuan') {
		const { createRegenProvider } = await import('../_providers/gcp.js');
		// The Modly worker (workers/modly); the mode picks TripoSG or Hunyuan3D 2
		// Mini Turbo, and the poly budget becomes its decimate target.
		const job = await createRegenProvider().submit({
			mode: backend,
			sourceUrl: imageUrl,
			params: { images: [imageUrl], tier: tier.id, target_polycount: tier.polycount },
		});
		return { extJobId: job.extJobId, handle: encodeJobToken({ provider: 'gcp', kind: null, taskId: job.extJobId }) };
	}

	if (backend === 'trellis_selfhost') {
		const { createRegenProvider } = await import('../_providers/gcp.js');
		const job = await createRegenProvider().submit({
			mode: 'trellis',
			sourceUrl: imageUrl,
			params: { images: [imageUrl], prompt: prompt || undefined },
		});
		return { extJobId: job.extJobId, handle: encodeJobToken({ provider: 'gcp', kind: null, taskId: job.extJobId }) };
	}

	if (backend === 'hunyuan3d') {
		const { createRegenProvider } = await import('../_providers/gcp.js');
		// The Hunyuan3D worker speaks the standard /infer + /tasks/:id task shape
		// (gcp provider mode 'hunyuan'), not the avatar controller's /reconstruct.
		const job = await createRegenProvider().submit({
			mode: 'hunyuan',
			sourceUrl: imageUrl,
			params: {
				images: [imageUrl],
				prompt: prompt || undefined,
				target_polycount: tier.polycount,
			},
		});
		return { extJobId: job.extJobId, handle: encodeJobToken({ provider: 'gcp', kind: null, taskId: job.extJobId }) };
	}

	if (backend === 'triposg') {
		const { createRegenProvider } = await import('../_providers/gcp.js');
		// The photo pipeline (gcp provider mode 'triposg'), not the scribble one:
		// the stored input is a reference photo and it takes no text prompt.
		const job = await createRegenProvider().submit({
			mode: 'triposg',
			sourceUrl: imageUrl,
			params: { target_polycount: tier.polycount },
		});
		return { extJobId: job.extJobId, handle: encodeJobToken({ provider: 'gcp', kind: null, taskId: job.extJobId }) };
	}

	if (backend === 'trellis') {
		const { createRegenProvider } = await import('../_providers/replicate.js');
		const job = await createRegenProvider().submit({
			mode: 'reconstruct',
			sourceUrl: imageUrl,
			params: { images: [imageUrl], prompt: prompt || undefined },
		});
		// The paid default lane keeps Replicate's bare prediction id as its handle.
		return { extJobId: job.extJobId, handle: job.extJobId };
	}

	throw new Error(`lane ${backend} cannot be redispatched from a poll`);
}

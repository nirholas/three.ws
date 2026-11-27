// Circuit breaker and throttle bookkeeping for the hosted NVIDIA TRELLIS lane
// (stats id trellis_nvcf, api/_providers/nvidia.js). Shared by api/forge.js and
// api/gpt-forge.js so both pipelines cool, back off and recover the same way.
//
// Three rules, each answering one way the lane used to waste work:
//
//   1. A stated wait is honored. NVIDIA's 429 carries Retry-After; cooling the
//      lane for a fixed two minutes when it asked for ten re-probes it while it
//      is still throttling, and cooling it for ten when it asked for thirty
//      seconds benches a healthy lane.
//   2. A dead key or an exhausted account (401, 402, 403) is not a blip. It stays
//      broken until an operator acts, so the lane is cooled for the long auth
//      window and probed about once per window instead of by every request.
//   3. The state lives in the shared cache (provider-health.js), so one
//      instance's discovery protects every other instance, and a cooled lane
//      costs a cache read and nothing else.
//
// A 4xx the caller caused (a prompt NVIDIA rejects with 400 or 422) is not a
// lane-health fault and never cools the lane.

import { cacheGet, cacheSet } from './cache.js';
import { AUTH_COOLDOWN_SECONDS, markProviderCooldown } from './provider-health.js';

export const NIM_TRELLIS_COOLDOWN_KEY = 'forge-nim-trellis';

// A socket timeout or unreachable host (no HTTP status came back) is the
// expensive hang the breaker exists to avoid paying twice: full window.
export const NIM_FORGE_COOLDOWN_SECONDS = 120;
// A gateway 5xx that came back promptly is a cold-start or capacity blip the
// in-provider retry already rode: short window.
export const NIM_FORGE_GATEWAY_COOLDOWN_SECONDS = 30;
// The longest wait NVIDIA can state that we will honor. A Retry-After beyond
// this is capped so a bogus header cannot bench the lane for hours.
export const NIM_FORGE_MAX_STATED_COOLDOWN_SECONDS = 900;

/**
 * How long to cool the lane after a failure. A stated Retry-After is honored
 * (floored at the gateway window, capped at the maximum); an HTTP status that
 * came back at all earns the short window; no status earns the full window.
 */
export function nimCooldownSeconds(err) {
	const retryAfter = Number(err?.retryAfter);
	if (Number.isFinite(retryAfter) && retryAfter > 0) {
		return Math.min(
			Math.max(Math.ceil(retryAfter), NIM_FORGE_GATEWAY_COOLDOWN_SECONDS),
			NIM_FORGE_MAX_STATED_COOLDOWN_SECONDS,
		);
	}
	if (typeof err?.providerStatus === 'number') return NIM_FORGE_GATEWAY_COOLDOWN_SECONDS;
	return NIM_FORGE_COOLDOWN_SECONDS;
}

const isAuthFailure = (err) =>
	err?.code === 'invalid_key' ||
	err?.code === 'insufficient_credits' ||
	err?.providerStatus === 401 ||
	err?.providerStatus === 402 ||
	err?.providerStatus === 403;

const isCallerFault = (err) => {
	const s = err?.providerStatus;
	return typeof s === 'number' && s >= 400 && s < 500 && s !== 429 && !isAuthFailure(err);
};

/**
 * The cooldown a failure earns, or null when the lane is not at fault.
 * `reason` follows provider-health.js: 'auth' for a key or billing fault,
 * 'health' for a throttle, 5xx or network failure.
 */
export function nimCooldownFor(err) {
	if (!err) return null;
	if (isAuthFailure(err)) return { seconds: AUTH_COOLDOWN_SECONDS, reason: 'auth' };
	if (isCallerFault(err)) return null;
	const unavailable =
		err.code === 'rate_limited' ||
		err.providerStatus === 429 ||
		err.code === 'provider_error' ||
		err.code === 'provider_unreachable' ||
		(typeof err.providerStatus === 'number' && err.providerStatus >= 500);
	if (!unavailable) return null;
	return { seconds: nimCooldownSeconds(err), reason: 'health' };
}

/** Cool the lane for a submit or poll failure. Best-effort; never throws. */
export async function noteNimLaneFailure(err) {
	const cooldown = nimCooldownFor(err);
	if (!cooldown) return false;
	await markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, cooldown.seconds, cooldown.reason);
	return true;
}

// ── Poll backoff ─────────────────────────────────────────────────────────────

const pollBackoffKey = (taskId) => `nvcf:poll-backoff:${taskId}`;

/**
 * Seconds left in a stated poll wait for this NVCF request, or 0. While it is
 * positive the caller reports the job as still running without calling NVIDIA.
 */
export async function pollBackoffRemaining(taskId) {
	try {
		const hit = await cacheGet(pollBackoffKey(taskId));
		if (!Number.isFinite(hit?.until)) return 0;
		return Math.max(0, Math.ceil((hit.until - Date.now()) / 1000));
	} catch {
		return 0;
	}
}

/**
 * Record what a poll result says about the lane. A throttled poll
 * (`running` with `retryAfter`) backs this request off for the stated time and
 * cools the lane for new submits; a poll that reports a dead key or exhausted
 * credits cools the lane for the auth window. Best-effort; never throws.
 */
export async function noteNimPollOutcome(taskId, result) {
	const wait = Number(result?.retryAfter);
	if (result?.status === 'running' && Number.isFinite(wait) && wait > 0) {
		const seconds = Math.min(Math.ceil(wait), NIM_FORGE_MAX_STATED_COOLDOWN_SECONDS);
		await Promise.all([
			cacheSet(pollBackoffKey(taskId), { until: Date.now() + seconds * 1000 }, seconds).catch(() => {}),
			noteNimLaneFailure({ code: 'rate_limited', providerStatus: 429, retryAfter: seconds }),
		]);
		return;
	}
	if (result?.status === 'failed' && isAuthFailure(result)) {
		await noteNimLaneFailure(result);
	}
}

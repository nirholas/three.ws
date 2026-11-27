// Circuit breaker for the Vertex image lanes (the forge reference image in
// forge-reference-image.js and the generate/edit calls in
// api/_mcp3d/vertex-imagen.js that the text-to-image ladder uses).
//
// Why it exists: Vertex is the first thing every text prompt tries. When Google
// refuses it for a reason that will not clear on the next request (measured
// 2026-11-26: a billing hold answered every image call with 403 "There are
// issues with your billing account..."), each prompt must lose milliseconds to
// it, not a network round trip or a timeout, and the day the cause clears the
// lane must come back without a deploy.
//
// How it works:
//   - Every failure is classified from its HTTP status and Google's error body
//     (classifyVertexFailure). Each class has its own policy (POLICY below):
//     billing and permission cool the lane for a long time, quota honours the
//     reset Google states, outages and timeouts cool briefly, a safety block or
//     a bad image is about THIS prompt and never cools the provider.
//   - "Cooling" is the shared provider-health cooldown on VERTEX_IMAGE_COOLDOWN_KEY,
//     so text-to-image.js's own `providersInCooldown` check and every instance
//     behind the shared cache see the same state. While it is set, the gate
//     answers "skip" with no network call to Vertex and no token mint.
//   - A streak record outlives the cooldown. When the cooldown expires and the
//     streak is still there, exactly one request wins a probe lease (SET NX) and
//     calls Vertex; the others keep skipping until it answers. Success (or any
//     answer that proves Vertex serves, such as a safety block) clears
//     everything. Failure re-cools with the window doubled, capped per class.
//
// Best-effort like provider-health: a cache failure degrades to "no state
// known", which means the lane is tried, exactly the pre-breaker behaviour.

import { cacheGet, cacheSet, cacheDel, cacheSetIfAbsent } from './cache.js';
import { markProviderCooldown, clearProviderCooldown, providersInCooldown } from './provider-health.js';
import { isModelNotFound } from './image-model.js';

// Same key text-to-image.js exports; both call sites cool and read one breaker.
export const VERTEX_IMAGE_COOLDOWN_KEY = 'forge-vertex-image';
const STREAK_KEY = 'vertex-image-breaker:streak';
const PROBE_KEY = 'vertex-image-breaker:probe';
// Longest single Vertex image request (vertex-imagen.js VERTEX_TIMEOUT_MS) plus
// slack: a probe that dies without recording releases its lease on this TTL.
const PROBE_LEASE_SECONDS = 95;

const MIN = 60;
// cools:     the failure says the provider is unusable right now.
// answered:  the failure proves Vertex accepted and served the call (billing,
//            auth and quota are fine), so a pending probe counts as recovered.
// reason:    provider-health's 'auth' (deploy-wide fault) vs 'health' (transient).
export const POLICY = Object.freeze({
	billing: { cools: true, reason: 'auth', baseS: 10 * MIN, capS: 30 * MIN },
	permission: { cools: true, reason: 'auth', baseS: 10 * MIN, capS: 30 * MIN },
	unconfigured: { cools: true, reason: 'auth', baseS: 10 * MIN, capS: 30 * MIN },
	model_not_found: { cools: true, reason: 'auth', baseS: 10 * MIN, capS: 30 * MIN },
	quota: { cools: true, reason: 'health', baseS: 60, capS: 15 * MIN, honorsStatedWait: true },
	transient: { cools: true, reason: 'health', baseS: 30, capS: 10 * MIN },
	timeout: { cools: true, reason: 'health', baseS: 60, capS: 10 * MIN },
	token: { cools: true, reason: 'health', baseS: 60, capS: 10 * MIN },
	safety: { cools: false, answered: true },
	bad_image: { cools: false, answered: true },
	bad_request: { cools: false },
	unknown: { cools: false },
});

// Google's billing refusals: the ErrorInfo reasons and the message variants seen
// live (2026-08-27 "Lightning dunning decision is deny", 2026-11-26 "issues with
// your billing account ... outstanding balance").
const BILLING_RE = /BILLING_DISABLED|BILLING_ACCOUNT|billing account|requires billing|enable billing|outstanding balance|dunning/i;
const SAFETY_FINISH_RE = /finishReason:\s*(SAFETY|IMAGE_SAFETY|PROHIBITED_CONTENT|IMAGE_PROHIBITED_CONTENT|RECITATION|BLOCKLIST|SPII|CONTENT_FILTERED|IMAGE_RECITATION|IMAGE_OTHER)/i;
const SAFETY_TEXT_RE = /\b(blockReason|safety|content policy|prohibited content|policy violation|violates)\b/i;

function errorText(err) {
	const body = err?.providerBody;
	const e = body?.error || {};
	const reasons = Array.isArray(e.details) ? e.details.map((d) => d?.reason || '').join(' ') : '';
	return [err?.message, e.message, e.status, reasons, body?.promptFeedback?.blockReason ? `blockReason ${body.promptFeedback.blockReason}` : '']
		.filter(Boolean)
		.join(' ');
}

/** Name the class of a Vertex image failure. Pure; see POLICY for what each means. */
export function classifyVertexFailure(err) {
	if (!err) return 'unknown';
	if (err.code === 'bad_image') return 'bad_image';
	if (err.vertexStage === 'token') {
		return err.code === 'unconfigured' || err.code === 'adc_unusable' ? 'unconfigured' : 'token';
	}
	const status = Number(err.providerStatus) || 0;
	const text = errorText(err);
	if (status === 402 || ((status === 403 || status === 401) && BILLING_RE.test(text)) || err.code === 'billing') return 'billing';
	if (status === 401 || status === 403) return 'permission';
	if (status === 429 || err.code === 'rate_limited' || /RESOURCE_EXHAUSTED/.test(text)) return 'quota';
	if (isModelNotFound(status, text)) return 'model_not_found';
	if (SAFETY_FINISH_RE.test(text) || (!status && /blockReason/.test(text))) return 'safety';
	if (status >= 500) return 'transient';
	if (status === 400) return SAFETY_TEXT_RE.test(text) ? 'safety' : 'bad_request';
	if (err.name === 'TimeoutError' || /no response in \d+ms|timed? ?out/i.test(String(err.message || ''))) return 'timeout';
	if (err.code === 'provider_unreachable' || err.name === 'TypeError') return 'transient';
	return 'unknown';
}

// Google states a quota reset two ways: a Retry-After header (seconds) or a
// google.rpc.RetryInfo detail ("37s", "1.5s"). Returns whole seconds or null.
export function statedRetrySeconds(err) {
	const details = err?.providerBody?.error?.details;
	if (Array.isArray(details)) {
		const info = details.find((d) => /RetryInfo/.test(String(d?.['@type'] || '')) && d.retryDelay);
		const m = info && /^(\d+(?:\.\d+)?)s$/.exec(String(info.retryDelay));
		if (m) return Math.ceil(Number(m[1]));
	}
	const header = Number(err?.retryAfterSeconds);
	return Number.isFinite(header) && header > 0 ? Math.ceil(header) : null;
}

// Read a Retry-After header value (delta-seconds or an HTTP date) into seconds.
export function parseRetryAfter(value, now = Date.now()) {
	if (value == null || value === '') return null;
	const n = Number(value);
	if (Number.isFinite(n)) return n > 0 ? Math.ceil(n) : null;
	const at = Date.parse(String(value));
	return Number.isFinite(at) && at > now ? Math.ceil((at - now) / 1000) : null;
}

function cooldownSeconds(kind, failures, err) {
	const policy = POLICY[kind];
	if (policy.honorsStatedWait) {
		const stated = statedRetrySeconds(err);
		if (stated) return Math.min(policy.capS, Math.max(1, stated));
	}
	return Math.min(policy.capS, policy.baseS * 2 ** Math.max(0, failures - 1));
}

async function readStreak() {
	try {
		return (await cacheGet(STREAK_KEY)) || null;
	} catch {
		return null;
	}
}

/**
 * Ask whether this request may call Vertex.
 *   { allow: true,  probe: false, tracked: false }  breaker closed
 *   { allow: true,  probe: true,  tracked: true }   this request is the one probe
 *   { allow: false, state }                          cooled, or another request is probing
 * With `force` (the caller has no lane left behind Vertex) a cooled lane is
 * still tried, since a long-shot call beats a certain failure.
 */
export async function vertexBreakerGate({ force = false } = {}) {
	let cooling = false;
	let streak = null;
	try {
		const [cooled, s] = await Promise.all([providersInCooldown([VERTEX_IMAGE_COOLDOWN_KEY]), readStreak()]);
		cooling = cooled.has(VERTEX_IMAGE_COOLDOWN_KEY);
		streak = s;
	} catch {
		return { allow: true, probe: false, tracked: false };
	}
	if (force) return { allow: true, probe: false, tracked: Boolean(cooling || streak) };
	if (cooling) return { allow: false, state: streak };
	if (!streak) return { allow: true, probe: false, tracked: false };
	let won = true;
	try {
		won = await cacheSetIfAbsent(PROBE_KEY, { at: Date.now() }, PROBE_LEASE_SECONDS);
	} catch {
		won = true;
	}
	return won ? { allow: true, probe: true, tracked: true } : { allow: false, state: streak, probing: true };
}

/** Vertex served (or answered in a way that proves it serves): close the breaker. */
export async function recordVertexSuccess(gate) {
	if (!gate?.tracked) return;
	await Promise.all([
		clearProviderCooldown(VERTEX_IMAGE_COOLDOWN_KEY),
		cacheDel(STREAK_KEY).catch(() => {}),
		cacheDel(PROBE_KEY).catch(() => {}),
	]);
}

/**
 * Record a failed Vertex call. Cools the lane when the class says so, closes the
 * breaker when the failure still proves Vertex serves, and always releases a
 * held probe lease. Marks the error `breakerRecorded` so a caller further up
 * (text-to-image.js) does not overwrite the classified window with its own.
 * Returns the class.
 */
export async function recordVertexFailure(gate, err) {
	const kind = classifyVertexFailure(err);
	const policy = POLICY[kind];
	if (err && typeof err === 'object') {
		err.vertexFailureKind = kind;
		err.breakerRecorded = true;
	}
	// A 200 that carried no usable image still proves billing, auth and quota
	// are fine, so a pending probe counts as recovered.
	if (policy.answered || err?.vertexAnswered) {
		await recordVertexSuccess(gate);
		return kind;
	}
	if (!policy.cools) {
		if (gate?.probe) await cacheDel(PROBE_KEY).catch(() => {});
		return kind;
	}
	const prior = await readStreak();
	const failures = (prior?.failures || 0) + 1;
	const seconds = cooldownSeconds(kind, failures, err);
	const now = Date.now();
	const streak = {
		kind,
		status: Number(err?.providerStatus) || null,
		detail: String(err?.providerBody?.error?.message || err?.message || '').slice(0, 240),
		failures,
		since: prior?.since || now,
		until: now + seconds * 1000,
	};
	await markProviderCooldown(VERTEX_IMAGE_COOLDOWN_KEY, seconds, policy.reason);
	try {
		// Outlive the cooldown by the longest window, so the probe after it still
		// knows the streak (and doubles from it) instead of starting fresh.
		await cacheSet(STREAK_KEY, streak, seconds + 30 * MIN + PROBE_LEASE_SECONDS);
	} catch {
		/* best-effort: the cooldown alone still parks the lane */
	}
	await cacheDel(PROBE_KEY).catch(() => {});
	console.warn(
		`[vertex-image-breaker] vertex image lane cooled for ${seconds}s (class=${kind}, failures=${failures}${streak.status ? `, status=${streak.status}` : ''})`,
	);
	return kind;
}

/**
 * Point-in-time breaker state for health surfaces. Reads the shared cache only;
 * never calls Vertex.
 *   state: 'closed' | 'open' (cooling) | 'half_open' (cooldown over, next request probes)
 */
export async function vertexBreakerState() {
	const [cooled, streak] = await Promise.all([
		providersInCooldown([VERTEX_IMAGE_COOLDOWN_KEY]).catch(() => new Map()),
		readStreak(),
	]);
	const cooling = cooled.has(VERTEX_IMAGE_COOLDOWN_KEY);
	if (!cooling && !streak) return { state: 'closed' };
	return {
		state: cooling ? 'open' : 'half_open',
		kind: streak?.kind || null,
		status: streak?.status || null,
		detail: streak?.detail || null,
		failures: streak?.failures || 0,
		since: streak?.since ? new Date(streak.since).toISOString() : null,
		next_probe_at: streak?.until ? new Date(cooling ? streak.until : Date.now()).toISOString() : null,
	};
}

/** Close the breaker and drop every record (tests, and an operator reset). */
export async function resetVertexBreaker() {
	await recordVertexSuccess({ tracked: true });
}

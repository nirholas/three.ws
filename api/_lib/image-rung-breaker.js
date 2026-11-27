// Circuit breaker for the rungs of the text-to-image ladder
// (api/_mcp3d/text-to-image.js).
//
// On 2026-11-26 five of the ladder's six rungs were dead at once: Vertex 403
// (billing hold), both Hugging Face providers 402 (credits exhausted), NVIDIA
// FLUX timing out, Replicate without a token. Only the keyless rung served. How
// the dead rungs failed mattered as much as the fact that they were dead: every
// second a request spent waiting on a rung that was certain to refuse was a
// second the working rung no longer had. This module makes each failure cheap,
// correct and self-healing:
//
//   1. classifyRungFailure() names the failure class from the error a rung
//      threw (auth, credits, rate_limited, timeout, unreachable, server,
//      invalid, client, safety, unconfigured).
//   2. cooldownSecondsFor() turns the class into how long the rung is skipped:
//      a billing hold or an empty credit balance will not heal in seconds, so it
//      parks the rung for LONG_COOLDOWN_SECONDS; a timeout or a 5xx parks it for
//      SHORT_COOLDOWN_SECONDS; a throttle with a stated wait parks it for exactly
//      that wait; a refusal about this one prompt (safety, a 4xx about the input)
//      parks it for nothing, since the next prompt may be fine.
//   3. readRungStates() / admitRung() decide per request: closed (try it), open
//      (skip it, no network call) or half-open (the cooldown ended; exactly one
//      request claims the probe lease and tries the rung, the rest skip it).
//   4. recordRungSuccess() closes a tripped breaker the moment a probe serves;
//      recordRungFailure() re-opens it. No rung stays disabled until a restart.
//
// State lives in the shared cache (Upstash when configured, per-instance memory
// otherwise), so one instance's 403 spares every other instance the same call.
// Every helper is best-effort and never throws: a cache outage degrades to "no
// breaker known", which is the pre-breaker behavior.
//
// The breaker also writes the legacy provider-health cooldown key
// (llm-cooldown:<key>) so the readers that predate it keep working: the
// reference-image module's own Vertex attempt (forge-reference-image.js) and the
// NIM line of the image health probe (ai-image-lanes.js).

import { cacheGet, cacheSet, cacheDel, cacheSetIfAbsent } from './cache.js';
import { markProviderCooldown, clearProviderCooldown, providersInCooldown, providerCooldownUntil } from './provider-health.js';

// Breaker keys, one per rung. The Vertex key is shared with the
// reference-image module's own Vertex attempt, so one billing refusal silences
// both call sites.
export const IMAGE_RUNG_KEYS = Object.freeze({
	vertex: 'forge-vertex-image',
	nim: 'forge-nim-flux',
	'hf:fal-ai': 'forge-hf-image-fal-ai',
	'hf:wavespeed': 'forge-hf-image-wavespeed',
	pollinations: 'forge-pollinations',
});

// Same length as provider-health's AUTH_COOLDOWN_SECONDS (the window every LLM
// lane uses for a key or billing fault). Not imported: several suites stub
// provider-health with only the functions they drive.
export const LONG_COOLDOWN_SECONDS = 300;
export const SHORT_COOLDOWN_SECONDS = 60;
// A stated wait is believed up to this long; a bogus header must not park a
// rung for an hour.
export const MAX_STATED_WAIT_SECONDS = 600;
// The ceiling of an escalated cooldown (recordRungFailure's `escalate`): a rung
// that failed every probe is still tried four times an hour, so it comes back on
// its own once the provider recovers.
export const MAX_ESCALATED_COOLDOWN_SECONDS = 900;
// How long after a cooldown ends the breaker remembers it was tripped. Inside
// this window the rung is half-open: one probe at a time. Past it, a rung that
// nobody asked for is simply closed again.
const HALF_OPEN_MEMORY_SECONDS = 3_600;

const RECORD_PREFIX = 'image-rung:';
const PROBE_PREFIX = 'image-rung-probe:';

const LONG_CLASSES = new Set(['auth', 'credits', 'unconfigured']);
// Not a failure of the call at all: the rung's own breaker (vertex-image-breaker.js
// inside vertex-imagen.js) refused it before any network call.
const SKIP_CLASSES = new Set(['cooling']);
const SHORT_CLASSES = new Set(['timeout', 'unreachable', 'server', 'invalid']);

// Vertex reports a content block in the message (finishReason: IMAGE_SAFETY...),
// NIM as safety_blocked. Either is a verdict about this prompt, not the rung.
const SAFETY_MESSAGE = /finishReason:\s*[A-Z_]*(SAFETY|PROHIBITED|BLOCKLIST|RECITATION|SPII|FILTERED)/i;
const TIMEOUT_MESSAGE = /\btimed out\b|no response in \d+\s*ms/i;

/**
 * Seconds a provider asked us to wait, from a Retry-After header (delta-seconds
 * or an HTTP date). Undefined when the header is absent or unreadable, so the
 * caller can tell "the provider stated a wait" from "we would be guessing".
 */
export function statedRetryAfterSeconds(headers) {
	const raw = headers?.get?.('retry-after');
	if (raw == null || raw === '') return undefined;
	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds > 0) return Math.min(MAX_STATED_WAIT_SECONDS, Math.ceil(seconds));
	const at = Date.parse(raw);
	if (Number.isFinite(at)) {
		const delta = Math.ceil((at - Date.now()) / 1000);
		if (delta > 0) return Math.min(MAX_STATED_WAIT_SECONDS, delta);
	}
	return undefined;
}

/**
 * Name the failure class of an error a rung threw. `paymentIsThrottle` is for
 * the keyless rung, whose 402 is its free-tier throttle, not a credit balance.
 * @returns {{ failureClass: string, status?: number, retryAfter?: number, detail: string }}
 */
export function classifyRungFailure(err, { paymentIsThrottle = false } = {}) {
	const status = typeof err?.providerStatus === 'number' ? err.providerStatus : undefined;
	const retryAfter = Number.isFinite(err?.retryAfter) && err.retryAfter > 0 ? Math.ceil(err.retryAfter) : undefined;
	const message = String(err?.message || '');
	let failureClass;
	if (err?.code === 'provider_cooling') failureClass = 'cooling';
	else if (err?.code === 'safety_blocked' || SAFETY_MESSAGE.test(message)) failureClass = 'safety';
	else if (err?.code === 'billing' || (status === 402 && !paymentIsThrottle)) failureClass = 'credits';
	else if (status === 401 || status === 403) failureClass = 'auth';
	else if (status === 429 || (status === 402 && paymentIsThrottle)) failureClass = 'rate_limited';
	else if (err?.timedOut || TIMEOUT_MESSAGE.test(message)) failureClass = 'timeout';
	else if (err?.code === 'rate_limited') failureClass = 'rate_limited';
	else if (err?.code === 'provider_unreachable') failureClass = 'unreachable';
	else if (err?.code === 'unconfigured') failureClass = 'unconfigured';
	else if (status >= 500) failureClass = 'server';
	else if (status >= 400) failureClass = 'client';
	else failureClass = 'invalid';
	return {
		failureClass,
		...(status !== undefined ? { status } : {}),
		...(retryAfter !== undefined ? { retryAfter } : {}),
		detail: message.replace(/\s+/g, ' ').trim().slice(0, 200),
	};
}

/** How long a failure of this class keeps the rung out of the ladder. */
export function cooldownSecondsFor({ failureClass, retryAfter }) {
	if (LONG_CLASSES.has(failureClass)) return LONG_COOLDOWN_SECONDS;
	if (failureClass === 'rate_limited') {
		return retryAfter > 0 ? Math.min(MAX_STATED_WAIT_SECONDS, retryAfter) : SHORT_COOLDOWN_SECONDS;
	}
	if (SHORT_CLASSES.has(failureClass)) return SHORT_COOLDOWN_SECONDS;
	return 0;
}

function stateOf(record, legacyCooling, now = Date.now()) {
	if (record && now < record.until) {
		return { state: 'open', record, retryInMs: record.until - now };
	}
	// Cooled by a caller that writes only the legacy key (the reference-image
	// module's own Vertex attempt): skip it, the TTL there is the cooldown.
	if (legacyCooling) return { state: 'open', record: record || null, retryInMs: null };
	if (record) return { state: 'half_open', record, retryInMs: 0 };
	return { state: 'closed', record: null, retryInMs: 0 };
}

/**
 * Read the breaker state of each key in one pass.
 * @returns {Promise<Map<string, { state: 'closed'|'open'|'half_open', record: object|null, retryInMs: number|null }>>}
 */
async function legacyCooling(keys) {
	try {
		return await providersInCooldown(keys);
	} catch {
		return new Map();
	}
}

export async function readRungStates(keys) {
	const [records, legacy] = await Promise.all([
		Promise.all(keys.map((key) => cacheGet(`${RECORD_PREFIX}${key}`).catch(() => null))),
		legacyCooling(keys),
	]);
	const now = Date.now();
	return new Map(keys.map((key, i) => [key, stateOf(records[i], legacy.has(key), now)]));
}

/**
 * Whether this request may call the rung. Closed: yes. Open: no. Half-open:
 * only the one request that claims the probe lease; it holds the lease for at
 * most `leaseSeconds` (the rung's own time limit plus a margin), so a prober
 * that dies mid-call cannot wedge the rung. `singleProbe: false` admits every
 * request once the cooldown ends (the keyless rung, which has nothing behind it
 * to send the others to).
 */
export async function admitRung(key, entry, { leaseSeconds = SHORT_COOLDOWN_SECONDS, singleProbe = true } = {}) {
	if (!entry || entry.state === 'closed') return true;
	if (entry.state === 'open') return false;
	if (!singleProbe) return true;
	try {
		return await cacheSetIfAbsent(`${PROBE_PREFIX}${key}`, { at: Date.now() }, Math.max(1, Math.ceil(leaseSeconds)));
	} catch {
		return true;
	}
}

/**
 * Record a rung failure: open (or re-open) its breaker for the class's cooldown
 * and release any probe lease. A failure whose cooldown is zero (a refusal
 * about this prompt) proves the rung answered, so a half-open breaker closes.
 * `escalate`: a timeout, unreachable, 5xx or bad-body failure on a rung that is
 * already tripped doubles the previous cooldown (60, 120, 240, 480 s, capped at
 * MAX_ESCALATED_COOLDOWN_SECONDS), so a rung that is dead rather than blipping
 * stops costing a real request every minute. A success closes the breaker and
 * resets it. Auth, credit and stated-wait cooldowns are never escalated.
 * Never throws.
 * @returns {Promise<{ failureClass: string, status?: number, retryAfter?: number, detail: string, cooldownSeconds: number }>}
 */
export async function recordRungFailure(key, err, { paymentIsThrottle = false, statedWaitOnly = false, escalate = false } = {}) {
	const failure = classifyRungFailure(err, { paymentIsThrottle });
	if (SKIP_CLASSES.has(failure.failureClass)) return { ...failure, cooldownSeconds: 0 };
	let cooldownSeconds = cooldownSecondsFor(failure);
	// The keyless rung is the last free one: skipping it on a guess leaves the
	// request with nothing. Only a wait the provider itself stated parks it.
	if (statedWaitOnly && !(failure.failureClass === 'rate_limited' && failure.retryAfter > 0)) cooldownSeconds = 0;
	try {
		await cacheDel(`${PROBE_PREFIX}${key}`);
		if (cooldownSeconds > 0) {
			const now = Date.now();
			const previous = await cacheGet(`${RECORD_PREFIX}${key}`).catch(() => null);
			if (escalate && SHORT_CLASSES.has(failure.failureClass) && SHORT_CLASSES.has(previous?.failureClass) && previous.cooldownSeconds > 0) {
				cooldownSeconds = Math.min(MAX_ESCALATED_COOLDOWN_SECONDS, Math.max(cooldownSeconds, previous.cooldownSeconds * 2));
			}
			await cacheSet(
				`${RECORD_PREFIX}${key}`,
				{
					failureClass: failure.failureClass,
					status: failure.status ?? null,
					retryAfter: failure.retryAfter ?? null,
					detail: failure.detail,
					failedAt: now,
					until: now + cooldownSeconds * 1000,
					cooldownSeconds,
					failures: (previous?.failures || 0) + 1,
				},
				cooldownSeconds + HALF_OPEN_MEMORY_SECONDS,
			);
			await markProviderCooldown(key, cooldownSeconds, LONG_CLASSES.has(failure.failureClass) ? 'auth' : 'health');
		} else {
			await closeRung(key);
		}
	} catch {
		// Cache unavailable: the next request simply tries the rung again.
	}
	return { ...failure, cooldownSeconds };
}

async function closeRung(key) {
	await Promise.all([cacheDel(`${RECORD_PREFIX}${key}`), cacheDel(`${PROBE_PREFIX}${key}`)]);
	await clearProviderCooldown(key);
}

/**
 * Record that a rung served. Closes a tripped breaker (the probe succeeded);
 * a rung that was never tripped costs no cache write. Never throws.
 */
export async function recordRungSuccess(key, entry) {
	if (!entry || entry.state === 'closed') return;
	try {
		await closeRung(key);
	} catch {
		// Cache unavailable: the record expires on its own TTL.
	}
}

/**
 * Read-only breaker view for the health endpoint: each rung's state, the last
 * failure class and when the rung will be tried again.
 */
async function legacyUntil(key) {
	try {
		return await providerCooldownUntil(key);
	} catch {
		return null;
	}
}

export async function describeRungBreakers(keys) {
	const states = await readRungStates(keys);
	// A rung cooled only through the legacy key (by its own breaker, or another
	// call site) reads its end time from there.
	const legacyEnds = await Promise.all(
		keys.map((key) => (states.get(key).state === 'open' && states.get(key).retryInMs == null ? legacyUntil(key) : null)),
	);
	const now = Date.now();
	return Object.fromEntries(
		keys.map((key, i) => {
			const { state, record } = states.get(key);
			const retryInMs = states.get(key).retryInMs ?? (legacyEnds[i] ? Math.max(0, legacyEnds[i] - now) : null);
			return [
				key,
				{
					state,
					last_failure_class: record?.failureClass ?? null,
					last_failure_status: record?.status ?? null,
					last_failure_detail: record?.detail ?? null,
					last_failure_at: record?.failedAt ? new Date(record.failedAt).toISOString() : null,
					consecutive_failures: record?.failures ?? 0,
					retry_at:
						state === 'open'
							? retryInMs != null
								? new Date(now + retryInMs).toISOString()
								: null
							: new Date(now).toISOString(),
				},
			];
		}),
	);
}

function envSet(name) {
	return typeof process !== 'undefined' && !!process.env?.[name];
}

// The ladder in the order api/_mcp3d/text-to-image.js walks it, with whether
// each rung is configured on this instance. Kept here, not in text-to-image.js,
// so the health endpoint can read it without loading the ladder; a test walks
// the real ladder and pins that both orders agree. Livepeer and Replicate have
// no breaker key: Livepeer is dark behind its flag, Replicate is the last rung.
export function imageLadderRungs() {
	const vertexGate = process.env.VERTEX_IMAGEN_ENABLED;
	const vertexConfigured =
		envSet('GOOGLE_CLOUD_PROJECT') && (vertexGate == null || vertexGate === '' || !/^(0|false|no|off)$/i.test(vertexGate.trim()));
	const vertexFirst = vertexConfigured && process.env.VERTEX_IMAGEN_FIRST !== '0';
	const vertex = { rung: 'vertex', key: IMAGE_RUNG_KEYS.vertex, configured: vertexConfigured };
	return [
		...(vertexFirst ? [vertex] : []),
		{ rung: 'nim', key: IMAGE_RUNG_KEYS.nim, configured: envSet('NVIDIA_API_KEY') },
		...(vertexFirst ? [] : [vertex]),
		{ rung: 'hf:fal-ai', key: IMAGE_RUNG_KEYS['hf:fal-ai'], configured: envSet('HF_TOKEN') },
		{ rung: 'hf:wavespeed', key: IMAGE_RUNG_KEYS['hf:wavespeed'], configured: envSet('HF_TOKEN') },
		{ rung: 'livepeer', key: null, configured: /^(1|true|yes|on)$/i.test(String(process.env.LIVEPEER_FEDERATION_ENABLED || '').trim()) },
		{ rung: 'pollinations', key: IMAGE_RUNG_KEYS.pollinations, configured: true },
		{ rung: 'replicate', key: null, configured: envSet('REPLICATE_API_TOKEN') },
	];
}

/**
 * The ladder as the health endpoint reports it: every rung in order, whether it
 * is configured, its breaker state, the last failure class and when it will be
 * tried again. Reads the cache only; no provider is called.
 */
export async function describeImageLadder() {
	const rungs = imageLadderRungs();
	const keys = rungs.filter((r) => r.key).map((r) => r.key);
	const breakers = await describeRungBreakers(keys);
	const now = new Date().toISOString();
	return rungs.map(({ rung, key, configured }) => {
		const b = key ? breakers[key] : null;
		return {
			rung,
			configured,
			state: configured ? b?.state ?? 'closed' : 'unconfigured',
			last_failure_class: b?.last_failure_class ?? null,
			last_failure_status: b?.last_failure_status ?? null,
			last_failure_at: b?.last_failure_at ?? null,
			last_failure_detail: b?.last_failure_detail ?? null,
			consecutive_failures: b?.consecutive_failures ?? 0,
			retry_at: configured ? b?.retry_at ?? now : null,
		};
	});
}

/** Drop every breaker record, lease and legacy cooldown for these keys. */
export async function resetImageRungBreakers(keys = Object.values(IMAGE_RUNG_KEYS)) {
	await Promise.all(keys.map((key) => closeRung(key).catch(() => {})));
}

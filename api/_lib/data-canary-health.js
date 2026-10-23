// Canary health store and fallback ordering for market-data sources.
//
// The canary cron (api/cron/data-canary.js) probes each source against a value
// that is known to be true and records the verdict here. The data layer then asks
// `orderByCanary` to sort a provider list so sources that just passed their probe
// are tried first, sources never probed keep their configured position, and
// sources that are failing sink to the back (they stay in the list: a canary can
// be wrong, and a failing source is still better than no source).
//
// Storage is the shared cache adapter (Redis when configured, memory otherwise).
// This module has no dependency on any provider list, so provider modules can
// import it without a cycle.

import { cacheGet, cacheSet } from './cache.js';

export const CANARY_KEY = (id) => `data-canary:v1:${id}`;
/** A verdict older than this is treated as unknown, not as healthy. */
export const CANARY_TTL_S = 6 * 3600;
export const CANARY_STALE_MS = 3 * 3600 * 1000;

/**
 * @typedef {{ id: string, kind: string, ok: boolean, checked_at: number, latency_ms: number, consecutive_failures: number, detail: string|null }} CanaryVerdict
 */

/** Persist one verdict, carrying the failure streak forward from the previous one. */
export async function recordCanary({ id, kind, ok, latencyMs, detail = null, now = Date.now() }) {
	let prev = null;
	try {
		prev = await cacheGet(CANARY_KEY(id));
	} catch {
		prev = null;
	}
	/** @type {CanaryVerdict} */
	const verdict = {
		id,
		kind,
		ok: !!ok,
		checked_at: now,
		latency_ms: Math.max(0, Math.round(latencyMs || 0)),
		consecutive_failures: ok ? 0 : (prev?.consecutive_failures || 0) + 1,
		detail: ok ? null : String(detail || 'failed').slice(0, 200),
	};
	await cacheSet(CANARY_KEY(id), verdict, CANARY_TTL_S);
	return verdict;
}

export async function readCanaries(ids) {
	const out = {};
	await Promise.all(
		ids.map(async (id) => {
			try {
				out[id] = (await cacheGet(CANARY_KEY(id))) || null;
			} catch {
				out[id] = null;
			}
		}),
	);
	return out;
}

/**
 * Rank: 0 = passed recently, 1 = unknown or stale (configured order preserved),
 * 2 = failing. Pure; exported for tests.
 */
export function canaryRank(verdict, now = Date.now()) {
	if (!verdict || typeof verdict.checked_at !== 'number') return 1;
	if (now - verdict.checked_at > CANARY_STALE_MS) return 1;
	return verdict.ok ? 0 : 2;
}

/**
 * Stable sort of `providers` (objects with a `name`) by canary health. Providers
 * with no canary keep their relative order. Never drops a provider.
 */
export function orderProviders(providers, verdicts, now = Date.now()) {
	return providers
		.map((p, i) => ({ p, i, r: canaryRank(verdicts[p.name], now) }))
		.sort((a, b) => a.r - b.r || a.i - b.i)
		.map((x) => x.p);
}

export async function orderByCanary(providers, now = Date.now()) {
	try {
		const verdicts = await readCanaries(providers.map((p) => p.name));
		return orderProviders(providers, verdicts, now);
	} catch {
		return providers;
	}
}

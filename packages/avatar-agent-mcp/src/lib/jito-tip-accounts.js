// Jito tip accounts: the one place that knows where a bundle tip may go.
//
// A bundle tip must transfer SOL to one of the block engine's tip accounts. The
// engine publishes the current set through the `getTipAccounts` JSON-RPC method.
// This module reads that list, caches it, and falls back to a pinned copy of the
// set when the engine is unreachable, so a tip is never blocked on a network call.
//
// Two ways to read it:
//   - tipAccountsNow(): synchronous, for hot paths. Returns the cached live list,
//     else the pinned fallback, and kicks a background refresh when the cache is
//     cold or stale. Never waits on the network.
//   - getTipAccounts(): async. Awaits a live read when the cache is cold or stale.
//
// checkTipAccountDrift() compares the pinned fallback with the live list and
// reports "ok", "drift" or "unverified" (engine unreachable).
//
// Dependency free on purpose: api/_lib/execution-engine.js imports this file by
// relative path, and the published package ships it as-is.

export const DEFAULT_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf';

// Pinned copy of Jito's mainnet getTipAccounts response. tests/jito-tip-accounts.test.js
// pins it against a canonical set so a mistyped address cannot burn tips. If Jito
// rotates the set, checkTipAccountDrift() reports "drift" and this list is updated.
export const JITO_TIP_ACCOUNTS = [
	'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
	'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
	'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
	'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
	'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
	'96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
	'3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
	'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
];

const CACHE_TTL_MS = 10 * 60_000;
const RETRY_AFTER_FAILURE_MS = 60_000;
const FETCH_TIMEOUT_MS = 3_000;
const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// baseUrl -> { accounts, at } for the last good live read, and baseUrl -> ms of
// the last failed read (so a down engine is not retried on every call).
const liveCache = new Map();
const lastFailure = new Map();
const inflight = new Map();

function normalizeBaseUrl(baseUrl) {
	return String(baseUrl || DEFAULT_BLOCK_ENGINE_URL).trim().replace(/\/+$/, '');
}

function defaultBaseUrl() {
	return normalizeBaseUrl(
		typeof process !== 'undefined' ? process.env.JITO_BLOCK_ENGINE_URL : undefined,
	);
}

/**
 * Read the live tip-account list from the block engine. Throws on any transport
 * error, non-2xx, JSON-RPC error, or a payload that is not a list of pubkeys.
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function fetchLiveTipAccounts({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
	const url = `${normalizeBaseUrl(baseUrl || defaultBaseUrl())}/api/v1/getTipAccounts`;
	if (!url.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) {
		throw Object.assign(new Error(`Jito block engine URL must be https (got ${url})`), {
			code: 'insecure_block_engine_url',
		});
	}
	const res = await fetchImpl(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) {
		throw Object.assign(new Error(`getTipAccounts HTTP ${res.status}`), { code: 'tip_accounts_http' });
	}
	const body = await res.json();
	if (body?.error) {
		throw Object.assign(new Error(`getTipAccounts failed: ${JSON.stringify(body.error)}`), {
			code: 'tip_accounts_rpc',
		});
	}
	const list = body?.result;
	if (!Array.isArray(list) || list.length === 0 || !list.every((a) => typeof a === 'string' && BASE58_PUBKEY.test(a))) {
		throw Object.assign(new Error('getTipAccounts returned an unexpected payload'), {
			code: 'tip_accounts_payload',
		});
	}
	return [...new Set(list)];
}

function refreshLive(baseUrl, fetchImpl) {
	const key = normalizeBaseUrl(baseUrl);
	if (inflight.has(key)) return inflight.get(key);
	const p = fetchLiveTipAccounts({ baseUrl: key, fetchImpl })
		.then((accounts) => {
			liveCache.set(key, { accounts, at: Date.now() });
			lastFailure.delete(key);
			return accounts;
		})
		.catch((err) => {
			lastFailure.set(key, Date.now());
			throw err;
		})
		.finally(() => inflight.delete(key));
	inflight.set(key, p);
	return p;
}

function cacheState(key) {
	const hit = liveCache.get(key);
	const fresh = hit && Date.now() - hit.at < CACHE_TTL_MS;
	const failedRecently = Date.now() - (lastFailure.get(key) ?? 0) < RETRY_AFTER_FAILURE_MS;
	return { hit, fresh, failedRecently };
}

/**
 * Tip accounts without waiting on the network. Cached live list if there is one
 * (even stale), else the pinned fallback. Starts a background refresh when the
 * cache is cold or stale and the engine has not just failed.
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch }} [opts]
 * @returns {string[]}
 */
export function tipAccountsNow({ baseUrl, fetchImpl } = {}) {
	const key = normalizeBaseUrl(baseUrl || defaultBaseUrl());
	const { hit, fresh, failedRecently } = cacheState(key);
	if (!fresh && !failedRecently && typeof (fetchImpl || globalThis.fetch) === 'function') {
		refreshLive(key, fetchImpl || globalThis.fetch).catch(() => {});
	}
	return hit ? hit.accounts : JITO_TIP_ACCOUNTS;
}

/**
 * Tip accounts, awaiting a live read when the cache is cold or stale.
 * `source` is "live", "cache" (stale list kept after a failed refresh) or
 * "fallback" (pinned list, engine never reached).
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, refresh?: boolean }} [opts]
 * @returns {Promise<{ accounts: string[], source: 'live'|'cache'|'fallback', error?: string }>}
 */
export async function getTipAccounts({ baseUrl, fetchImpl = globalThis.fetch, refresh = false } = {}) {
	const key = normalizeBaseUrl(baseUrl || defaultBaseUrl());
	const { hit, fresh, failedRecently } = cacheState(key);
	if (hit && fresh && !refresh) return { accounts: hit.accounts, source: 'live' };
	if (!refresh && failedRecently) {
		return hit
			? { accounts: hit.accounts, source: 'cache' }
			: { accounts: JITO_TIP_ACCOUNTS, source: 'fallback' };
	}
	try {
		return { accounts: await refreshLive(key, fetchImpl), source: 'live' };
	} catch (err) {
		return hit
			? { accounts: hit.accounts, source: 'cache', error: err.message }
			: { accounts: JITO_TIP_ACCOUNTS, source: 'fallback', error: err.message };
	}
}

/** One tip account, chosen at random, without waiting on the network. */
export function randomTipAccountAddress(opts) {
	const list = tipAccountsNow(opts);
	return list[Math.floor(Math.random() * list.length)];
}

/** One tip account by index (wraps), without waiting on the network. */
export function tipAccountAt(index, opts) {
	const list = tipAccountsNow(opts);
	return list[((index % list.length) + list.length) % list.length];
}

/**
 * Compare the pinned fallback with the engine's live list.
 *   ok          same set
 *   drift       sets differ: `added` are live accounts missing from the pin,
 *               `removed` are pinned accounts the engine no longer lists
 *   unverified  the engine could not be read (the pinned list keeps serving)
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch }} [opts]
 */
export async function checkTipAccountDrift({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
	let live;
	try {
		live = await fetchLiveTipAccounts({ baseUrl, fetchImpl });
	} catch (err) {
		return { status: 'unverified', added: [], removed: [], error: err.message };
	}
	const pinned = new Set(JITO_TIP_ACCOUNTS);
	const liveSet = new Set(live);
	const added = live.filter((a) => !pinned.has(a));
	const removed = JITO_TIP_ACCOUNTS.filter((a) => !liveSet.has(a));
	return { status: added.length || removed.length ? 'drift' : 'ok', added, removed };
}

/** Test hook: forget every cached read and failure. */
export function resetTipAccountCache() {
	liveCache.clear();
	lastFailure.clear();
	inflight.clear();
}

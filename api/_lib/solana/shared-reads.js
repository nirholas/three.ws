// Fleet-wide short-TTL cache for public Solana reads that several routes make
// with byte-identical params.
//
// The fresh-read cache in connection.js is process-local on purpose (a few
// seconds, no network hop). That is right for a hot balance read, but it misses
// the dominant production pattern measured on 2026-11-04: a client scanning
// mints hits /api/crypto/holders, /security, /bonding and /whales for the same
// mint within ~5 seconds, and Cloud Run spreads those requests across
// instances, so each instance pays for the same getAccountInfo(mint) and
// getTokenLargestAccounts(mint) again. This module puts those reads in the
// shared cache (Redis in production, memory locally) for tens of seconds.
//
// Only use it for PUBLIC, NON-MONEY reads whose answer may be tens of seconds
// old: a mint's authorities, its largest holders, a metadata PDA. Never for a
// balance a settle, send or verify acts on (those pass `fresh: true` to
// solanaConnection and bypass every cache).
//
// What is cached: a JSON-RPC envelope with a `result` and no `error`, from a
// live lane. A stale last-good answer (x-solana-rpc-stale) is returned to the
// caller but never re-published here, so the shared tier can never extend a
// stale read's life. A thrown fetch, an HTTP error or a JSON-RPC error is never
// cached.

import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from '../cache.js';
import { recordRpcSpend } from './rpc-spend.js';

const PREFIX = 'rpcshared:v1';
const DEFAULT_TIMEOUT_MS = 25_000;
// A cache body larger than this is not worth a Redis round trip.
const MAX_CACHED_BYTES = 256 * 1024;

/** The shared-cache key for one (method, params) read. Exported for tests. */
export function sharedReadKey(method, params) {
	const digest = createHash('sha1').update(`${method}\n${JSON.stringify(params ?? [])}`).digest('base64url');
	return `${PREFIX}:${method}:${digest}`;
}

/**
 * One JSON-RPC read through `rpcFetch` (a makeRotatingFetch instance), served
 * from the fleet-wide cache while the last live answer is younger than
 * `ttlSeconds`. Resolves to the parsed JSON-RPC envelope, exactly like a direct
 * call would.
 *
 * @param {Function} rpcFetch
 * @param {string} method
 * @param {Array} params
 * @param {{ ttlSeconds: number, timeoutMs?: number }} opts
 * @returns {Promise<object>}
 */
export async function sharedRpcRead(rpcFetch, method, params, { ttlSeconds, timeoutMs = DEFAULT_TIMEOUT_MS }) {
	const key = sharedReadKey(method, params);
	const hit = await cacheGet(key).catch(() => null);
	if (hit && typeof hit === 'object' && 'result' in hit) {
		recordRpcSpend({ lane: 'cache', methods: [method] });
		return hit;
	}
	const resp = await rpcFetch(null, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await resp.text();
	const json = JSON.parse(text);
	const live = resp.ok && !resp.headers?.get?.('x-solana-rpc-stale');
	if (live && json && typeof json === 'object' && !json.error && 'result' in json && text.length <= MAX_CACHED_BYTES) {
		cacheSet(key, json, ttlSeconds).catch(() => {});
	}
	return json;
}

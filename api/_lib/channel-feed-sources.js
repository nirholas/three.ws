// Read-through sources for the channel-feed endpoint.
// Each function reads a Redis list populated by the pumpkit worker.
// Returns [] when Redis is unconfigured or unavailable.

import { Redis } from '@upstash/redis';
import { env } from './env.js';

let _redis = null;
function redis() {
	if (_redis !== null) return _redis;
	if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
		_redis = false;
		return null;
	}
	_redis = new Redis({
		url: env.UPSTASH_REDIS_REST_URL,
		token: env.UPSTASH_REDIS_REST_TOKEN,
	});
	return _redis;
}

function safeJson(s) {
	try { return JSON.parse(s); } catch { return null; }
}

async function readList(key, limit) {
	const r = redis();
	if (!r) return [];
	try {
		const items = await r.lrange(key, 0, Math.max(0, limit - 1));
		return items.map((x) => (typeof x === 'string' ? safeJson(x) : x)).filter(Boolean);
	} catch (err) {
		console.error(`[channel-feed-sources] redis read failed (${key}):`, err?.message || err);
		return [];
	}
}

// pumpkit worker pushes new mint events to pf:mints.
// Shape: { signature, mint, name, symbol, timestamp, ... }
export async function getMints(limit = 50) {
	return readList('pf:mints', limit);
}

// pumpkit worker pushes first whale-buy events to pf:whales.
// Shape: { signature, mint, amount_sol, buyer, timestamp, ... }
export async function getWhales(limit = 50) {
	return readList('pf:whales', limit);
}

// pumpkit worker pushes creator-claim events to pf:claims.
// Shape: { signature, mint, claimer, amount_lamports, timestamp, ... }
export async function getClaims(limit = 50) {
	return readList('pf:claims', limit);
}

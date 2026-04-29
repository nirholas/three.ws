// Pumpfun feed source.
//
// Reads graduation events from an Upstash Redis list populated by the
// `services/pump-graduations` worker. Claim/intel ops are stubbed out — the
// three.ws/pumpfun page only needs graduations to announce migrations.
//
// Env:
//   UPSTASH_REDIS_REST_URL    required to enable the feed
//   UPSTASH_REDIS_REST_TOKEN  required
//   GRADUATIONS_LIST_KEY      default: pf:graduations

import { Redis } from '@upstash/redis';
import { env } from './env.js';

const LIST_KEY = process.env.GRADUATIONS_LIST_KEY || 'pf:graduations';

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

export function pumpfunBotEnabled() {
	return !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

async function readGraduations(limit = 20) {
	const r = redis();
	if (!r) return [];
	try {
		const items = await r.lrange(LIST_KEY, 0, Math.max(0, limit - 1));
		return items
			.map((x) => (typeof x === 'string' ? safeJson(x) : x))
			.filter(Boolean)
			.map(toFeedShape);
	} catch (err) {
		console.error('[pumpfun-mcp] redis read failed:', err?.message || err);
		return [];
	}
}

function toFeedShape(g) {
	// Worker pushes { signature, mint, tokenName, tokenSymbol, poolAddress, timestamp }
	// Feed/widget consume { tx_signature, mint, name, symbol, ... }.
	return {
		tx_signature: g.signature,
		signature: g.signature,
		mint: g.mint,
		name: g.tokenName || null,
		symbol: g.tokenSymbol || null,
		pool_address: g.poolAddress || null,
		final_mcap: g.finalMcap ?? null,
		timestamp: g.timestamp,
	};
}

function safeJson(s) {
	try { return JSON.parse(s); } catch { return null; }
}

export const pumpfunMcp = {
	enabled: pumpfunBotEnabled,

	async listTools() {
		return { ok: true, data: { tools: ['getGraduations'] } };
	},

	async recentClaims() {
		// Not implemented in the migrations-only feed.
		return { ok: true, data: [] };
	},

	async graduations({ limit = 20 } = {}) {
		const items = await readGraduations(limit);
		return { ok: true, data: items };
	},

	async tokenIntel() {
		return { ok: false, error: 'token intel not available' };
	},

	async creatorIntel() {
		return { ok: false, error: 'creator intel not available' };
	},

	async claimsSince() {
		// No claim source — return empty list so the SSE loop just keeps polling.
		return { ok: true, data: [] };
	},
};

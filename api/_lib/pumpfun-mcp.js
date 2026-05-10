// Pumpfun MCP client — HTTP jsonrpc transport.
//
// Makes JSON-RPC calls to a MCP bot server (PUMPFUN_BOT_URL) for real-time
// pump.fun intelligence. Falls back to Redis for graduations when bot not configured.
//
// Env:
//   PUMPFUN_BOT_URL    HTTP endpoint for the MCP bot (enables bot-backed calls)
//   PUMPFUN_BOT_TOKEN  Optional Bearer token for MCP bot auth
//   UPSTASH_REDIS_REST_URL    required for Redis graduation feed fallback
//   UPSTASH_REDIS_REST_TOKEN  required for Redis graduation feed fallback
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
	return !!(process.env.PUMPFUN_BOT_URL);
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

async function jsonrpc(toolName, args) {
	const url = process.env.PUMPFUN_BOT_URL;
	if (!url) return { ok: false, error: 'bot not configured' };
	const token = process.env.PUMPFUN_BOT_TOKEN;
	const headers = { 'content-type': 'application/json' };
	if (token) headers.authorization = `Bearer ${token}`;
	const res = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } }),
	});
	if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
	const j = await res.json();
	if (j.error) return { ok: false, error: j.error.message || JSON.stringify(j.error) };
	return { ok: true, data: j.result?.structuredContent ?? j.result?.content ?? [] };
}

export const pumpfunMcp = {
	enabled: pumpfunBotEnabled,
	async recentClaims({ limit = 20 } = {}) {
		return jsonrpc('getRecentClaims', { limit });
	},
	async tokenIntel({ mint } = {}) {
		if (!mint) return { ok: false, error: 'mint is required' };
		return jsonrpc('getTokenIntel', { mint });
	},
	async graduations({ limit = 20 } = {}) {
		if (pumpfunBotEnabled()) return jsonrpc('getGraduations', { limit });
		const items = await readGraduations(limit);
		return { ok: true, data: items };
	},
	async creatorIntel({ wallet } = {}) {
		if (!wallet) return { ok: false, error: 'wallet is required' };
		return jsonrpc('getCreatorIntel', { wallet });
	},
	async claimsSince({ since } = {}) {
		return jsonrpc('getClaimsSince', { since });
	},
};

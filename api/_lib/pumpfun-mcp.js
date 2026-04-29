// Thin client for the upstream `pumpfun-claims-bot` MCP server.
//
// The bot is run as a long-lived service (e.g. Railway) that exposes a JSON-RPC
// 2.0 MCP endpoint over HTTPS. This module fans calls out to its `tools/call`
// method and caches the result in Upstash Redis when available so each Vercel
// function cold start does not re-fetch the same data.
//
// Configure via env:
//   PUMPFUN_BOT_URL       Full URL to the bot's MCP endpoint (required to enable)
//   PUMPFUN_BOT_TOKEN     Optional bearer for authenticated MCP transports
//
// All exported helpers return `{ ok, data, error }`. They never throw on
// network failure — callers degrade gracefully.

import { Redis } from '@upstash/redis';
import { env } from './env.js';

const TOOL_TIMEOUT_MS = 8000;
const CACHE_TTL_S = 60;

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
	return !!process.env.PUMPFUN_BOT_URL;
}

function botUrl() {
	const u = process.env.PUMPFUN_BOT_URL;
	if (!u) throw Object.assign(new Error('pumpfun bot not configured'), { status: 503 });
	return u.replace(/\/$/, '');
}

async function rpc(method, params) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TOOL_TIMEOUT_MS);
	try {
		const headers = { 'content-type': 'application/json', accept: 'application/json' };
		if (process.env.PUMPFUN_BOT_TOKEN) {
			headers.authorization = `Bearer ${process.env.PUMPFUN_BOT_TOKEN}`;
		}
		const r = await fetch(botUrl(), {
			method: 'POST',
			headers,
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			signal: ctrl.signal,
		});
		if (!r.ok) return { ok: false, error: `bot ${r.status}` };
		const j = await r.json();
		if (j.error) return { ok: false, error: j.error.message || 'rpc error' };
		return { ok: true, data: j.result };
	} catch (err) {
		return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : err?.message || 'fetch failed' };
	} finally {
		clearTimeout(timer);
	}
}

async function callTool(name, args, { ttl = CACHE_TTL_S } = {}) {
	const cacheKey = `pf:${name}:${JSON.stringify(args || {})}`;
	const r = redis();
	if (r) {
		try {
			const cached = await r.get(cacheKey);
			if (cached) return { ok: true, data: cached, cached: true };
		} catch {}
	}
	const res = await rpc('tools/call', { name, arguments: args || {} });
	if (!res.ok) return res;
	// MCP tool result envelope → unwrap structuredContent if present.
	const payload = res.data?.structuredContent ?? res.data?.content ?? res.data;
	if (r && payload) {
		try {
			await r.set(cacheKey, payload, { ex: ttl });
		} catch {}
	}
	return { ok: true, data: payload };
}

export const pumpfunMcp = {
	enabled: pumpfunBotEnabled,

	listTools() {
		return rpc('tools/list', {});
	},

	recentClaims({ limit = 20 } = {}) {
		return callTool('getRecentClaims', { limit }, { ttl: 30 });
	},

	graduations({ limit = 20 } = {}) {
		return callTool('getGraduations', { limit }, { ttl: 60 });
	},

	tokenIntel({ mint }) {
		if (!mint) return Promise.resolve({ ok: false, error: 'mint required' });
		return callTool('getTokenIntel', { mint }, { ttl: 120 });
	},

	creatorIntel({ wallet }) {
		if (!wallet) return Promise.resolve({ ok: false, error: 'wallet required' });
		return callTool('getCreatorIntel', { wallet }, { ttl: 300 });
	},

	// Polling helper: serverless cannot hold a long-lived subscription, so the
	// browser-side watch skill polls this and dedupes by tx signature.
	claimsSince({ sinceSig = null, limit = 50 } = {}) {
		return callTool('getClaimsSince', { sinceSig, limit }, { ttl: 5 });
	},
};

// Distributed rate limiting via Upstash Redis. Falls back to in-memory for local dev.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { env } from './env.js';

let redis = null;
if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
	redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
}

const limiters = new Map();
const memoryBuckets = new Map();

function getLimiter(name, opts) {
	const key = `${name}:${opts.limit}:${opts.window}`;
	if (limiters.has(key)) return limiters.get(key);
	if (!redis) {
		const lim = memoryLimiter(opts);
		limiters.set(key, lim);
		return lim;
	}
	const rl = new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(opts.limit, opts.window),
		prefix: `rl:${name}`,
		analytics: false,
	});
	limiters.set(key, rl);
	return rl;
}

function memoryLimiter({ limit, window }) {
	const ms = parseWindowMs(window);
	return {
		async limit(id) {
			const now = Date.now();
			const bucket = memoryBuckets.get(id) || [];
			const cutoff = now - ms;
			const kept = bucket.filter((t) => t > cutoff);
			if (kept.length >= limit) {
				memoryBuckets.set(id, kept);
				return { success: false, limit, remaining: 0, reset: kept[0] + ms };
			}
			kept.push(now);
			memoryBuckets.set(id, kept);
			return { success: true, limit, remaining: limit - kept.length, reset: now + ms };
		},
	};
}

function parseWindowMs(w) {
	const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(w);
	if (!m) return 60_000;
	const n = parseInt(m[1], 10);
	const unit = m[2];
	return n * { ms: 1, s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[unit];
}

// Preset limiters. Tune once viral traffic shape is known.
export const limits = {
	authIp: (ip) => getLimiter('auth:ip', { limit: 30, window: '10 m' }).limit(ip),
	registerIp: (ip) => getLimiter('register:ip', { limit: 5, window: '1 h' }).limit(ip),
	oauthRegisterIp: (ip) => getLimiter('oauth:register:ip', { limit: 10, window: '1 h' }).limit(ip),
	mcpUser: (userId) => getLimiter('mcp:user', { limit: 1200, window: '1 m' }).limit(userId),
	mcpIp: (ip) => getLimiter('mcp:ip', { limit: 600, window: '1 m' }).limit(ip),
	mcpValidate: (key) => getLimiter('mcp:validate', { limit: 10, window: '1 m' }).limit(key),
	mcpInspect:  (key) => getLimiter('mcp:inspect',  { limit: 30, window: '1 m' }).limit(key),
	mcpOptimize: (key) => getLimiter('mcp:optimize', { limit: 10, window: '1 m' }).limit(key),
	oauthToken: (clientId) => getLimiter('oauth:token', { limit: 120, window: '1 m' }).limit(clientId),
	upload: (userId) => getLimiter('upload', { limit: 60, window: '1 h' }).limit(userId),
	chatUser: (userId) => getLimiter('chat:user', { limit: 20, window: '1 m' }).limit(userId),
	chatIp: (ip) => getLimiter('chat:ip', { limit: 40, window: '1 m' }).limit(ip),
	widgetWrite: (userId) => getLimiter('widget:write', { limit: 60, window: '1 m' }).limit(userId),
	widgetRead: (ip) => getLimiter('widget:read', { limit: 600, window: '1 m' }).limit(ip),
	// Per-widget visitor chat. Limit is dynamic — one bucket per (widgetId, perMinute).
	widgetChat: ({ ip, widgetId, perMinute }) =>
		getLimiter('widget:chat', { limit: Math.max(1, Math.min(60, perMinute || 8)), window: '1 m' })
			.limit(`${widgetId}:${ip}`),
};

// Trust only proxy headers that Vercel itself sets and signs. Naively reading
// X-Forwarded-For lets clients supply it directly on direct invocations, which
// trivially bypasses per-IP rate limits by rotating the claimed address.
export function clientIp(req) {
	const vercel = req.headers['x-vercel-forwarded-for'];
	if (vercel) return String(vercel).split(',')[0].trim();
	const real = req.headers['x-real-ip'];
	if (real) return String(real).trim();
	// Last resort — socket address (only meaningful on direct connections).
	return req.socket?.remoteAddress || '0.0.0.0';
}

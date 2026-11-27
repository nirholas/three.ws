// Fairness and accuracy of the generation limiters: a request Forge itself
// failed is not charged, the daily cap says when it resets, and nothing the
// caller controls can mint a fresh allowance.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

function makeSqlStub() {
	const rows = new Map();
	const sql = (strings, ...values) => {
		const text = strings.join('?');
		if (/DELETE FROM rate_limit_counters/i.test(text)) return Promise.resolve([]);
		const key = `${values[0]}\u0000${values[1]}`;
		if (/INSERT INTO rate_limit_counters/i.test(text)) {
			rows.set(key, (rows.get(key) || 0) + 1);
			return Promise.resolve([{ hits: rows.get(key) }]);
		}
		if (/UPDATE rate_limit_counters/i.test(text)) {
			if (!rows.has(key)) return Promise.resolve([]);
			rows.set(key, Math.max(0, rows.get(key) - 1));
			return Promise.resolve([{ hits: rows.get(key) }]);
		}
		return Promise.resolve([]);
	};
	return { sql };
}

async function load({ redis = null, sqlStub = makeSqlStub(), production = false, ratelimit } = {}) {
	vi.resetModules();
	vi.doMock('../api/_lib/db.js', () => ({ sql: sqlStub.sql }));
	vi.doMock('../api/_lib/redis.js', () => ({ getRedis: () => redis, isRedisAuthError: () => false }));
	vi.doMock('../api/_lib/env.js', () => ({
		env: {
			NODE_ENV: production ? 'production' : 'test',
			VERCEL_ENV: production ? 'production' : 'development',
			DATABASE_URL: 'postgres://stub/db',
			CACHE_REDIS_CMD_TIMEOUT_MS: 3000,
		},
	}));
	if (ratelimit) vi.doMock('@upstash/ratelimit', () => ({ Ratelimit: ratelimit }));
	return import('../api/_lib/rate-limit.js');
}

beforeEach(() => vi.stubEnv('VITEST', '1'));
afterEach(() => {
	vi.unstubAllEnvs();
	vi.doUnmock('../api/_lib/db.js');
	vi.doUnmock('../api/_lib/redis.js');
	vi.doUnmock('../api/_lib/env.js');
	vi.doUnmock('@upstash/ratelimit');
});

function fakeRes(status) {
	const res = new EventEmitter();
	res.statusCode = status;
	return res;
}

describe('refundOnServerFailure', () => {
	it('refunds once when Forge answers with a 5xx', async () => {
		const { refundOnServerFailure } = await load();
		const refund = vi.fn().mockResolvedValue(true);
		const res = fakeRes(503);
		refundOnServerFailure(res, refund);
		res.emit('finish');
		res.emit('finish');
		await new Promise((r) => setTimeout(r, 0));
		expect(refund).toHaveBeenCalledTimes(1);
	});

	it.each([200, 202, 400, 402, 422, 429])('keeps the charge for a %i', async (status) => {
		const { refundOnServerFailure } = await load();
		const refund = vi.fn();
		const res = fakeRes(status);
		refundOnServerFailure(res, refund);
		res.emit('finish');
		await new Promise((r) => setTimeout(r, 0));
		expect(refund).not.toHaveBeenCalled();
	});

	it('swallows a refund that itself fails', async () => {
		const { refundOnServerFailure } = await load();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const res = fakeRes(500);
		refundOnServerFailure(res, () => Promise.reject(new Error('store down')));
		res.emit('finish');
		await new Promise((r) => setTimeout(r, 0));
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe('the generation allowance after a Forge failure', () => {
	it('gives the hourly hit back on the paid bucket (durable counter)', async () => {
		const { limits } = await load();
		const before = await limits.mcp3dGenerate('user:a');
		await limits.mcp3dGenerate('user:a');
		await limits.mcp3dGenerateRefund('user:a');
		const after = await limits.mcp3dGenerate('user:a');
		expect(after.remaining).toBe(before.remaining - 1);
	});

	it('gives the hourly hit back on the free bucket', async () => {
		const { limits } = await load();
		const first = await limits.mcp3dGenerateFreeTiered('user:b', 1);
		await limits.mcp3dGenerateFreeRefund('user:b', 1);
		const again = await limits.mcp3dGenerateFreeTiered('user:b', 1);
		expect(again.remaining).toBe(first.remaining);
	});

	it('returns exactly one token on a Redis multi-use window, not the whole bucket', async () => {
		const calls = [];
		class Ratelimit {
			static slidingWindow() { return {}; }
			async limit(id, opts) {
				calls.push(['limit', id, opts]);
				return { success: true, limit: 30, remaining: 29, reset: Date.now() + 1000 };
			}
			async resetUsedTokens(id) { calls.push(['reset', id]); }
		}
		const { limits } = await load({ redis: {}, ratelimit: Ratelimit });
		await limits.mcp3dGenerateRefund('user:c');
		expect(calls).toEqual([['limit', 'user:c', { rate: -1 }]]);
	});
});

describe('429 shape', () => {
	it('carries the code, the limit name, retry-after and the standard headers', async () => {
		vi.resetModules();
		const { rateLimited } = await import('../api/_lib/http.js');
		const headers = {};
		let body;
		const res = {
			statusCode: 0,
			setHeader: (k, v) => (headers[k.toLowerCase()] = v),
			getHeader: (k) => headers[k.toLowerCase()],
			end: (b) => (body = JSON.parse(b)),
		};
		rateLimited(res, { limit: 30, remaining: 0, reset: Date.now() + 90_000 }, 'x', { limit: 'generation_hourly' });
		expect(res.statusCode).toBe(429);
		expect(body.error).toBe('rate_limited');
		expect(body.limit).toBe('generation_hourly');
		expect(body.retry_after).toBeGreaterThanOrEqual(89);
		expect(headers['retry-after']).toBe(String(body.retry_after));
		expect(headers['ratelimit-limit']).toBe('30');
		expect(headers['ratelimit-remaining']).toBe('0');
		expect(Number(headers['ratelimit-reset'])).toBeGreaterThanOrEqual(89);
	});
});

describe('daily paid cap', () => {
	it('says when it resets and hands a hit back', async () => {
		const store = new Map();
		const redis = {
			incr: async (k) => store.set(k, (store.get(k) || 0) + 1).get(k),
			decr: async (k) => store.set(k, (store.get(k) || 0) - 1).get(k),
			set: async (k, v) => store.set(k, v),
			expire: async () => 1,
			get: async () => null,
		};
		vi.resetModules();
		vi.doMock('../api/_lib/redis.js', () => ({ getRedis: () => redis, isRedisAuthError: () => false }));
		const { dailyPaidAllowed, dailyPaidRefund } = await import('../api/_lib/forge-scale.js');
		const a = await dailyPaidAllowed('user:d', { limit: 1 });
		expect(a.ok).toBe(true);
		expect(a.resetAt % 86_400_000).toBe(0);
		expect(a.resetAt).toBeGreaterThan(Date.now());
		expect((await dailyPaidAllowed('user:d', { limit: 1 })).ok).toBe(false);
		await dailyPaidRefund('user:d');
		await dailyPaidRefund('user:d');
		expect((await dailyPaidAllowed('user:d', { limit: 1 })).ok).toBe(true);
		vi.doUnmock('../api/_lib/redis.js');
	});
});

describe('client identity', () => {
	it('ignores caller-supplied forwarded entries behind the load balancer', async () => {
		const { clientIp } = await load();
		const mk = (xff, host = 'three.ws') => ({ headers: { 'x-forwarded-for': xff, host } });
		const real = '203.0.113.9';
		expect(clientIp(mk(`6.6.6.6, ${real}, 34.1.1.1`))).toBe(real);
		expect(clientIp(mk(`7.7.7.7, 8.8.8.8, ${real}, 34.1.1.1`))).toBe(real);
	});

	it('does not read x-real-ip or x-forge-client for the address', async () => {
		const { clientIp } = await load();
		const req = {
			headers: { 'x-real-ip': '9.9.9.9', 'x-forge-client': 'abc', 'x-forwarded-for': '203.0.113.9, 34.1.1.1' },
			socket: { remoteAddress: '10.0.0.1' },
		};
		expect(clientIp(req)).toBe('203.0.113.9');
	});
});

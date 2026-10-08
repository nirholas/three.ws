/**
 * Coin Clash roster failover tests.
 *
 * /clash must stay playable without a CoinCommunities key: when CC is
 * unconfigured (or its upstream errors) GET /api/clash/state and
 * /api/clash/leaderboard seed the round from the live trending feed instead of
 * answering 503. That roster is frozen for the round, so a trending feed that
 * reorders between polls cannot re-pair battles mid-round. The original error
 * envelopes surface only when the trending feed is ALSO unavailable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

vi.mock('../api/_lib/rate-limit.js', () => {
	const ok = vi.fn(async () => ({ success: true, reset: Date.now() + 60_000 }));
	return { limits: { clashStateIp: ok, clashEnlistIp: ok, clashRallyIp: ok }, clientIp: () => '127.0.0.1' };
});

vi.mock('../api/_lib/balances.js', () => ({
	getBalances: vi.fn(async () => ({ native: 0, tokens: [] })),
	solanaMintUsdPrice: vi.fn(async () => 0),
}));

const ccState = { configured: false, communities: null, apiError: null };
vi.mock('../api/_lib/coin-communities.js', async () => {
	const actual = await vi.importActual('../api/_lib/coin-communities.js');
	return {
		...actual,
		cc: vi.fn(() => {
			if (!ccState.configured) throw new actual.UnconfiguredError();
			return {
				getTopCommunities: async () =>
					ccState.apiError
						? { data: null, error: ccState.apiError }
						: { data: { communities: ccState.communities ?? [] }, error: null },
			};
		}),
	};
});

const trending = { data: null };
vi.mock('../api/_lib/pump-trending.js', () => ({
	getTrendingSlim: vi.fn(async (limit) => ({ data: trending.data ? trending.data.slice(0, limit) : null, stale: false })),
}));

const { default: handler } = await import('../api/clash/[action].js');

const mint = (c) => `THREEsynthetic111111111111111111111111${c}`;
const row = (c, i) => ({
	mint: mint(c),
	symbol: `T${c}`,
	name: `Synthetic ${c}`,
	logo: null,
	price_usd: null,
	usd_market_cap: 1_000_000 * (i + 1),
	rank: i + 1,
});

async function call(action) {
	const res = { statusCode: 200, _h: {} };
	res.setHeader = (k, v) => {
		res._h[k] = v;
	};
	res.getHeader = (k) => res._h[k];
	res.end = (b) => {
		res._b = b;
	};
	res.json = () => JSON.parse(res._b);
	const req = {
		method: 'GET',
		url: `/api/clash/${action}`,
		query: { action },
		headers: { origin: 'https://three.ws' },
		socket: { remoteAddress: '127.0.0.1' },
	};
	await handler(req, res);
	return res;
}

const sideTokens = (data) => data.arena.flatMap((b) => [b.a.token, b.b?.token]).filter(Boolean).sort();

beforeEach(() => {
	ccState.configured = false;
	ccState.communities = null;
	ccState.apiError = null;
	trending.data = null;
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('clash roster without CoinCommunities', () => {
	it('seeds the round from trending instead of answering 503', async () => {
		trending.data = ['A', 'B', 'C', 'D'].map(row);
		const res = await call('state');
		expect(res.statusCode).toBe(200);
		const { data } = res.json();
		expect(data.source).toBe('pump-trending');
		expect(data.factionCount).toBe(4);
		expect(sideTokens(data)).toEqual(['A', 'B', 'C', 'D'].map(mint).sort());
		const side = data.arena[0].a;
		expect(side.social).toBe(false);
		expect(side.marketCapUsd).toBeGreaterThan(0);
	});

	it('keeps the round roster frozen when trending reorders mid-round', async () => {
		trending.data = ['E', 'F', 'G', 'H'].map(row);
		const first = (await call('state')).json().data;
		trending.data = ['J', 'K', 'L', 'M'].map(row);
		const second = (await call('state')).json().data;
		expect(second.epoch).toBe(first.epoch);
		expect(sideTokens(second)).toEqual(sideTokens(first));
	});

	it('serves the leaderboard from the same frozen roster', async () => {
		const res = await call('leaderboard');
		expect(res.statusCode).toBe(200);
		const { data } = res.json();
		expect(data.source).toBe('pump-trending');
		expect(data.board.length).toBeGreaterThan(0);
		expect(data.board.every((f) => f.social === false)).toBe(true);
	});
});

describe('clash roster with CoinCommunities', () => {
	it('prefers CC communities and tags them coincommunities', async () => {
		ccState.configured = true;
		ccState.communities = [
			{ tokenAddress: mint('N'), tokenSymbol: 'TN', memberCount: 40 },
			{ tokenAddress: mint('P'), tokenSymbol: 'TP', memberCount: 12 },
		];
		const res = await call('state');
		expect(res.statusCode).toBe(200);
		const { data } = res.json();
		expect(data.source).toBe('coincommunities');
		expect(sideTokens(data)).toEqual([mint('N'), mint('P')].sort());
		expect(data.arena[0].a.social).toBe(true);
	});
});

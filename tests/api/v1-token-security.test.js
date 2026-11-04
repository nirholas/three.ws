// GET /api/v1/token/security — free on-chain rug/risk facts for a Solana token.
//
// The endpoint composes three real upstreams into one report agents weigh
// themselves: getAccountInfo (mint/freeze authority, supply, decimals),
// getTokenLargestAccounts (holder concentration), and DexScreener (liquidity
// depth + pair age). The tests pin the contract that matters:
//   • the full report against captured REAL-shaped $THREE fixtures,
//   • each factual flag's trigger condition (pure builder),
//   • partial-upstream failure → per-section nulls + an honest `sources` array,
//   • EVM 0x… input → 400, an unresolvable mint → 404, every source down → 503,
//   • the per-IP rate limit → 429,
//   • the /api/v1 catalog entry is present with the uniqueness-first summary.
//
// The rate limiter is mocked and the network is stubbed via global fetch (real
// Response objects, so the RPC failover chain + fetchTokenMarket run unchanged),
// so the suite runs fully offline while exercising the real handler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { _resetReadCache } from '../../api/_lib/solana/connection.js';

// $THREE — the only mint that ever appears in these fixtures (per the $THREE rule).
const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

// Switchable per-IP quota result — flip `quotaOk` per test. apiV1 (the gateway's
// shared burst guard) always passes; it isn't the thing under test.
let quotaOk = true;
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		apiV1: async () => ({ success: true, limit: 120, remaining: 119, reset: Date.now() + 60_000 }),
		tokenSecurityIp: async () =>
			quotaOk
				? { success: true, limit: 20, remaining: 19, reset: Date.now() + 60_000 }
				: { success: false, limit: 20, remaining: 0, reset: Date.now() + 60_000 },
	},
	clientIp: () => '203.0.113.7',
}));

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
	quotaOk = true;
	// The RPC fresh-read cache is process-local: forget it so one case's answer is never served to the next.
	_resetReadCache();
});
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

// ── Captured REAL upstream shapes for $THREE (curled 2026-07) ──────────────────
// getAccountInfo(jsonParsed): a spl-token-2022 mint with BOTH authorities revoked.
const ACCOUNT_INFO_THREE = {
	jsonrpc: '2.0',
	id: 1,
	result: {
		context: { apiVersion: '4.1.0', slot: 431265387 },
		value: {
			data: {
				parsed: {
					info: {
						decimals: 6,
						freezeAuthority: null,
						isInitialized: true,
						mintAuthority: null,
						supply: '999683523471616',
					},
					type: 'mint',
				},
				program: 'spl-token-2022',
				space: 411,
			},
			executable: false,
			lamports: 46804176073,
			owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
			space: 411,
		},
	},
};

// getTokenLargestAccounts: the 10 largest token accounts (real top-8 amounts + 2).
const LARGEST_THREE = {
	jsonrpc: '2.0',
	id: 1,
	result: {
		context: { apiVersion: '4.1.0', slot: 431265459 },
		value: [
			{ address: '5jeRNm8Rx8CrbhbiyNWE4wStfrtfrVpXU76cK9jovyGd', amount: '65966857333250', decimals: 6, uiAmount: 65966857.33325 },
			{ address: 'CRRtkr9sSgDxhirY7KVYJMjjgyxSP2BqgC3NED6PkEte', amount: '21891366278164', decimals: 6, uiAmount: 21891366.278164 },
			{ address: 'GipFNVyMfKWRD4A53CYD8eSDqntTv9X9LneaJ6zKjxFT', amount: '21562197571639', decimals: 6, uiAmount: 21562197.571639 },
			{ address: 'ErJ5BUo1jzr5Z4khfKP3ZUUDDfyNnv3oFn8zDa5pXSik', amount: '18906305767556', decimals: 6, uiAmount: 18906305.767556 },
			{ address: 'AMCFm1nhxqBkzbvpsg8xL3BuAWuAkWY6qfdFjRZJn1dD', amount: '18864076135934', decimals: 6, uiAmount: 18864076.135934 },
			{ address: 'Cm9EortGHm7Fv53E2XxfKxSPuRG8KTHzdx2JsH3o4ZQ1', amount: '18757358726434', decimals: 6, uiAmount: 18757358.726434 },
			{ address: 'DsRx83xQmYse1nkjwiZsKrMoteLT3UBXSgZNuRdbVCn5', amount: '18627604005087', decimals: 6, uiAmount: 18627604.005087 },
			{ address: '2AdZHcsXgz7eAf4FK4ghr9UTsuMQMJMtWgFPD38iYHwz', amount: '17614659953367', decimals: 6, uiAmount: 17614659.953367 },
			{ address: '8LEGhAhdYHPkbxTr5mdcmYeBSynthPlaceholder001', amount: '15000000000000', decimals: 6, uiAmount: 15000000 },
			{ address: '9MFHbBidZIPlcyUs6ndanZfCSynthPlaceholder002', amount: '12000000000000', decimals: 6, uiAmount: 12000000 },
		],
	},
};

// DexScreener /tokens/<mint>: the deepest pair (three/SOL on pumpswap) first.
const DEXSCREENER_THREE = {
	schemaVersion: '1.0.0',
	pairs: [
		{
			chainId: 'solana',
			dexId: 'pumpswap',
			url: 'https://dexscreener.com/solana/5byl7mzolabynwmpzkpkjf4mgkz7febzranos19pre2z',
			pairAddress: '5ByL7MZoLABYnwMPZKPKjf4MGkZ7FeBzrAnos19Pre2z',
			baseToken: { address: THREE, name: 'three.ws', symbol: 'three' },
			quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
			priceUsd: '0.001492',
			txns: { h24: { buys: 28926, sells: 11565 } },
			volume: { h24: 418360.79 },
			priceChange: { h24: -1.23 },
			liquidity: { usd: 196695.93, base: 65955621, quote: 1198.7522 },
			fdv: 1492140,
			marketCap: 1492140,
			pairCreatedAt: 1777446541000,
			info: { imageUrl: 'https://cdn.dexscreener.com/x.png' },
		},
	],
};

// A real WHATWG Response so the RPC failover chain (resp.text/clone) and
// fetchTokenMarket (r.ok/r.json) both run against genuine transport objects.
function jsonResponse(obj, { status = 200 } = {}) {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

// Route the stub by URL (DexScreener vs Solana RPC) and, for RPC, by method.
function makeFetch({ account, largest, dex } = {}) {
	return vi.fn(async (url, init) => {
		const u = String(url);
		if (u.includes('dexscreener.com')) {
			return dex ?? jsonResponse(DEXSCREENER_THREE);
		}
		const method = JSON.parse(init?.body || '{}').method;
		if (method === 'getAccountInfo') return account ?? jsonResponse(ACCOUNT_INFO_THREE);
		if (method === 'getTokenLargestAccounts') return largest ?? jsonResponse(LARGEST_THREE);
		return jsonResponse({ jsonrpc: '2.0', id: 1, result: null });
	});
}

function makeReq({ url = `/api/v1/token/security?address=${THREE}`, host = 'three.ws' } = {}) {
	const stream = Readable.from([]);
	stream.method = 'GET';
	stream.url = url;
	stream.headers = { host };
	return stream;
}

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; this.writableEnded = true; },
	};
}

async function dispatch(req, res) {
	const mod = await import('../../api/v1/token/security.js');
	await mod.default(req, res);
	return { res, body: res._body ? JSON.parse(res._body) : null };
}

// ── Full report against captured real shapes ──────────────────────────────────
describe('GET /api/v1/token/security — full report', () => {
	it('composes authorities, concentration, and liquidity for $THREE', async () => {
		globalThis.fetch = makeFetch();
		const { res, body } = await dispatch(makeReq(), makeRes());
		expect(res.statusCode).toBe(200);
		const d = body.data;
		expect(d.address).toBe(THREE);
		expect(d.chain).toBe('solana');
		// Both authorities revoked (null on chain) → revoked:true, address:null.
		expect(d.mint_authority).toEqual({ revoked: true, address: null });
		expect(d.freeze_authority).toEqual({ revoked: true, address: null });
		expect(d.supply).toBe('999683523471616');
		expect(d.decimals).toBe(6);
		// Concentration: top-1 ≈ 6.6% of supply, 10 accounts sampled.
		expect(d.top_holders.holders_sampled).toBe(10);
		expect(d.top_holders.top1_pct).toBeCloseTo(6.6, 1);
		expect(d.top_holders.top10_pct).toBeGreaterThan(d.top_holders.top1_pct);
		// Liquidity: deepest pair label + creation time from DexScreener.
		expect(d.liquidity.usd).toBeCloseTo(196695.93, 2);
		expect(d.liquidity.largest_pair).toBe('three/SOL');
		expect(d.liquidity.pair_created_at).toBe(1777446541000);
		// A healthy, established token trips no factual flags.
		expect(d.flags).toEqual([]);
		expect(d.sources).toEqual(['solana-rpc', 'dexscreener']);
		expect(typeof d.ts).toBe('number');
		// Public read is edge-cacheable for 60s.
		expect(res.getHeader('cache-control')).toMatch(/s-maxage=60/);
	});
});

// ── Each factual flag's trigger (pure builder) ────────────────────────────────
describe('buildSecurityReport — flag triggers', () => {
	const NOW = 1_780_000_000_000;

	function mintResult({ mintAuthority = null, freezeAuthority = null, supply = '1000000', decimals = 6 } = {}) {
		return { value: { data: { parsed: { type: 'mint', info: { mintAuthority, freezeAuthority, supply, decimals } } } } };
	}

	it('flags active mint + freeze authorities', async () => {
		const { buildSecurityReport } = await import('../../api/v1/token/security.js');
		const { body } = buildSecurityReport({
			address: THREE,
			account: { answered: true, result: mintResult({ mintAuthority: 'MintAuth1111111111111111111111111111111111', freezeAuthority: 'FrzAuth11111111111111111111111111111111111' }) },
			largest: { answered: false },
			market: { answered: false },
		}, NOW);
		expect(body.flags).toContain('mint_authority_active');
		expect(body.flags).toContain('freeze_authority_active');
		expect(body.mint_authority).toEqual({ revoked: false, address: 'MintAuth1111111111111111111111111111111111' });
	});

	it('flags a top-1 holder over 20%', async () => {
		const { buildSecurityReport } = await import('../../api/v1/token/security.js');
		const { body } = buildSecurityReport({
			address: THREE,
			account: { answered: true, result: mintResult({ supply: '1000000' }) },
			largest: { answered: true, result: { value: [{ amount: '300000' }, { amount: '10000' }] } },
			market: { answered: false },
		}, NOW);
		expect(body.top_holders.top1_pct).toBe(30);
		expect(body.flags).toContain('top1_holder_over_20pct');
	});

	it('flags top-10 holders over 80%', async () => {
		const { buildSecurityReport } = await import('../../api/v1/token/security.js');
		const value = Array.from({ length: 10 }, () => ({ amount: '90000' })); // 900k of 1M = 90%
		const { body } = buildSecurityReport({
			address: THREE,
			account: { answered: true, result: mintResult({ supply: '1000000' }) },
			largest: { answered: true, result: { value } },
			market: { answered: false },
		}, NOW);
		expect(body.top_holders.top10_pct).toBe(90);
		expect(body.flags).toContain('top10_holders_over_80pct');
	});

	it('flags liquidity under $10k and a pair younger than 24h', async () => {
		const { buildSecurityReport } = await import('../../api/v1/token/security.js');
		const { body } = buildSecurityReport({
			address: THREE,
			account: { answered: false },
			largest: { answered: false },
			market: { answered: true, data: { liquidity_usd: 4200, pair_label: 'three/SOL', pair_created_at: NOW - 3_600_000 } },
		}, NOW);
		expect(body.flags).toContain('liquidity_under_10k');
		expect(body.flags).toContain('pair_younger_than_24h');
		expect(body.liquidity.usd).toBe(4200);
	});
});

// ── Partial-upstream failure: per-section nulls + honest sources ──────────────
describe('buildSecurityReport — partial degradation', () => {
	it('nulls the liquidity section and drops dexscreener from sources when DexScreener fails', async () => {
		const { buildSecurityReport } = await import('../../api/v1/token/security.js');
		const { resolved, allFailed, body } = buildSecurityReport({
			address: THREE,
			account: { answered: true, result: ACCOUNT_INFO_THREE.result },
			largest: { answered: true, result: LARGEST_THREE.result },
			market: { answered: false },
		}, 1_780_000_000_000);
		expect(resolved).toBe(true);
		expect(allFailed).toBe(false);
		expect(body.liquidity).toEqual({ usd: null, largest_pair: null, pair_created_at: null });
		expect(body.sources).toEqual(['solana-rpc']);
		expect(body.supply).toBe('999683523471616');
	});

	it('nulls the on-chain section and keeps only dexscreener when RPC fails', async () => {
		const { buildSecurityReport } = await import('../../api/v1/token/security.js');
		const { body } = buildSecurityReport({
			address: THREE,
			account: { answered: false },
			largest: { answered: false },
			market: { answered: true, data: { liquidity_usd: 196695.93, pair_label: 'three/SOL', pair_created_at: 1777446541000 } },
		}, 1_780_000_000_000);
		expect(body.mint_authority).toEqual({ revoked: null, address: null });
		expect(body.freeze_authority).toEqual({ revoked: null, address: null });
		expect(body.supply).toBeNull();
		expect(body.top_holders).toEqual({ top1_pct: null, top5_pct: null, top10_pct: null, holders_sampled: null });
		expect(body.sources).toEqual(['dexscreener']);
	});
});

// ── HTTP boundary: input validation + status codes ────────────────────────────
describe('GET /api/v1/token/security — boundaries', () => {
	it('rejects an EVM 0x… address with a Solana-only 400', async () => {
		globalThis.fetch = makeFetch();
		const url = '/api/v1/token/security?address=0x1234567890abcdef1234567890abcdef12345678';
		const { res, body } = await dispatch(makeReq({ url }), makeRes());
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('unsupported_chain');
		expect(body.error_description).toMatch(/Solana/i);
		// Never touched an upstream on a rejected input.
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('rejects a missing address with 400', async () => {
		globalThis.fetch = makeFetch();
		const { res, body } = await dispatch(makeReq({ url: '/api/v1/token/security' }), makeRes());
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('validation_error');
	});

	it('returns 404 when no source can resolve the mint', async () => {
		globalThis.fetch = makeFetch({
			account: jsonResponse({ jsonrpc: '2.0', id: 1, result: { context: {}, value: null } }),
			largest: jsonResponse({ jsonrpc: '2.0', id: 1, result: { context: {}, value: [] } }),
			dex: jsonResponse({ schemaVersion: '1.0.0', pairs: [] }),
		});
		const { res, body } = await dispatch(makeReq(), makeRes());
		expect(res.statusCode).toBe(404);
		expect(body.error).toBe('not_found');
	});

	it('returns 503 when every source is down', async () => {
		globalThis.fetch = vi.fn(async () => { throw new Error('network down'); });
		const { res, body } = await dispatch(makeReq(), makeRes());
		expect(res.statusCode).toBe(503);
		expect(body.error).toBe('sources_unavailable');
	});

	it('returns 429 when the per-IP quota is exhausted', async () => {
		globalThis.fetch = makeFetch();
		quotaOk = false;
		const { res, body } = await dispatch(makeReq(), makeRes());
		expect(res.statusCode).toBe(429);
		expect(body.error).toBe('rate_limited');
		expect(res.getHeader('retry-after')).toBeTruthy();
		// The upstreams are never hit once the quota is spent.
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
});

// ── Catalog registration ──────────────────────────────────────────────────────
describe('/api/v1 catalog', () => {
	it('registers the token security endpoint with the uniqueness-first summary', async () => {
		const { CATALOG } = await import('../../api/v1/_catalog.js');
		const entry = CATALOG.find((e) => e.id === 'v1.token.security');
		expect(entry).toBeTruthy();
		expect(entry.method).toBe('GET');
		expect(entry.path).toBe('/api/v1/token/security');
		expect(entry.auth).toBe('public');
		expect(entry.summary).toMatch(/^Rug-check any Solana token in one free call/);
	});
});

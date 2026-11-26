// api/_lib/pump-creator-fees.js: the pump.fun creator-fee reads behind the
// earnings snapshot and the coin page. Payload shapes are the ones pump.fun
// returns for frontend-api-v3 /fees/creator/<wallet>, captured 2026-10-08 after
// pump.fun retired the /v1/creators routes. On 2026-11-25 pump.fun also retired
// every swap-api route this module read besides it (/v2/creators/<w>/fees/total,
// /v1/coins/<mint>/timeline, /v1/fee-sharing/account/<w>/shares: each now 404
// "Cannot GET" for every input), so /fees/creator is the one source left.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fetchCreatorFeeTotal, fetchCreatorFeeBuckets, fetchCoinEarnings } = await import(
	'../api/_lib/pump-creator-fees.js'
);
const { _resetBreakers } = await import('../api/_lib/resilience.js');

const WALLET = 'THREEsynthetic11111111111111111111111111111';
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const WSOL = 'So11111111111111111111111111111111111111112';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const originalFetch = global.fetch;
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body });
const solLeg = (raw) => ({ quote: { chainId: SOLANA, address: WSOL }, amount: { raw, decimals: 9 }, usd: '1.0' });
const earnings = ({ earned = [solLeg('73148608')], series = [] } = {}) => ({
	creator: WALLET,
	interval: '1d',
	period: '30d',
	earned,
	isClaimable: true,
	claimable: { usd: '0.5', native: '0.004', nativeAsset: { chainId: SOLANA, address: '', symbol: 'SOL' } },
	series,
});

beforeEach(() => _resetBreakers());
afterEach(() => {
	global.fetch = originalFetch;
});

describe('fetchCreatorFeeTotal', () => {
	it('reads lifetime lamports from the SOL leg of /fees/creator', async () => {
		global.fetch = vi.fn(async (url) => {
			expect(String(url)).toContain(`/fees/creator/${WALLET}?interval=1d&period=30d`);
			return reply(200, earnings());
		});
		expect(await fetchCreatorFeeTotal(WALLET)).toEqual({ ok: true, value: 73148608n });
	});

	it('treats a wallet with no SOL earnings as a healthy zero, not a failure', async () => {
		global.fetch = vi.fn(async () => reply(200, earnings({ earned: [] })));
		expect(await fetchCreatorFeeTotal(WALLET)).toEqual({ ok: true, value: 0n });
	});

	it('reports a failure (not a zero) so the caller keeps its last good figure, without calling a retired route', async () => {
		global.fetch = vi.fn(async () => reply(503, { degraded_lanes: ['trade_api.get_fees'] }));
		const r = await fetchCreatorFeeTotal(WALLET);
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/503/);
		expect(global.fetch.mock.calls.every(([url]) => String(url).includes('/fees/creator/'))).toBe(true);
	});
});

describe('fetchCreatorFeeBuckets', () => {
	it('keeps only non-zero SOL buckets, as lamports with ISO starts', async () => {
		global.fetch = vi.fn(async (url) => {
			expect(String(url)).toContain('interval=30m&period=7d');
			return reply(
				200,
				earnings({
					series: [
						{ bucketStart: Date.parse('2026-10-07T12:00:00.000Z'), earned: { native: '0.000404407' }, byQuote: [solLeg('404407')] },
						{ bucketStart: Date.parse('2026-10-07T11:30:00.000Z'), earned: { native: '0' }, byQuote: [solLeg('0')] },
						{ bucketStart: Date.parse('2026-10-07T11:00:00.000Z'), earned: { native: '0' }, byQuote: [] },
					],
				}),
			);
		});
		const r = await fetchCreatorFeeBuckets(WALLET, '30m');
		expect(r).toEqual({
			ok: true,
			value: [{ bucket_start: '2026-10-07T12:00:00.000Z', fee_lamports: 404407n, num_trades: null }],
		});
	});

	it('fails on a body without a series', async () => {
		global.fetch = vi.fn(async () => reply(200, { statusCode: 400, message: 'interval must be one of' }));
		const r = await fetchCreatorFeeBuckets(WALLET, '1d');
		expect(r.ok).toBe(false);
	});
});

// The per-coin timeline the coin page and snapshot read answered 404 for every
// mint after 2026-11-25, and fetchCoinEarnings took a 404 to mean "this coin
// never paid the wallet": every coin showed "This coin paid 0 SOL" and a -100%
// gap against the wallet figure. pump.fun's /fees/creator index still filters
// to one coin with `mint=` (a mint that never paid the wallet answers an empty
// `earned`), which is the per-coin figure now.
describe('fetchCoinEarnings', () => {
	it("reads the wallet's earnings from this one coin off the creator-fee index", async () => {
		global.fetch = vi.fn(async (url) => {
			const u = new URL(String(url));
			expect(u.pathname).toBe(`/fees/creator/${WALLET}`);
			expect(u.searchParams.get('mint')).toBe(MINT);
			return reply(200, earnings({ earned: [solLeg('1500000')] }));
		});
		expect(await fetchCoinEarnings(MINT, WALLET)).toEqual({
			ok: true,
			value: { mint: MINT, lamports: 1500000n, distributions: null },
		});
	});

	it('treats an empty `earned` as a coin that has paid this wallet nothing', async () => {
		global.fetch = vi.fn(async () => reply(200, earnings({ earned: [] })));
		expect(await fetchCoinEarnings(MINT, WALLET)).toEqual({
			ok: true,
			value: { mint: MINT, lamports: 0n, distributions: null },
		});
	});

	it('fails (never a zero) on a 404 or any other upstream error', async () => {
		for (const status of [404, 503]) {
			_resetBreakers();
			global.fetch = vi.fn(async () => reply(status, { statusCode: status }));
			const r = await fetchCoinEarnings(MINT, WALLET);
			expect(r.ok).toBe(false);
		}
	});
});

describe('per-coin reconciliation', () => {
	it('is the per-coin sum minus the wallet total, only when every coin was read', async () => {
		const { reconcileCoinTotals } = await import('../api/_lib/creator-earnings-snapshot.js');
		const ok = (lamports) => ({ ok: true, value: { lamports } });
		expect(reconcileCoinTotals([ok(1500000n), ok(0n)], 1500000n)).toEqual({ delta_lamports: 0n, delta_pct: 0 });
		const gap = reconcileCoinTotals([ok(1200000n)], 1500000n);
		expect(gap.delta_lamports).toBe(-300000n);
		expect(gap.delta_pct).toBeCloseTo(-20, 5);
		// One coin unread: a sum without it would invent a gap.
		expect(reconcileCoinTotals([ok(1200000n), { ok: false, error: 'x' }], 1500000n)).toBeNull();
		expect(reconcileCoinTotals([ok(1n)], null)).toBeNull();
	});
});

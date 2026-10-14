// api/_lib/pump-creator-fees.js: the pump.fun creator-fee reads behind the
// earnings snapshot and the coin page. Payload shapes are the ones pump.fun
// returns for frontend-api-v3 /fees/creator/<wallet> and the swap-api fallback
// /v2/creators/<wallet>/fees/total, captured 2026-10-08 after pump.fun retired
// the /v1/creators routes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fetchCreatorFeeTotal, fetchCreatorFeeBuckets, fetchCoinEarnings, fetchAllShares } = await import(
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

	it('falls back to the swap-api v2 totals when /fees/creator fails', async () => {
		global.fetch = vi.fn(async (url) => {
			if (String(url).includes('/fees/creator/')) return reply(503, { degraded_lanes: ['trade_api.get_fees'] });
			expect(String(url)).toContain(`/v2/creators/${WALLET}/fees/total`);
			return reply(200, {
				totalFeesSOL: '0.004610377',
				totalFeesByQuoteMint: [
					{ quoteMintAddress: '11111111111111111111111111111111', totalFeesAtomic: '4610377', totalFeesQuote: '0.004610377' },
				],
			});
		});
		expect(await fetchCreatorFeeTotal(WALLET)).toEqual({ ok: true, value: 4610377n });
	});

	it('reports a failure on both rungs so the caller keeps its last good figure', async () => {
		global.fetch = vi.fn(async () => reply(404, { statusCode: 404 }));
		const r = await fetchCreatorFeeTotal(WALLET);
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/404.*fallback.*404/);
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

describe('fetchCoinEarnings', () => {
	it('sums distribution events addressed to the wallet across pages', async () => {
		global.fetch = vi.fn(async (url) => {
			expect(String(url)).toContain(`/v1/coins/${MINT}/timeline`);
			if (!String(url).includes('cursor=')) {
				return reply(200, {
					items: [
						{
							eventType: 'distribution',
							timestamp: '2026-10-01T00:00:00.000Z',
							recipients: [{ address: WALLET, amount: '1000000' }, { address: 'someoneElse', amount: '999' }],
						},
						{ eventType: 'trade', timestamp: '2026-10-01T00:05:00.000Z' },
					],
					pagination: { hasMore: true, nextCursor: 'page2' },
				});
			}
			return reply(200, {
				items: [
					{
						eventType: 'distribution',
						timestamp: '2026-10-02T00:00:00.000Z',
						recipients: [{ address: WALLET, amount: '500000' }],
					},
				],
				pagination: { hasMore: false, nextCursor: null },
			});
		});
		const r = await fetchCoinEarnings(MINT, WALLET);
		expect(r).toEqual({
			ok: true,
			value: {
				mint: MINT,
				lamports: 1500000n,
				distributions: 2,
				first_at: '2026-10-01T00:00:00.000Z',
				last_at: '2026-10-02T00:00:00.000Z',
			},
		});
	});

	it('resolves to zero distributions, not a failure, for a mint with no timeline', async () => {
		global.fetch = vi.fn(async () => reply(404, { statusCode: 404 }));
		const r = await fetchCoinEarnings(MINT, WALLET);
		expect(r).toEqual({
			ok: true,
			value: { mint: MINT, lamports: 0n, distributions: 0, first_at: null, last_at: null },
		});
	});

	it('fails (not zero) on a non-404 upstream error', async () => {
		global.fetch = vi.fn(async () => reply(503, { statusCode: 503 }));
		const r = await fetchCoinEarnings(MINT, WALLET);
		expect(r.ok).toBe(false);
	});
});

describe('fetchAllShares', () => {
	it('pages through every coin a wallet shares fees with', async () => {
		global.fetch = vi.fn(async (url) => {
			expect(String(url)).toContain(`/v1/fee-sharing/account/${WALLET}/shares`);
			if (!String(url).includes('cursor=')) {
				return reply(200, {
					items: [{ mint: MINT, bps: 10000, isAdmin: true }],
					pagination: { hasMore: true, nextCursor: 'page2' },
				});
			}
			return reply(200, {
				items: [{ mint: 'THREEsynthetic2222222222222222222222222222' }],
				pagination: { hasMore: false, nextCursor: null },
			});
		});
		const r = await fetchAllShares(WALLET);
		expect(r).toEqual({
			ok: true,
			value: {
				truncated: false,
				items: [
					{ mint: MINT, bps: 10000, is_admin: true },
					{ mint: 'THREEsynthetic2222222222222222222222222222', bps: null, is_admin: false },
				],
			},
		});
	});

	it('marks the result truncated when a wallet has more pages than maxPages allows', async () => {
		global.fetch = vi.fn(async () =>
			reply(200, { items: [{ mint: MINT }], pagination: { hasMore: true, nextCursor: 'next' } }),
		);
		const r = await fetchAllShares(WALLET, { maxPages: 2 });
		expect(r.ok).toBe(true);
		expect(r.value.truncated).toBe(true);
		expect(r.value.items).toHaveLength(2);
	});

	it('fails on a non-2xx response', async () => {
		global.fetch = vi.fn(async () => reply(500, {}));
		const r = await fetchAllShares(WALLET);
		expect(r.ok).toBe(false);
	});
});

describe('per-coin reconciliation', () => {
	it('a zero delta means the timeline sum and the wallet claimed figure agree', () => {
		const distributed = 1500000n;
		const claimed = 1500000n;
		const delta = distributed - claimed;
		expect(delta).toBe(0n);
	});

	it('a nonzero delta is surfaced as a percentage of the claimed figure, not hidden', () => {
		const distributed = 1800000n;
		const claimed = 1500000n;
		const delta = distributed - claimed;
		const deltaPct = (Number(delta) / Number(claimed)) * 100;
		expect(delta).toBe(300000n);
		expect(deltaPct).toBeCloseTo(20, 5);
	});
});

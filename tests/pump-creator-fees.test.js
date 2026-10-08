// api/_lib/pump-creator-fees.js: the pump.fun creator-fee reads behind the
// earnings snapshot and the coin page. Payload shapes are the ones pump.fun
// returns for frontend-api-v3 /fees/creator/<wallet> and the swap-api fallback
// /v2/creators/<wallet>/fees/total, captured 2026-10-08 after pump.fun retired
// the /v1/creators routes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fetchCreatorFeeTotal, fetchCreatorFeeBuckets } = await import('../api/_lib/pump-creator-fees.js');
const { _resetBreakers } = await import('../api/_lib/resilience.js');

const WALLET = 'THREEsynthetic11111111111111111111111111111';
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

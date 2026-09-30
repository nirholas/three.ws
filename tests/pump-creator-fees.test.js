// api/_lib/pump-creator-fees.js: the pump.fun creator-fee reads behind the
// earnings snapshot and the coin page. Payload shapes are the ones
// swap-api.pump.fun returns for /v1/creators/<wallet>/fees/total and
// /v1/creators/<wallet>/fees?interval=..., captured 2026-09-30.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fetchCreatorFeeTotal, fetchCreatorFeeBuckets } = await import('../api/_lib/pump-creator-fees.js');
const { _resetBreakers } = await import('../api/_lib/resilience.js');

const WALLET = 'THREEsynthetic11111111111111111111111111111';
const originalFetch = global.fetch;
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body });

beforeEach(() => _resetBreakers());
afterEach(() => {
	global.fetch = originalFetch;
});

describe('fetchCreatorFeeTotal', () => {
	it('reads lifetime lamports from totalFees', async () => {
		global.fetch = vi.fn(async (url) => {
			expect(String(url)).toContain(`/v1/creators/${WALLET}/fees/total`);
			return reply(200, { totalFees: '73148608', totalFeesSOL: '0.073148608' });
		});
		const r = await fetchCreatorFeeTotal(WALLET);
		expect(r).toEqual({ ok: true, value: 73148608n });
	});

	it('treats a wallet with no fees as a healthy zero, not a failure', async () => {
		global.fetch = vi.fn(async () => reply(200, { totalFees: '0', totalFeesSOL: '0' }));
		expect(await fetchCreatorFeeTotal(WALLET)).toEqual({ ok: true, value: 0n });
	});

	it('reports an upstream failure so the caller keeps its last good figure', async () => {
		global.fetch = vi.fn(async () => reply(404, { statusCode: 404 }));
		const r = await fetchCreatorFeeTotal(WALLET);
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/404/);
	});
});

describe('fetchCreatorFeeBuckets', () => {
	it('keeps only non-zero buckets, as lamports with ISO starts', async () => {
		global.fetch = vi.fn(async (url) => {
			expect(String(url)).toContain('interval=1d');
			return reply(200, [
				{ bucket: '2026-07-25T00:00:00.000Z', creatorFee: '0', creatorFeeSOL: '0', numTrades: 0 },
				{ bucket: '2026-07-26T00:00:00.000Z', creatorFee: '73094972', creatorFeeSOL: '0.073094972', numTrades: 65 },
				{ bucket: '2026-07-27T00:00:00.000Z', creatorFee: '53636', creatorFeeSOL: '0.000053636', numTrades: 1 },
			]);
		});
		const r = await fetchCreatorFeeBuckets(WALLET, '1d');
		expect(r.ok).toBe(true);
		expect(r.value).toEqual([
			{ bucket_start: '2026-07-26T00:00:00.000Z', fee_lamports: 73094972n, num_trades: 65 },
			{ bucket_start: '2026-07-27T00:00:00.000Z', fee_lamports: 53636n, num_trades: 1 },
		]);
	});

	it('fails on a body that is not a bucket list', async () => {
		global.fetch = vi.fn(async () => reply(200, { statusCode: 400, message: 'interval must be one of' }));
		const r = await fetchCreatorFeeBuckets(WALLET, '30m');
		expect(r.ok).toBe(false);
	});
});

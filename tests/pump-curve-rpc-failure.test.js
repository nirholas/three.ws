// "This coin has no bonding curve" and "we could not ask the chain" are
// different answers. getBondingCurveState used to return null for both, and
// getCurveView turns null into a 404 `no_curve`, which the coin widgets treat as
// final and stop refreshing on. With every paid Solana RPC lane rate limited
// (2026-11-25), /launches asked about 3wS... platform launches whose curve
// accounts exist on mainnet and got about 200 false 404s every twelve hours.
// Only a missing account means "no curve"; anything else must surface so the
// RPC fallback can rotate lanes and the view can serve its last good copy or an
// honest 502.

import { describe, it, expect, vi } from 'vitest';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
// A three.ws-marked address, so the shape gate lets it through to the RPC read.
const SYNTHETIC_LAUNCH = '3wshj6NCcLMhaikf3n5PhQ8bPNTQ599sKaLJBuCAb4uW'; // synthetic: 0x11 bytes behind a ground prefix

const { getBondingCurveState } = await import('../api/_lib/solana/sdk-bridge.js');

describe('getBondingCurveState when the RPC cannot answer', () => {
	it('throws a rate limit instead of reporting the curve missing', async () => {
		const connection = {
			getAccountInfo: vi.fn(async () => {
				throw new Error('429 Too Many Requests: max usage reached');
			}),
		};
		await expect(getBondingCurveState(connection, MINT)).rejects.toThrow(/429/);
	});

	it('still answers null for a curve account that does not exist', async () => {
		const connection = { getAccountInfo: vi.fn(async () => null) };
		await expect(getBondingCurveState(connection, MINT)).resolves.toBeNull();
	});
});

describe('getCurveView when every RPC lane fails', () => {
	it('answers 502, not a final no_curve 404', async () => {
		vi.resetModules();
		vi.doMock('../api/_lib/cache.js', () => ({ cacheGet: async () => null, cacheSet: async () => {} }));
		// No price source answers either, so nothing can stand in for the curve.
		vi.doMock('../api/_lib/upstream-fetch.js', () => ({ fetchUpstreamJson: async () => ({}) }));
		vi.doMock('../api/_lib/market/token-market.js', () => ({ fetchTokenPriceUsd: async () => null }));
		vi.doMock('../api/_lib/solana/index.js', async (orig) => {
			const real = await orig();
			return {
				...real,
				rpcFallbackFromEnv: () => ({
					withFallback: async (fn) =>
						fn({
							getAccountInfo: async () => {
								throw new Error('429 Too Many Requests');
							},
							getMultipleAccountsInfo: async () => {
								throw new Error('429 Too Many Requests');
							},
						}),
				}),
			};
		});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { getCurveView } = await import('../api/_lib/pump-curve-view.js');
		const view = await getCurveView({ mint: SYNTHETIC_LAUNCH, network: 'mainnet' });
		err.mockRestore();
		expect(view.httpStatus).toBe(502);
		expect(view.body.error).toBe('upstream_error');
	});
});

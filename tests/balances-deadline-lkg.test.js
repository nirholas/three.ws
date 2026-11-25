// /api/agents/:id/solana/networth answered 503 rpc_unavailable 28 times in
// eleven hours on 2026-11-25, most of them "networth balances exceeded 6000ms
// deadline". getBalances keeps a 24h last-known-good snapshot for exactly this
// case, but it only reached for it after every RPC lane had failed, and a lane
// that stalls instead of failing kept the walk going past the caller's
// deadline. The caller's timer won the race, so a wallet with a perfectly good
// prior balance still got the 503 meant for a wallet that was never read.
//
// getBalances now takes the caller's deadline itself: when the live read is
// still running at that point it serves the last-known-good snapshot (flagged
// stale) and lets the live read finish in the background to refresh the cache.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = new Map();
vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: vi.fn(async (k) => (store.has(k) ? store.get(k) : null)),
	cacheSet: vi.fn(async (k, v) => {
		store.set(k, v);
	}),
	cacheDel: vi.fn(async (k) => {
		store.delete(k);
	}),
}));
vi.mock('../api/_lib/token-metadata.js', () => ({ getMetadataForMints: vi.fn(async () => ({})) }));
vi.mock('../api/_lib/sol-price.js', () => ({ solPriceUsd: vi.fn(async () => 150) }));
vi.mock('../api/_lib/market/token-market.js', () => ({ fetchTokenPriceUsd: vi.fn(async () => null) }));
vi.mock('../api/_lib/market-fallbacks.js', () => ({ fetchCoinPriceUsdOrNull: vi.fn(async () => null) }));

const ADDRESS = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const LKG = {
	chain: 'solana',
	address: ADDRESS,
	native: { symbol: 'SOL', name: 'Solana', amount: 2, price: 150, usd: 300 },
	tokens: [],
};

let getBalances;
let withDeadline;
beforeEach(async () => {
	vi.resetModules();
	store.clear();
	// Every RPC lane stalls: the request is accepted and never answered.
	vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
	({ getBalances } = await import('../api/_lib/balances.js'));
	({ withDeadline } = await import('../api/_lib/rpc-degrade.js'));
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getBalances under a caller deadline', () => {
	it('serves the last-known-good snapshot when the live read stalls past the deadline', async () => {
		store.set(`bal:lkg:solana:${ADDRESS}`, LKG);
		// The networth handler's own guard, kept well above the deadline it passes.
		const out = await withDeadline(getBalances({ chain: 'solana', address: ADDRESS, deadlineMs: 300 }), 2_000, 'networth balances');
		expect(out.stale).toBe(true);
		expect(out.native.usd).toBe(300);
	});

	it('still fails fast for a wallet that has never been read', async () => {
		const started = Date.now();
		const err = await getBalances({ chain: 'solana', address: ADDRESS, deadlineMs: 300 }).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(Date.now() - started).toBeLessThan(2_000);
	});
});

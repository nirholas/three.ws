// pump.fun retired its HTTP trade feeds on 2026-11-25 (swap-api /v2 trades
// answers 410, frontend /trades/all rejects every chainId), so the trending
// board, whale scan and anomaly detector read trades decoded from Solana
// instead. These pin the row shape those consumers already parse: a field
// renamed here would silently zero every volume and buy-pressure score.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/pump.js', () => ({
	getConnection: vi.fn(),
	solanaPubkey: vi.fn(),
	getAmmPoolState: vi.fn(),
	getPumpSdkV2: vi.fn(),
}));
vi.mock('../api/_lib/cache.js', () => ({ cacheGet: async () => null, cacheSet: async () => {} }));

const mod = await import('../api/_lib/pump-chain-trades.js');
const { chainTradeRow } = mod;
const { scorePressure } = await import('../api/_lib/x402/pump-trending-score.js');
const { summarizeWindowUsd } = await import('../api/_lib/x402/pump-volume-anomaly.js');

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const WALLET = 'THREEsyntheticCreator111111111111111111111';
const nowS = 1_780_000_000;

const buy = { signature: 'sigBuy', isBuy: true, solAmount: 12, tokenAmount: 1e6, wallet: WALLET, timestamp: nowS - 30, usdValue: 1800 };
const sell = { signature: 'sigSell', isBuy: false, solAmount: 2, tokenAmount: 2e5, wallet: WALLET, timestamp: nowS - 60, usdValue: 300 };

describe('chainTradeRow', () => {
	it('maps a decoded trade to the swap-api row shape', () => {
		expect(chainTradeRow(buy)).toEqual({
			signature: 'sigBuy', tx: 'sigBuy', type: 'buy', txType: 'buy', is_buy: true,
			amountSol: 12, amountUsd: 1800, priceUsd: 1800, tokenAmount: 1e6,
			userAddress: WALLET, user: WALLET, timestamp: nowS - 30,
		});
	});

	it('reports an unknown USD value as null, never a guessed price', () => {
		expect(chainTradeRow({ ...buy, usdValue: null }).amountUsd).toBeNull();
	});

	it('feeds the buy-pressure and windowed-volume scorers', () => {
		const rows = [buy, sell].map(chainTradeRow);
		const p = scorePressure([{ mint: THREE, trades: rows }]);
		expect(p).toMatchObject({ totalBuys: 1, totalSells: 1, totalVolumeSol: 12, buyPressure: 0.5 });
		expect(p.whaleBuys).toEqual([{ mint: THREE, sol_amount: 12, usd_amount: 1800, trader: WALLET }]);
		expect(summarizeWindowUsd(rows, nowS * 1000, 300)).toEqual({ usd: 2100, count: 2 });
		expect(summarizeWindowUsd(rows, nowS * 1000, 45)).toEqual({ usd: 1800, count: 1 });
	});
});

describe('fetchChainTradeRows', () => {
	it('returns null for an unreadable mint so callers can tell an outage from no trades', async () => {
		expect(await mod.fetchChainTradeRows('not-a-mint')).toBeNull();
	});
});

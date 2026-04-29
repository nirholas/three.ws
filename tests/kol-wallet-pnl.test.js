import { describe, it, expect } from 'vitest';
import { computeWalletPnl, getWalletPnl, WINDOW_SECONDS } from '../src/kol/wallet-pnl.js';

// ── FIFO P&L fixture ──────────────────────────────────────────────────────────
//
// Timeline (all within a 7d window):
//   t=1000: Buy 1000 TOKENA for 1 SOL @ $100/SOL → costBasis $100
//   t=2000: Sell 600 TOKENA for 0.9 SOL @ $110/SOL → proceeds $99
//             Consume lot: 600/1000 * $100 = $60 cost
//             Realized P&L = $99 - $60 = +$39
//             Remaining: 400 tokens, $40 costBasis
//   t=3000: Buy 200 TOKENB for 0.2 SOL @ $120/SOL → costBasis $24
//
// currentPrices: TOKENA=$0.05/token, TOKENB=$0.05/token
//   TOKENA unrealized = 400 * $0.05 - $40 = $20 - $40 = -$20
//   TOKENB unrealized = 200 * $0.05 - $24 = $10 - $24 = -$14
//
// totals:
//   realizedUsd   = $39
//   unrealizedUsd = -$34
//   totalUsd      = $5
//   winRate       = 1/1 = 1.0  (one closed trade, winner)
//   trades        = 3

const NOW = Math.floor(Date.now() / 1000);
const FIXTURE_TRADES = [
	{ type: 'buy',  mint: 'TOKENA', tokenAmount: 1000, solAmount: 1.0, usdPrice: 100, timestamp: NOW - 5000 },
	{ type: 'sell', mint: 'TOKENA', tokenAmount: 600,  solAmount: 0.9, usdPrice: 110, timestamp: NOW - 4000 },
	{ type: 'buy',  mint: 'TOKENB', tokenAmount: 200,  solAmount: 0.2, usdPrice: 120, timestamp: NOW - 3000 },
];

const CURRENT_PRICES = { TOKENA: 0.05, TOKENB: 0.05 };

describe('computeWalletPnl — FIFO math', () => {
	it('computes correct realized P&L', () => {
		const r = computeWalletPnl({ trades: FIXTURE_TRADES, currentPrices: CURRENT_PRICES });
		expect(r.realizedUsd).toBeCloseTo(39, 6);
	});

	it('computes correct unrealized P&L', () => {
		const r = computeWalletPnl({ trades: FIXTURE_TRADES, currentPrices: CURRENT_PRICES });
		expect(r.unrealizedUsd).toBeCloseTo(-34, 6);
	});

	it('computes correct total P&L', () => {
		const r = computeWalletPnl({ trades: FIXTURE_TRADES, currentPrices: CURRENT_PRICES });
		expect(r.totalUsd).toBeCloseTo(5, 6);
	});

	it('reports correct win rate', () => {
		const r = computeWalletPnl({ trades: FIXTURE_TRADES, currentPrices: CURRENT_PRICES });
		expect(r.winRate).toBeCloseTo(1.0);
	});

	it('counts all trades in window', () => {
		const r = computeWalletPnl({ trades: FIXTURE_TRADES, currentPrices: CURRENT_PRICES });
		expect(r.trades).toBe(3);
	});

	it('lists open positions with correct cost basis', () => {
		const r = computeWalletPnl({ trades: FIXTURE_TRADES, currentPrices: CURRENT_PRICES });
		expect(r.openPositions).toHaveLength(2);

		const tokena = r.openPositions.find((p) => p.mint === 'TOKENA');
		expect(tokena).toBeDefined();
		expect(tokena.tokens).toBe(400);
		expect(tokena.costUsd).toBeCloseTo(40, 6);

		const tokenb = r.openPositions.find((p) => p.mint === 'TOKENB');
		expect(tokenb).toBeDefined();
		expect(tokenb.tokens).toBe(200);
		expect(tokenb.costUsd).toBeCloseTo(24, 6);
	});
});

describe('computeWalletPnl — edge cases', () => {
	it('returns zeros for an empty trade list', () => {
		const r = computeWalletPnl({ trades: [] });
		expect(r.realizedUsd).toBe(0);
		expect(r.unrealizedUsd).toBe(0);
		expect(r.totalUsd).toBe(0);
		expect(r.winRate).toBe(0);
		expect(r.trades).toBe(0);
		expect(r.openPositions).toHaveLength(0);
	});

	it('excludes trades outside the time window', () => {
		const stale = [
			{ type: 'buy', mint: 'TOKENA', tokenAmount: 1000, solAmount: 1, usdPrice: 100, timestamp: 1 },
			{ type: 'sell', mint: 'TOKENA', tokenAmount: 500, solAmount: 0.8, usdPrice: 110, timestamp: 2 },
		];
		const r = computeWalletPnl({ trades: stale, windowSecs: WINDOW_SECONDS['24h'] });
		// Both trades are far outside 24h — should be excluded.
		expect(r.trades).toBe(0);
		expect(r.realizedUsd).toBe(0);
	});

	it('handles a losing trade (negative realized P&L)', () => {
		const losing = [
			{ type: 'buy',  mint: 'TOKENX', tokenAmount: 1000, solAmount: 1.0, usdPrice: 100, timestamp: NOW - 100 },
			{ type: 'sell', mint: 'TOKENX', tokenAmount: 1000, solAmount: 0.5, usdPrice: 90,  timestamp: NOW - 50 },
		];
		const r = computeWalletPnl({ trades: losing });
		// proceeds = 0.5 * 90 = $45; cost = $100; realized = -$55
		expect(r.realizedUsd).toBeCloseTo(-55, 6);
		expect(r.winRate).toBe(0);
	});

	it('ignores a sell with no preceding buy', () => {
		const orphanSell = [
			{ type: 'sell', mint: 'UNKNOWN', tokenAmount: 500, solAmount: 1, usdPrice: 100, timestamp: NOW - 100 },
		];
		const r = computeWalletPnl({ trades: orphanSell });
		expect(r.realizedUsd).toBe(0);
		expect(r.openPositions).toHaveLength(0);
	});
});

describe('getWalletPnl — integration with injected fetch', () => {
	it('uses injected _fetchTrades and returns wallet + window in result', async () => {
		const mockFetch = async () => FIXTURE_TRADES;
		const r = await getWalletPnl({ wallet: 'WALLET123', window: '7d', _fetchTrades: mockFetch });
		expect(r.wallet).toBe('WALLET123');
		expect(r.window).toBe('7d');
		expect(r.realizedUsd).toBeCloseTo(39, 6);
	});

	it('returns zero P&L for an empty wallet (no trades)', async () => {
		const mockFetch = async () => [];
		const r = await getWalletPnl({ wallet: 'EMPTY_WALLET', _fetchTrades: mockFetch });
		expect(r.realizedUsd).toBe(0);
		expect(r.unrealizedUsd).toBe(0);
		expect(r.openPositions).toHaveLength(0);
	});

	it('defaults window to 7d', async () => {
		const mockFetch = async () => [];
		const r = await getWalletPnl({ wallet: 'W', _fetchTrades: mockFetch });
		expect(r.window).toBe('7d');
	});

	it('throws when wallet is missing', async () => {
		await expect(getWalletPnl({ _fetchTrades: async () => [] })).rejects.toThrow();
	});
});

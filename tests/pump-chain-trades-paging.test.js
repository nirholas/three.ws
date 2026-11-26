// The token-stats panel on /launches/<mint> rolls a day of trades into 5m, 1h,
// 6h and 24h windows. pump.fun's paged trade route (swap-api /v2/coins/<mint>/
// trades with a cursor) answers 410 since 2026-11-25, so the history is paged
// from the coin's Solana signatures instead: each page continues from the last
// signature the previous page examined.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

const state = vi.hoisted(() => ({ conn: null, solPrice: 100 }));

vi.mock('../api/_lib/pump.js', async (orig) => ({
	...(await orig()),
	getConnection: () => state.conn,
	getAmmPoolState: async () => null,
	getPumpSdkV2: async () => ({ bondingCurvePda: (pk) => pk }),
}));
vi.mock('../src/shared/usd-price.js', async (orig) => ({
	...(await orig()),
	getSolPriceUsd: async () => state.solPrice,
}));
vi.mock('@coral-xyz/anchor', async (orig) => ({
	...(await orig()),
	BorshCoder: class {},
	EventParser: class {
		parseLogs(logs) {
			return logs.map((l) => JSON.parse(l));
		}
	},
}));

const { fetchChainTradePage, chainTradeRow } = await import('../api/_lib/pump-chain-trades.js');
const { normalizeTrade } = await import('../api/pump/token-stats.js');

const tradeTx = (mint, ts, isBuy = true) => ({
	blockTime: ts,
	meta: {
		err: null,
		logMessages: [JSON.stringify({
			name: 'TradeEvent',
			data: { mint, user: 'THREEsynthetic1111', is_buy: isBuy, sol_amount: '1000000000', token_amount: '2000000000', timestamp: String(ts) },
		})],
	},
});

describe('fetchChainTradePage', () => {
	let mint;
	beforeEach(() => {
		mint = Keypair.generate().publicKey.toBase58();
	});

	it('continues from the cursor and reports whether older history remains', async () => {
		const sigs = Array.from({ length: 6 }, (_, i) => `pg${i}${mint.slice(0, 6)}`);
		const txs = Object.fromEntries(sigs.map((s, i) => [s, tradeTx(mint, 1_790_000_000 - i * 60)]));
		state.conn = {
			getSignaturesForAddress: vi.fn(async (_addr, { limit, before }) => {
				const from = before ? sigs.indexOf(before) + 1 : 0;
				return sigs.slice(from, from + limit).map((signature) => ({ signature }));
			}),
			getTransactions: vi.fn(async (list) => list.map((s) => txs[s])),
		};

		const first = await fetchChainTradePage(mint, { limit: 2 });
		expect(first.rows.map((r) => r.signature)).toEqual([sigs[0], sigs[1]]);
		expect(first.hasMore).toBe(true);

		const second = await fetchChainTradePage(mint, { limit: 2, before: first.cursor });
		expect(state.conn.getSignaturesForAddress.mock.calls[1][1].before).toBe(first.cursor);
		expect(second.rows.map((r) => r.signature)[0]).not.toBe(sigs[0]);
		expect(second.rows.every((r) => !first.rows.some((f) => f.signature === r.signature))).toBe(true);

		const last = await fetchChainTradePage(mint, { limit: 50, before: sigs[3] });
		expect(last.rows.map((r) => r.signature)).toEqual([sigs[4], sigs[5]]);
		expect(last.hasMore).toBe(false);
	});

	it('returns null when the RPC fails so a page error is never read as the end of history', async () => {
		state.conn = { getSignaturesForAddress: vi.fn(async () => { throw new Error('429'); }), getTransactions: vi.fn() };
		expect(await fetchChainTradePage(mint, { limit: 10 })).toBeNull();
	});
});

describe('token-stats reads chain trade rows', () => {
	it('accepts a unix-second timestamp and the per-token USD price', () => {
		// 1 SOL at $100 for 2,000 tokens (6 decimals) is $0.05 per token.
		const row = chainTradeRow({ signature: 's', isBuy: true, solAmount: 1, tokenAmount: '2000000000', wallet: 'W', timestamp: 1_790_000_000, usdValue: 100 });
		expect(row.priceUsd).toBeCloseTo(0.05, 10);
		expect(normalizeTrade(row)).toEqual({ t: 1_790_000_000, buy: true, user: 'W', usd: 100, sol: 1, price: row.priceUsd });
	});
});

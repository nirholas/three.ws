// get_token_trades (api/pump-fun-mcp.js) walks a coin's recent signatures and
// reads each transaction to decode its trades. Measured 2026-11-06, with the
// claims scan already cached: /api/pump-fun-mcp still made 12,600 getTransaction
// calls an hour, because repeat polls of the same coin re-read the same
// confirmed transactions with both paid lanes exhausted.
//
// What must hold: a repeat poll reads no transaction twice, usdValue follows the
// current SOL price rather than the remembered one, a transaction the RPC did
// not return yet is never remembered as "not a trade", and a verdict for one
// coin is never reused for another.
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
// Decoding is pinned by the trade-events tests; the fixture logs carry the event
// directly so this file can focus on what is read and what is remembered.
vi.mock('@coral-xyz/anchor', async (orig) => ({
	...(await orig()),
	BorshCoder: class {},
	EventParser: class {
		parseLogs(logs) {
			return logs.map((l) => JSON.parse(l));
		}
	},
}));

const { callPumpFunTool } = await import('../api/pump-fun-mcp.js');

const tradeTx = (mint, lamports) => ({
	blockTime: 1_790_000_000,
	meta: {
		err: null,
		logMessages: [JSON.stringify({
			name: 'TradeEvent',
			data: { mint, user: 'THREEsynthetic1111', is_buy: true, sol_amount: String(lamports), token_amount: '5000', timestamp: '1790000000' },
		})],
	},
});
const otherTx = () => ({ blockTime: 1_790_000_000, meta: { err: null, logMessages: [] } });

function connectionFor(sigs, txs) {
	return {
		getSignaturesForAddress: vi.fn(async () => sigs.map((signature) => ({ signature }))),
		getTransactions: vi.fn(async (list) => list.map((s) => (typeof txs[s] === 'function' ? txs[s]() : txs[s]))),
	};
}
const reads = () => state.conn.getTransactions.mock.calls.flatMap(([list]) => list);

let n = 0;
const uniq = (p) => `${p}${++n}${Date.now()}`;

describe('get_token_trades remembers what each confirmed transaction was', () => {
	let mint;
	beforeEach(() => {
		mint = Keypair.generate().publicKey.toBase58();
		state.solPrice = 100;
	});

	it('a repeat poll reads no transaction a second time and returns the same trades', async () => {
		const [a, b] = [uniq('sigA'), uniq('sigB')];
		state.conn = connectionFor([a, b], { [a]: tradeTx(mint, 2_000_000_000), [b]: otherTx() });

		const first = await callPumpFunTool('get_token_trades', { mint, limit: 20 });
		expect(reads()).toEqual([a, b]);
		expect(first.trades.map((t) => t.signature)).toEqual([a]);

		const second = await callPumpFunTool('get_token_trades', { mint, limit: 20 });
		expect(reads()).toEqual([a, b]);
		expect(second).toEqual(first);
	});

	it('prices a remembered trade at the current SOL price', async () => {
		const a = uniq('sigPrice');
		state.conn = connectionFor([a], { [a]: tradeTx(mint, 2_000_000_000) });
		const first = await callPumpFunTool('get_token_trades', { mint, limit: 20 });
		expect(first.trades[0].usdValue).toBe(200);

		state.solPrice = 150;
		const second = await callPumpFunTool('get_token_trades', { mint, limit: 20 });
		expect(second.trades[0].usdValue).toBe(300);
	});

	it('reads only the new transactions when a coin trades between polls', async () => {
		const [a, b] = [uniq('sigOld'), uniq('sigNew')];
		const txs = { [a]: tradeTx(mint, 1_000_000_000), [b]: tradeTx(mint, 3_000_000_000) };
		state.conn = connectionFor([a], txs);
		await callPumpFunTool('get_token_trades', { mint, limit: 20 });

		state.conn = connectionFor([b, a], txs);
		const next = await callPumpFunTool('get_token_trades', { mint, limit: 20 });
		expect(reads()).toEqual([b]);
		expect(next.trades.map((t) => t.signature)).toEqual([b, a]);
	});

	it('a transaction the RPC has not returned yet is read again next poll', async () => {
		const s = uniq('sigLate');
		let landed = false;
		state.conn = connectionFor([s], { [s]: () => (landed ? tradeTx(mint, 1_000_000_000) : null) });

		expect((await callPumpFunTool('get_token_trades', { mint, limit: 20 })).trades).toEqual([]);
		landed = true;
		const second = await callPumpFunTool('get_token_trades', { mint, limit: 20 });
		expect(reads()).toEqual([s, s]);
		expect(second.trades.map((t) => t.signature)).toEqual([s]);
	});

	it('a verdict for one coin is never reused for another', async () => {
		const s = uniq('sigShared');
		const other = Keypair.generate().publicKey.toBase58();
		state.conn = connectionFor([s], { [s]: tradeTx(mint, 1_000_000_000) });
		await callPumpFunTool('get_token_trades', { mint, limit: 20 });

		const result = await callPumpFunTool('get_token_trades', { mint: other, limit: 20 });
		expect(reads()).toEqual([s, s]);
		expect(result.trades).toEqual([]);
	});
});

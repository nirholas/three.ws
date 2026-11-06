// pumpfun_list_claims / pumpfun_watch_claims (api/pump-fun-mcp.js) walk a
// creator's recent signatures and read each transaction to find pump.fun fee
// claims. Measured 2026-11-06: one MCP client polling claims made
// /api/pump-fun-mcp the second largest Solana RPC caller, 21,286 getTransaction
// calls an hour with zero cache hits, re-reading the same confirmed
// transactions on every poll while both paid lanes were exhausted.
//
// A confirmed transaction never changes, so what the scan derives from one
// (a claim, or not a claim, for this creator) is kept in the shared cache. What
// must hold: a repeat poll reads no transaction twice, a transaction the RPC
// did not return yet is never remembered as "not a claim", and the result for
// one creator is never reused for another.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

const conn = vi.hoisted(() => ({ current: null }));

vi.mock('../api/_lib/pump.js', async (orig) => {
	const real = await orig();
	return { ...real, getConnection: () => conn.current };
});

const { callPumpFunTool } = await import('../api/pump-fun-mcp.js');

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function claimTx(creator, lamports) {
	return {
		transaction: {
			message: {
				instructions: [{ programId: new PublicKey(PUMP_PROGRAM) }],
				accountKeys: [{ pubkey: new PublicKey(creator) }],
			},
		},
		meta: { preBalances: [1_000_000], postBalances: [1_000_000 + lamports], innerInstructions: [], postTokenBalances: [] },
	};
}

function otherTx(creator) {
	return {
		transaction: {
			message: {
				instructions: [{ programId: new PublicKey('11111111111111111111111111111111') }],
				accountKeys: [{ pubkey: new PublicKey(creator) }],
			},
		},
		meta: { preBalances: [5], postBalances: [4], innerInstructions: [], postTokenBalances: [] },
	};
}

function connectionFor(creator, sigs, txs) {
	return {
		getSignaturesForAddress: vi.fn(async () => sigs.map((signature, i) => ({ signature, blockTime: 1_790_000_000 - i }))),
		getParsedTransaction: vi.fn(async (sig) => (typeof txs[sig] === 'function' ? txs[sig]() : txs[sig])),
	};
}

let n = 0;
const uniq = (p) => `${p}${++n}${Date.now()}`;

describe('pump.fun claims scan remembers what each confirmed transaction was', () => {
	let creator;
	beforeEach(() => {
		creator = Keypair.generate().publicKey.toBase58();
	});

	it('a repeat poll reads no transaction a second time and returns the same claims', async () => {
		const [a, b, c] = [uniq('sigA'), uniq('sigB'), uniq('sigC')];
		conn.current = connectionFor(creator, [a, b, c], { [a]: claimTx(creator, 5000), [b]: otherTx(creator), [c]: claimTx(creator, 7000) });

		const first = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(3);

		const second = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(3);
		expect(second).toEqual(first);
		const claims = (first.claims ?? first.result?.claims ?? first);
		expect(JSON.stringify(claims)).toContain(a);
		expect(JSON.stringify(claims)).toContain(c);
		expect(JSON.stringify(claims)).not.toContain(b);
	});

	it('a transaction the RPC has not returned yet is read again next poll', async () => {
		const s = uniq('sigLate');
		let landed = false;
		conn.current = connectionFor(creator, [s], { [s]: () => (landed ? claimTx(creator, 9000) : null) });

		const first = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(JSON.stringify(first)).not.toContain(s);
		landed = true;
		const second = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(second)).toContain(s);
	});

	it('a failed read is not remembered either', async () => {
		const s = uniq('sigErr');
		let fail = true;
		conn.current = connectionFor(creator, [s], {
			[s]: () => {
				if (fail) throw new Error('429 Too Many Requests');
				return claimTx(creator, 1234);
			},
		});
		await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		fail = false;
		const second = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(second)).toContain(s);
	});

	it('never reuses one creator\'s verdict for another creator', async () => {
		const s = uniq('sigShared');
		const other = Keypair.generate().publicKey.toBase58();
		conn.current = connectionFor(creator, [s], { [s]: claimTx(creator, 5000) });
		await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });

		conn.current = connectionFor(other, [s], { [s]: claimTx(creator, 5000) });
		const forOther = await callPumpFunTool('pumpfun_list_claims', { creator: other, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(forOther)).not.toContain(s);
	});
});

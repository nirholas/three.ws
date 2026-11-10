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

const { callPumpFunTool, CLAIM_TX_FETCH_BUDGET } = await import('../api/pump-fun-mcp.js');

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

function connectionFor(creator, sigs, txs, failedOnChain = new Set()) {
	return {
		getSignaturesForAddress: vi.fn(async () =>
			sigs.map((signature, i) => ({
				signature,
				blockTime: 1_790_000_000 - i,
				err: failedOnChain.has(signature) ? { InstructionError: [0, 'Custom'] } : null,
			})),
		),
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

// Measured 2026-11-10, with the verdict cache above already live: /api/pump-fun-mcp
// still made 425,579 getTransaction calls in 24h against 23,129
// getSignaturesForAddress calls (26% of all Solana RPC spend, about 18 reads per
// poll), with both paid lanes exhausted for six hours. A failed read is not
// remembered (correctly), so each poll walked every remaining signature and
// failed on each one, and a client polling twice a second rescanned every time.
describe('pump.fun claims scan stays bounded when the RPC is struggling', () => {
	let creator;
	beforeEach(() => {
		creator = Keypair.generate().publicKey.toBase58();
	});

	const sigList = (prefix, count) => Array.from({ length: count }, () => uniq(prefix));

	it('stops reading transactions after the first failed read and says the answer is incomplete', async () => {
		const sigs = sigList('sigDown', 10);
		const txs = Object.fromEntries(sigs.map((s) => [s, () => { throw new Error('429 Too Many Requests'); }]));
		conn.current = connectionFor(creator, sigs, txs);
		const out = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(1);
		expect(out.incomplete).toBe(true);
		expect(out.claims).toEqual([]);
	});

	it('never reads a transaction that already failed on-chain, since it cannot be a claim', async () => {
		const [ok, failed] = [uniq('sigOk'), uniq('sigFailed')];
		conn.current = connectionFor(creator, [ok, failed], { [ok]: claimTx(creator, 5000), [failed]: claimTx(creator, 5000) }, new Set([failed]));
		const out = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(1);
		expect(conn.current.getParsedTransaction.mock.calls[0][0]).toBe(ok);
		expect(out.claims.map((c) => c.signature)).toEqual([ok]);
		expect(out.incomplete).toBeUndefined();
	});

	it('reads at most a fixed number of new transactions per poll and finishes the scan over later polls', async () => {
		const sigs = sigList('sigMany', 60);
		conn.current = connectionFor(creator, sigs, Object.fromEntries(sigs.map((s) => [s, otherTx(creator)])));
		const first = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(CLAIM_TX_FETCH_BUDGET);
		expect(first.incomplete).toBe(true);
		const second = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(60);
		expect(second.incomplete).toBeUndefined();
	});

	it('serves a complete answer to a rapid repeat poll without asking the RPC again', async () => {
		const s = uniq('sigMemo');
		conn.current = connectionFor(creator, [s], { [s]: claimTx(creator, 4000) });
		const first = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		const second = await callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 });
		expect(conn.current.getSignaturesForAddress).toHaveBeenCalledTimes(1);
		expect(second).toEqual(first);
	});

	it('concurrent identical polls share one scan', async () => {
		const s = uniq('sigConcurrent');
		conn.current = connectionFor(creator, [s], { [s]: claimTx(creator, 4000) });
		const [a, b, c] = await Promise.all([
			callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 }),
			callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 }),
			callPumpFunTool('pumpfun_list_claims', { creator, limit: 20 }),
		]);
		expect(conn.current.getSignaturesForAddress).toHaveBeenCalledTimes(1);
		expect(conn.current.getParsedTransaction).toHaveBeenCalledTimes(1);
		expect(b).toEqual(a);
		expect(c).toEqual(a);
	});
});

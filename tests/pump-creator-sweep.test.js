// src/solana/pump-creator-sweep.js and src/pump/trade-events.js: the pump-sdk
// 4.0 changes. v3 curve and v2 PumpSwap trades leave the creator fee on the
// curve (`creator_fee`) or pool (`creator_fees`) until a sweep moves it into the
// creator vault, and the buy that completes a curve reports its
// synthetic-migration pool part in a separate PostCompleteBuyEvent.
//
// Accounts are encoded with the published pump / pump-amm IDLs, so the SDK
// decoders read them exactly as they read the cluster.

import { describe, it, expect } from 'vitest';
import anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { bondingCurvePda, canonicalPumpPoolPdaWithQuote, pumpIdl, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { pumpAmmJson, PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';

const {
	readCreatorFeeBuckets,
	unsweptCreatorFees,
	sumByQuote,
	creatorExtraQuoteMints,
	creatorFeeSweepInstructions,
} = await import('../src/solana/pump-creator-sweep.js');
const { pumpTradesFromEvents } = await import('../src/pump/trade-events.js');
const { countPrefixThatFits } = await import('../api/_lib/pump-launch-tx.js');

const { BN, BorshAccountsCoder } = anchor;
const WSOL = 'So11111111111111111111111111111111111111112';
const key = (n) => new PublicKey(Buffer.alloc(32, n));
const CREATOR = key(7);
const OTHER = key(8);
const QUOTE_COIN = key(9); // a pump coin used as another coin's quote
const MINT_LIVE = key(11);
const MINT_DONE = key(12);
const MINT_COIN_QUOTED = key(13);

const pumpCoder = new BorshAccountsCoder(pumpIdl);
const ammCoder = new BorshAccountsCoder(pumpAmmJson);

// Zero value for every field of an IDL struct, so a fixture names only what it tests.
function zeroed(idl, typeName) {
	const def = idl.types.find((t) => t.name === typeName);
	const out = {};
	for (const f of def.type.fields) {
		if (f.type === 'pubkey') out[f.name] = PublicKey.default;
		else if (f.type === 'bool') out[f.name] = false;
		else out[f.name] = new BN(0);
	}
	return out;
}

async function curveAccount({ creator = CREATOR, quoteMint = PublicKey.default, complete = false, creatorFee = 0 }) {
	const data = await pumpCoder.encode('BondingCurve', {
		...zeroed(pumpIdl, 'BondingCurve'),
		creator,
		quote_mint: quoteMint,
		complete,
		creator_fee: new BN(creatorFee),
		depth: 0,
	});
	return { data, owner: PUMP_PROGRAM_ID, lamports: 1, executable: false };
}

async function poolAccount({ mint, coinCreator = CREATOR, quoteMint = new PublicKey(WSOL), creatorFees = 0 }) {
	const data = await ammCoder.encode('Pool', {
		...zeroed(pumpAmmJson, 'Pool'),
		pool_bump: 255,
		index: 0,
		base_mint: mint,
		quote_mint: quoteMint,
		coin_creator: coinCreator,
		creator_fees: new BN(creatorFees),
	});
	return { data, owner: PUMP_AMM_PROGRAM_ID, lamports: 1, executable: false };
}

// A connection that answers getMultipleAccountsInfo from a fixed account map.
function fakeConnection(accounts) {
	const calls = [];
	return {
		calls,
		async getMultipleAccountsInfo(keys) {
			calls.push(keys.length);
			return keys.map((k) => accounts.get(k.toBase58()) ?? null);
		},
	};
}

describe('readCreatorFeeBuckets', () => {
	it('reads curve fees, and pool fees at the quote-aware pool of a complete curve', async () => {
		const accounts = new Map([
			[bondingCurvePda(MINT_LIVE).toBase58(), await curveAccount({ creatorFee: 1500 })],
			[bondingCurvePda(MINT_DONE).toBase58(), await curveAccount({ complete: true, creatorFee: 20 })],
			[
				canonicalPumpPoolPdaWithQuote(MINT_DONE, new PublicKey(WSOL)).toBase58(),
				await poolAccount({ mint: MINT_DONE, creatorFees: 391886 }),
			],
			[bondingCurvePda(MINT_COIN_QUOTED).toBase58(), await curveAccount({ quoteMint: QUOTE_COIN, complete: true })],
			[
				canonicalPumpPoolPdaWithQuote(MINT_COIN_QUOTED, QUOTE_COIN).toBase58(),
				await poolAccount({ mint: MINT_COIN_QUOTED, quoteMint: QUOTE_COIN, creatorFees: 5 }),
			],
		]);
		const missing = key(99).toBase58();
		const buckets = await readCreatorFeeBuckets(fakeConnection(accounts), [
			MINT_LIVE.toBase58(),
			MINT_DONE.toBase58(),
			MINT_COIN_QUOTED.toBase58(),
			missing,
		]);

		expect(buckets.get(missing)).toBeNull();
		const live = buckets.get(MINT_LIVE.toBase58());
		// A legacy curve stores the zero key as its quote; it normalizes to wrapped SOL.
		expect(live).toMatchObject({ creator: CREATOR.toBase58(), quoteMint: WSOL, complete: false, curveFee: 1500n, pool: null });
		expect(buckets.get(MINT_DONE.toBase58())).toMatchObject({
			complete: true,
			curveFee: 20n,
			pool: { coinCreator: CREATOR.toBase58(), quoteMint: WSOL, fee: 391886n },
		});
		expect(buckets.get(MINT_COIN_QUOTED.toBase58())?.pool).toMatchObject({ quoteMint: QUOTE_COIN.toBase58(), fee: 5n });
	});

	it('batches curve reads 100 at a time and skips the pool read while curves are live', async () => {
		const mints = Array.from({ length: 150 }, (_, i) => Keypair.generate().publicKey.toBase58());
		const conn = fakeConnection(new Map());
		await readCreatorFeeBuckets(conn, [...mints, mints[0]]);
		expect(conn.calls).toEqual([100, 50]);
	});
});

const bucket = (over) => ({
	mint: MINT_LIVE.toBase58(),
	creator: CREATOR.toBase58(),
	quoteMint: WSOL,
	complete: false,
	curveFee: 0n,
	pool: null,
	...over,
});

describe('unsweptCreatorFees / sumByQuote / creatorExtraQuoteMints', () => {
	const buckets = [
		bucket({ curveFee: 10n }),
		bucket({
			mint: MINT_DONE.toBase58(),
			complete: true,
			curveFee: 3n,
			pool: { address: 'p', coinCreator: CREATOR.toBase58(), quoteMint: WSOL, fee: 900n },
		}),
		bucket({ mint: MINT_COIN_QUOTED.toBase58(), creator: OTHER.toBase58(), quoteMint: QUOTE_COIN.toBase58(), curveFee: 50n }),
		null,
	];

	it("keeps only the creator's legs, largest first", () => {
		const legs = unsweptCreatorFees(buckets, CREATOR.toBase58());
		expect(legs.map((l) => [l.source, l.amount])).toEqual([
			['pool', 900n],
			['curve', 10n],
			['curve', 3n],
		]);
	});

	it('keeps every nonzero leg for a permissionless crank', () => {
		expect(unsweptCreatorFees(buckets)).toHaveLength(4);
	});

	it('sums per quote mint', () => {
		const byQuote = sumByQuote(unsweptCreatorFees(buckets));
		expect(byQuote.get(WSOL)).toBe(913n);
		expect(byQuote.get(QUOTE_COIN.toBase58())).toBe(50n);
	});

	it("lists a creator's non-SOL quotes so a collect reaches pump-coin pairs", () => {
		expect(creatorExtraQuoteMints(buckets, CREATOR.toBase58())).toEqual([]);
		expect(creatorExtraQuoteMints(buckets, OTHER.toBase58()).map(String)).toEqual([QUOTE_COIN.toBase58()]);
	});
});

describe('creatorFeeSweepInstructions', () => {
	const payer = key(20);
	const solLeg = (mint, source, amount) => ({ mint: mint.toBase58(), source, recipient: CREATOR.toBase58(), quoteMint: WSOL, amount });

	it('builds one curve or pool sweep per leg, capped at max', async () => {
		const legs = [solLeg(MINT_DONE, 'pool', 9n), solLeg(MINT_LIVE, 'curve', 5n), solLeg(MINT_DONE, 'curve', 1n)];
		const out = await creatorFeeSweepInstructions(fakeConnection(new Map()), { legs, payer, max: 2 });
		expect(out.instructions).toHaveLength(2);
		expect(out.swept).toEqual(legs.slice(0, 2));
		expect(out.deferred).toBe(1);
		expect(out.instructions[0].programId.equals(PUMP_AMM_PROGRAM_ID)).toBe(true);
		expect(out.instructions[1].programId.equals(PUMP_PROGRAM_ID)).toBe(true);
	});

	it('skips a token-quoted leg whose quote mint cannot be read', async () => {
		const legs = [{ ...solLeg(MINT_COIN_QUOTED, 'curve', 4n), quoteMint: QUOTE_COIN.toBase58() }, solLeg(MINT_LIVE, 'curve', 2n)];
		const out = await creatorFeeSweepInstructions(fakeConnection(new Map()), { legs, payer });
		expect(out.swept.map((l) => l.mint)).toEqual([MINT_LIVE.toBase58()]);
		expect(out.deferred).toBe(1);
	});

	it('returns nothing to do for no legs', async () => {
		expect(await creatorFeeSweepInstructions(fakeConnection(new Map()), { legs: [], payer })).toEqual({
			instructions: [],
			swept: [],
			deferred: 0,
		});
	});
});

describe('countPrefixThatFits', () => {
	const payer = key(30);
	const transfer = (n) => SystemProgram.transfer({ fromPubkey: payer, toPubkey: key(40 + n), lamports: 1 });
	const blob = (bytes) => new TransactionInstruction({ programId: key(60), keys: [], data: Buffer.alloc(bytes) });

	it('keeps every prefix instruction that fits', () => {
		expect(countPrefixThatFits({ payer, prefix: [transfer(1), transfer(2)], rest: [transfer(3)] })).toBe(2);
	});

	it('drops trailing prefix instructions until the packet fits', () => {
		const prefix = [blob(400), blob(400), blob(400)];
		expect(countPrefixThatFits({ payer, prefix, rest: [blob(100)] })).toBe(2);
		expect(countPrefixThatFits({ payer, prefix, rest: [blob(100)], reserveBytes: 300 })).toBe(1);
	});

	it('answers 0 when the required instructions alone overflow', () => {
		expect(countPrefixThatFits({ payer, prefix: [transfer(1)], rest: [blob(1300)] })).toBe(0);
	});
});

describe('pumpTradesFromEvents', () => {
	const ev = (name, data) => ({ name, data });
	const trade = (over = {}) =>
		ev('TradeEvent', { mint: MINT_LIVE, user: CREATOR, is_buy: true, sol_amount: new BN(1_000), token_amount: new BN(70), timestamp: new BN(1), ...over });

	it('folds the synthetic-migration pool part into the buy that completed the curve', () => {
		const trades = pumpTradesFromEvents([
			trade(),
			ev('CompleteEvent', { mint: MINT_LIVE }),
			ev('PostCompleteBuyEvent', { mint: MINT_LIVE, user: CREATOR, quote_mint: new PublicKey(WSOL), base_out: new BN(30), quote_in: new BN(600) }),
		]);
		expect(trades).toHaveLength(1);
		expect(trades[0]).toMatchObject({ isBuy: true, solAmount: 1_600n, tokenAmount: 100n });
		expect(trades[0].postComplete).not.toBeNull();
	});

	it('adds pool-part tokens but not non-SOL quote to the SOL amount of a token-paired coin', () => {
		const [t] = pumpTradesFromEvents([
			trade(),
			ev('PostCompleteBuyEvent', { mint: MINT_LIVE, user: CREATOR, quote_mint: QUOTE_COIN, base_out: new BN(30), quote_in: new BN(600) }),
		]);
		expect(t).toMatchObject({ solAmount: 1_000n, tokenAmount: 100n });
	});

	it('leaves ordinary trades, sells and other mints untouched', () => {
		const trades = pumpTradesFromEvents([
			trade({ is_buy: false }),
			trade({ mint: MINT_DONE }),
			ev('PostCompleteBuyEvent', { mint: MINT_LIVE, user: CREATOR, base_out: new BN(5), quote_in: new BN(5) }),
		]);
		expect(trades.map((t) => [t.isBuy, t.solAmount, t.tokenAmount])).toEqual([
			[false, 1_000n, 70n],
			[true, 1_000n, 70n],
		]);
	});

	it('reads camelCased fields from older coders', () => {
		const [t] = pumpTradesFromEvents([
			ev('TradeEvent', { mint: MINT_LIVE, user: CREATOR, isBuy: true, solAmount: new BN(2), tokenAmount: new BN(3) }),
			ev('PostCompleteBuyEvent', { mint: MINT_LIVE, user: CREATOR, baseOut: new BN(4), quoteIn: new BN(5) }),
		]);
		expect(t).toMatchObject({ solAmount: 7n, tokenAmount: 7n });
	});
});

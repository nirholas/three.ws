// Tests for the x402 ring PAYER POOL — the reused rotating payer wallets
// (api/_lib/x402/pool.js) and their threshold funder (pipelines/ring-pool-fund.js).
// Pure logic only; no DB, no chain, no network.
//
// What these lock down:
//   • config gates — enable flag + target size parse exactly, off by default.
//   • balance decode — the SPL token-account amount is read from the right offset.
//   • funding planner — the pure decision (who needs SOL/USDC, who is overfull) is
//     correct, respects the controlled-set gate, and honors the per-run cap.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ringPoolEnabled, ringPoolTargetSize, ringPoolMaxGenerate } from '../api/_lib/x402/pool.js';
import { planPoolFunding, tokenAmountFromAccountData } from '../api/_lib/x402/pipelines/ring-pool-fund.js';

const FLOORS = {
	solFloor: 8_000_000, solTarget: 12_000_000,
	usdcFloor: 500_000, usdcTarget: 2_000_000, usdcCeil: 4_000_000,
	maxPerRun: 60,
};

describe('ring pool config gates', () => {
	const saved = {};
	beforeEach(() => { for (const k of ['X402_RING_POOL_ENABLED', 'X402_RING_POOL_SIZE', 'X402_RING_POOL_MAX_GENERATE']) saved[k] = process.env[k]; });
	afterEach(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

	it('is disabled by default and only "true" enables it', () => {
		delete process.env.X402_RING_POOL_ENABLED;
		expect(ringPoolEnabled()).toBe(false);
		process.env.X402_RING_POOL_ENABLED = '1';
		expect(ringPoolEnabled()).toBe(false);
		process.env.X402_RING_POOL_ENABLED = 'TRUE';
		expect(ringPoolEnabled()).toBe(true);
	});

	it('parses target size, rejecting junk and negatives', () => {
		delete process.env.X402_RING_POOL_SIZE;
		expect(ringPoolTargetSize()).toBe(0);
		process.env.X402_RING_POOL_SIZE = '750';
		expect(ringPoolTargetSize()).toBe(750);
		process.env.X402_RING_POOL_SIZE = '-5';
		expect(ringPoolTargetSize()).toBe(0);
		process.env.X402_RING_POOL_SIZE = 'abc';
		expect(ringPoolTargetSize()).toBe(0);
	});

	it('caps a single generate call (default 2000)', () => {
		delete process.env.X402_RING_POOL_MAX_GENERATE;
		expect(ringPoolMaxGenerate()).toBe(2000);
		process.env.X402_RING_POOL_MAX_GENERATE = '500';
		expect(ringPoolMaxGenerate()).toBe(500);
	});
});

describe('SPL token amount decode', () => {
	it('reads the u64 amount at byte offset 64, little-endian', () => {
		const data = Buffer.alloc(165); // SPL token account size
		data.writeBigUInt64LE(1_234_567n, 64);
		expect(tokenAmountFromAccountData(data)).toBe(1_234_567n);
	});
	it('treats a too-short / missing buffer as zero', () => {
		expect(tokenAmountFromAccountData(null)).toBe(0n);
		expect(tokenAmountFromAccountData(Buffer.alloc(10))).toBe(0n);
	});
});

describe('planPoolFunding (pure)', () => {
	const allowed = new Set(['A', 'B', 'C', 'D']);

	it('funds SOL below floor up to target', () => {
		const sol = new Map([['A', 1_000_000], ['B', 9_000_000]]); // A low, B fine
		const usdc = new Map([['A', 2_000_000n], ['B', 2_000_000n]]);
		const { solNeed } = planPoolFunding({ pubkeys: ['A', 'B'], solByPubkey: sol, usdcByPubkey: usdc, allowed, floors: FLOORS });
		expect(solNeed).toEqual([{ pk: 'A', add: 11_000_000 }]);
	});

	it('funds USDC below floor up to target and sweeps overfull back', () => {
		const sol = new Map([['A', 12_000_000], ['B', 12_000_000], ['C', 12_000_000]]);
		const usdc = new Map([['A', 100_000n], ['B', 2_000_000n], ['C', 5_000_000n]]); // A low, B fine, C overfull
		const { usdcNeed, usdcSweep } = planPoolFunding({ pubkeys: ['A', 'B', 'C'], solByPubkey: sol, usdcByPubkey: usdc, allowed, floors: FLOORS });
		expect(usdcNeed).toEqual([{ pk: 'A', add: 1_900_000n }]);
		expect(usdcSweep).toEqual([{ pk: 'C', take: 3_000_000n }]);
	});

	it('never funds a wallet outside the controlled set', () => {
		const sol = new Map([['A', 0], ['X', 0]]);
		const usdc = new Map([['A', 0n], ['X', 0n]]);
		const { solNeed, usdcNeed } = planPoolFunding({ pubkeys: ['A', 'X'], solByPubkey: sol, usdcByPubkey: usdc, allowed, floors: FLOORS });
		expect(solNeed.map((w) => w.pk)).toEqual(['A']);
		expect(usdcNeed.map((w) => w.pk)).toEqual(['A']);
	});

	it('honors the per-run cap', () => {
		const pks = Array.from({ length: 100 }, (_, i) => `w${i}`);
		const allowAll = new Set(pks);
		const sol = new Map(pks.map((p) => [p, 0]));
		const usdc = new Map(pks.map((p) => [p, 0n]));
		const { solNeed, usdcNeed } = planPoolFunding({ pubkeys: pks, solByPubkey: sol, usdcByPubkey: usdc, allowed: allowAll, floors: { ...FLOORS, maxPerRun: 10 } });
		expect(solNeed).toHaveLength(10);
		expect(usdcNeed).toHaveLength(10);
	});
});

// ── Funded-only rotation (2026-09-22) ─────────────────────────────────────────
// The claim only hands out wallets whose recorded balances cover the call, the
// funder only submits what its funders can pay, and it records post-move
// balances so the claim sees a just-funded wallet without waiting a cycle.

import { poolClaimFloors, CLAIM_FEE_ESTIMATE_LAMPORTS } from '../api/_lib/x402/pool.js';
import { trimToFunderCapacity, applyFundingMoves, funderReserveLamports } from '../api/_lib/x402/pipelines/ring-pool-fund.js';

describe('claim floors', () => {
	const keys = ['X402_RING_POOL_CLAIM_MIN_SOL_LAMPORTS', 'X402_RING_POOL_BALANCE_MAX_AGE_MINUTES', 'X402_SPONSOR_SOL_FLOOR_LAMPORTS'];
	const saved = {};
	beforeEach(() => { for (const k of keys) saved[k] = process.env[k]; });
	afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

	it('defaults to a few settles of SOL and a 30-minute freshness window', () => {
		for (const k of keys) delete process.env[k];
		expect(poolClaimFloors()).toEqual({ minSolLamports: 20_000, maxBalanceAgeMinutes: 30 });
		expect(poolClaimFloors().minSolLamports).toBeGreaterThan(CLAIM_FEE_ESTIMATE_LAMPORTS);
		expect(funderReserveLamports()).toBe(20_000_000);
	});

	it('honors env overrides and never accepts a zero-minute window', () => {
		process.env.X402_RING_POOL_CLAIM_MIN_SOL_LAMPORTS = '50000';
		process.env.X402_RING_POOL_BALANCE_MAX_AGE_MINUTES = '0';
		process.env.X402_SPONSOR_SOL_FLOOR_LAMPORTS = '2000000';
		expect(poolClaimFloors()).toEqual({ minSolLamports: 50_000, maxBalanceAgeMinutes: 1 });
		expect(funderReserveLamports()).toBe(2_000_000);
	});
});

describe('trimToFunderCapacity (pure)', () => {
	const solNeed = [{ pk: 'a', add: 12_000_000 }, { pk: 'b', add: 12_000_000 }, { pk: 'c', add: 12_000_000 }];
	const usdcNeed = [{ pk: 'a', add: 2_000_000n }, { pk: 'b', add: 2_000_000n }, { pk: 'c', add: 2_000_000n }];

	it('keeps the neediest-first head and drops the tail the sponsor cannot pay', () => {
		// 30M lamports, 5M reserve: 25M spendable covers two 12M top-ups (+5k fee each), not three.
		const r = trimToFunderCapacity({ solNeed, usdcNeed: [], funderLamports: 30_000_000, treasuryUsdcAtomic: 0n, reserveLamports: 5_000_000 });
		expect(r.solNeed.map((w) => w.pk)).toEqual(['a', 'b']);
		expect(r.skipped).toEqual({ sol: 1, usdc: 0 });
	});

	it('submits nothing from an empty sponsor and reports every skip', () => {
		const r = trimToFunderCapacity({ solNeed, usdcNeed, funderLamports: 7_800_000, treasuryUsdcAtomic: 10_000_000n, reserveLamports: 20_000_000 });
		expect(r.solNeed).toEqual([]);
		expect(r.usdcNeed).toEqual([]);
		expect(r.skipped).toEqual({ sol: 3, usdc: 3 });
	});

	it('bounds USDC by the treasury and charges ATA rent only for wallets without one', () => {
		const ataExists = new Set(['a']);
		// Treasury holds $4: covers two $2 top-ups. SOL budget 2.04M: 'a' needs only a fee,
		// 'b' needs rent (2,039,280) + fee = 2,044,280 > remaining, so 'b' is cut.
		const r = trimToFunderCapacity({ solNeed: [], usdcNeed, ataExists, funderLamports: 2_040_000, treasuryUsdcAtomic: 4_000_000n, reserveLamports: 0 });
		expect(r.usdcNeed.map((w) => w.pk)).toEqual(['a']);
		expect(r.skipped).toEqual({ sol: 0, usdc: 2 });
		const rich = trimToFunderCapacity({ solNeed: [], usdcNeed, ataExists, funderLamports: 10_000_000, treasuryUsdcAtomic: 4_000_000n, reserveLamports: 0 });
		expect(rich.usdcNeed.map((w) => w.pk)).toEqual(['a', 'b']);
		expect(rich.skipped).toEqual({ sol: 0, usdc: 1 });
	});

	it('shares one SOL budget between top-ups and USDC-leg rent', () => {
		// 12,005,000 lamports exactly funds one SOL top-up; nothing is left for rent.
		const r = trimToFunderCapacity({ solNeed: [solNeed[0]], usdcNeed: [usdcNeed[1]], ataExists: new Set(), funderLamports: 12_005_000, treasuryUsdcAtomic: 9_000_000n, reserveLamports: 0 });
		expect(r.solNeed.map((w) => w.pk)).toEqual(['a']);
		expect(r.usdcNeed).toEqual([]);
	});
});

describe('applyFundingMoves (pure)', () => {
	it('records reads plus this run\'s moves for every wallet, funded or not', () => {
		const pubkeys = ['a', 'b', 'c'];
		const solByPubkey = new Map([['a', 1_000], ['b', 15_000_000], ['c', 0]]);
		const usdcByPubkey = new Map([['a', 0n], ['b', 5_000_000n], ['c', 100n]]);
		const out = applyFundingMoves({
			pubkeys, solByPubkey, usdcByPubkey,
			solFunded: [{ pk: 'a', add: 11_999_000 }],
			usdcFunded: [{ pk: 'a', add: 2_000_000n }],
			usdcSwept: [{ pk: 'b', take: 3_000_000n }],
		});
		expect(out).toEqual([
			{ pubkey: 'a', solLamports: 12_000_000, usdcAtomic: 2_000_000n },
			{ pubkey: 'b', solLamports: 15_000_000, usdcAtomic: 2_000_000n },
			{ pubkey: 'c', solLamports: 0, usdcAtomic: 100n },
		]);
		// Inputs are not mutated: the funder's read maps stay the on-chain truth.
		expect(solByPubkey.get('a')).toBe(1_000);
		expect(usdcByPubkey.get('b')).toBe(5_000_000n);
	});
});

// Guard for the documented hazard: if THREE_REWARDS_WALLET is also the buyback or
// micro-buy signer, the treasury sweep would move the whole holder-rewards pool
// into the treasury. Every lane must refuse before any RPC spend or sweep build.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

const rpc = vi.hoisted(() => ({ calls: 0, submits: 0 }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
vi.mock('../api/_lib/pump.js', async () => {
	const actual = await vi.importActual('../api/_lib/pump.js').catch(() => ({}));
	return {
		...actual,
		getConnection: vi.fn(() => {
			rpc.calls += 1;
			throw new Error('RPC must not be touched when the rewards wallet is the signer');
		}),
		solanaPubkey: vi.fn((k) => k),
	};
});
vi.mock('../api/_lib/execution-engine.js', () => ({
	submitProtected: vi.fn(async () => {
		rpc.submits += 1;
		return { signature: 'sig' };
	}),
}));

const buyback = await import('../api/_lib/token/buyback.js');
const microbuy = await import('../api/_lib/token/microbuy.js');
const { assertRewardsNotSwept } = await import('../api/_lib/token/config.js');

const KEYS = ['THREE_REWARDS_WALLET', 'THREE_TREASURY_WALLET', 'THREE_BUYBACK_ENABLED', 'THREE_MICROBUY_ENABLED'];
let saved;
let signer;

beforeEach(() => {
	saved = {};
	for (const k of KEYS) saved[k] = process.env[k];
	signer = Keypair.generate();
	process.env.THREE_REWARDS_WALLET = signer.publicKey.toBase58();
	process.env.THREE_TREASURY_WALLET = Keypair.generate().publicKey.toBase58();
	process.env.THREE_BUYBACK_ENABLED = '1';
	process.env.THREE_MICROBUY_ENABLED = '1';
	rpc.calls = 0;
	rpc.submits = 0;
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('assertRewardsNotSwept', () => {
	it('throws a typed error when the signer is the rewards wallet', () => {
		expect(() => assertRewardsNotSwept(signer.publicKey.toBase58())).toThrow(
			expect.objectContaining({ code: 'rewards_wallet_is_signer' }),
		);
	});

	it('passes for a distinct signer and when no rewards wallet is configured', () => {
		expect(() => assertRewardsNotSwept(Keypair.generate().publicKey.toBase58())).not.toThrow();
		delete process.env.THREE_REWARDS_WALLET;
		expect(() => assertRewardsNotSwept(signer.publicKey.toBase58())).not.toThrow();
	});
});

describe('buyback lane', () => {
	it('planBuyback refuses with rewards_wallet_is_signer before any RPC', async () => {
		const plan = await buyback.planBuyback(signer.publicKey.toBase58());
		expect(plan.ok).toBe(false);
		expect(plan.reason).toBe('rewards_wallet_is_signer');
		expect(rpc.calls).toBe(0);
	});

	it('executeBuyback refuses and builds no sweep', async () => {
		await expect(buyback.executeBuyback(signer, { quote: {}, spendUsdcAtomics: 1n })).rejects.toMatchObject({
			code: 'rewards_wallet_is_signer',
		});
		expect(rpc.calls).toBe(0);
		expect(rpc.submits).toBe(0);
	});

	it('sweepStrandedThree refuses and builds no sweep', async () => {
		await expect(buyback.sweepStrandedThree(signer)).rejects.toMatchObject({ code: 'rewards_wallet_is_signer' });
		expect(rpc.calls).toBe(0);
		expect(rpc.submits).toBe(0);
	});
});

describe('micro-buy lane', () => {
	it('planMicrobuy refuses with rewards_wallet_is_signer before any RPC', async () => {
		const plan = await microbuy.planMicrobuy(signer.publicKey.toBase58());
		expect(plan.ok).toBe(false);
		expect(plan.reason).toBe('rewards_wallet_is_signer');
		expect(rpc.calls).toBe(0);
	});

	it('executeMicrobuy refuses before any RPC', async () => {
		await expect(microbuy.executeMicrobuy(signer, { quote: {}, spendUsdcAtomics: 1n })).rejects.toMatchObject({
			code: 'rewards_wallet_is_signer',
		});
		expect(rpc.calls).toBe(0);
	});

	it('sweepMicrobuyThree refuses and builds no sweep', async () => {
		await expect(microbuy.sweepMicrobuyThree(signer)).rejects.toMatchObject({ code: 'rewards_wallet_is_signer' });
		expect(rpc.calls).toBe(0);
		expect(rpc.submits).toBe(0);
	});
});

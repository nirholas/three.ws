import { describe, it, expect, afterEach } from 'vitest';
import {
	parseBounty, clampFeeBps, computeEscrow, releaseLegs, refundLeg, assertBalanced,
	usdc, MIN_BOUNTY_ATOMICS, MAX_FEE_BPS, maxBountyAtomics,
} from '../api/_lib/human-tasks/money.js';
import { defaultLevelForBounty, computeLevel } from '../api/_lib/human-tasks/verification.js';
import { sign, verifySignature } from '../api/_lib/human-tasks/external.js';

const W = '11111111111111111111111111111112';
const F = 'THREEsynthetic1111111111111111111111111111';
const task = (over = {}) => ({
	id: 't1', bounty_atomics: '10000000', fee_atomics: '500000', escrow_atomics: '10500000',
	payout_address: W, fee_recipient: F, ...over,
});

afterEach(() => { delete process.env.HUMAN_TASK_MAX_BOUNTY_USDC; });

describe('human-task money', () => {
	it('parses bounties in USDC and enforces the range', () => {
		expect(parseBounty('2.5')).toBe(2_500_000n);
		expect(parseBounty('1')).toBe(MIN_BOUNTY_ATOMICS);
		expect(() => parseBounty('0.5')).toThrow(/at least/);
		expect(() => parseBounty('501')).toThrow(/at most/);
		process.env.HUMAN_TASK_MAX_BOUNTY_USDC = '50';
		expect(maxBountyAtomics()).toBe(50_000_000n);
		expect(() => parseBounty('51')).toThrow(/at most/);
	});

	it('escrow is bounty plus a fee that rounds down', () => {
		const e = computeEscrow(10_000_000n, 500);
		expect(e).toEqual({ bounty: 10_000_000n, fee: 500_000n, escrow: 10_500_000n, feeBps: 500 });
		expect(computeEscrow(1_000_001n, 500).fee).toBe(50_000n);
		expect(computeEscrow(1_000_000n, 0).escrow).toBe(1_000_000n);
		expect(() => computeEscrow(0n, 500)).toThrow();
	});

	it('clamps the fee rate', () => {
		expect(clampFeeBps(-5)).toBe(0);
		expect(clampFeeBps('abc')).toBe(0);
		expect(clampFeeBps(99999)).toBe(MAX_FEE_BPS);
		expect(clampFeeBps(250.9)).toBe(250);
	});

	it('release pays the worker the full bounty and the fee wallet the fee (escrow equals quote minus nothing the worker was promised)', () => {
		const legs = releaseLegs(task());
		expect(legs.map((l) => [l.kind, l.recipient, l.atomics])).toEqual([
			['payout', W, 10_000_000n],
			['fee', F, 500_000n],
		]);
		expect(legs.reduce((s, l) => s + l.atomics, 0n)).toBe(10_500_000n);
	});

	it('a fee-free task releases a single leg', () => {
		const legs = releaseLegs(task({ fee_atomics: '0', escrow_atomics: '10000000' }));
		expect(legs).toHaveLength(1);
	});

	it('refuses to release without a payout address or fee wallet', () => {
		expect(() => releaseLegs(task({ payout_address: null }))).toThrow(/payout address/);
		expect(() => releaseLegs(task({ fee_recipient: null }))).toThrow(/fee wallet/);
	});

	it('a refund returns the whole escrow, fee included', () => {
		expect(refundLeg(task(), W)).toMatchObject({ kind: 'refund', atomics: 10_500_000n, recipient: W });
		expect(() => refundLeg(task(), null)).toThrow(/wallet to refund/);
	});

	it('refuses legs that do not add up to the escrow', () => {
		expect(() => assertBalanced(task(), [{ atomics: 1n }])).toThrow(/escrow/);
		expect(() => assertBalanced(task({ escrow_atomics: '1' }), [])).toThrow(/does not equal/);
	});

	it('formats atomics', () => {
		expect(usdc(2_500_000n)).toBe('2.5');
	});
});

describe('human-task verification levels', () => {
	it('scales the default minimum level with the bounty', () => {
		expect(defaultLevelForBounty(5_000_000n)).toBe(0);
		expect(defaultLevelForBounty(25_000_000n)).toBe(1);
		expect(defaultLevelForBounty(100_000_000n)).toBe(2);
	});

	it('derives the level from proven facts only', () => {
		expect(computeLevel({ solanaWallets: 0 })).toBe(-1);
		expect(computeLevel({ solanaWallets: 1 })).toBe(0);
		expect(computeLevel({ solanaWallets: 1, emailVerified: true })).toBe(1);
		expect(computeLevel({ solanaWallets: 1, emailVerified: true, paidTasks: 3, avgRating: 4 })).toBe(2);
		expect(computeLevel({ solanaWallets: 1, emailVerified: true, paidTasks: 2, avgRating: 5 })).toBe(1);
		expect(computeLevel({ solanaWallets: 1, emailVerified: true, paidTasks: 9, avgRating: 3.9 })).toBe(1);
	});
});

describe('external callback signatures', () => {
	const body = '{"event":"claim","task_id":"t1"}';
	it('accepts a fresh correct signature and rejects stale or wrong ones', () => {
		const now = Date.now();
		const ts = String(Math.floor(now / 1000));
		const signature = sign('s3cret', ts, body);
		expect(verifySignature({ secret: 's3cret', timestamp: ts, signature, body, now })).toBe(true);
		expect(verifySignature({ secret: 'other', timestamp: ts, signature, body, now })).toBe(false);
		expect(verifySignature({ secret: 's3cret', timestamp: ts, signature, body: body + ' ', now })).toBe(false);
		expect(verifySignature({ secret: 's3cret', timestamp: ts, signature, body, now: now + 10 * 60_000 })).toBe(false);
		expect(verifySignature({ secret: '', timestamp: ts, signature, body, now })).toBe(false);
	});
});

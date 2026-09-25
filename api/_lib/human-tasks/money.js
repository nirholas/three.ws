// Escrow accounting for human tasks. Pure BigInt arithmetic on USDC atomics
// (6 decimals), never floats.
//
// Posting locks bounty + fee in the task's escrow account. Exactly one of two
// things then leaves it, and together they always add up to what went in:
//
//   release  bounty -> the worker's payout wallet, fee -> the platform fee wallet
//   refund   bounty + fee -> the poster agent's wallet (nothing was earned)
//
// The fee is taken only when a task pays out: a cancelled or expired task
// refunds the full escrow, fee included.

import { formatAtomics, parseAmount } from '../agent-market/chain.js';

export const USDC_DECIMALS = 6;
const ATOMICS = 10n ** BigInt(USDC_DECIMALS);

export const MIN_BOUNTY_ATOMICS = 1n * ATOMICS;
export const DEFAULT_MAX_BOUNTY_USDC = 500;
export const MAX_FEE_BPS = 1000;

function typed(status, code, message) {
	return Object.assign(new Error(message), { status, code, expose: true });
}

/** The largest bounty a single task may carry (HUMAN_TASK_MAX_BOUNTY_USDC, default 500). */
export function maxBountyAtomics() {
	const raw = Number(process.env.HUMAN_TASK_MAX_BOUNTY_USDC);
	const usdc = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_BOUNTY_USDC;
	return BigInt(usdc) * ATOMICS;
}

/** Parse a bounty given in USDC ("2.5") into atomics, inside the allowed range. */
export function parseBounty(value) {
	const atomics = parseAmount(value, USDC_DECIMALS);
	if (atomics < MIN_BOUNTY_ATOMICS) {
		throw typed(400, 'bounty_too_small', `A bounty must be at least ${formatAtomics(MIN_BOUNTY_ATOMICS, USDC_DECIMALS)} USDC.`);
	}
	const max = maxBountyAtomics();
	if (atomics > max) {
		throw typed(400, 'bounty_too_large', `A bounty can be at most ${formatAtomics(max, USDC_DECIMALS)} USDC.`);
	}
	return atomics;
}

/** Clamp a basis-point fee rate into [0, MAX_FEE_BPS]. */
export function clampFeeBps(bps) {
	const n = Math.floor(Number(bps));
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.min(n, MAX_FEE_BPS);
}

/**
 * The escrow a bounty requires at a fee rate. The fee rounds down, so the
 * poster is never charged a fraction of an atomic unit they were not quoted.
 * @returns {{ bounty: bigint, fee: bigint, escrow: bigint, feeBps: number }}
 */
export function computeEscrow(bountyAtomics, feeBps) {
	const bounty = BigInt(String(bountyAtomics));
	if (bounty <= 0n) throw typed(400, 'bad_amount', 'bounty must be greater than zero');
	const bps = clampFeeBps(feeBps);
	const fee = (bounty * BigInt(bps)) / 10_000n;
	return { bounty, fee, escrow: bounty + fee, feeBps: bps };
}

/**
 * The legs that release a task's escrow: the bounty to the worker, then the fee
 * to the fee wallet when there is one. Their sum is always escrow_atomics.
 */
export function releaseLegs(task) {
	const bounty = BigInt(String(task.bounty_atomics));
	const fee = BigInt(String(task.fee_atomics || 0));
	if (!task.payout_address) throw typed(409, 'no_payout_address', 'This task has no payout address to release to.');
	const legs = [{ kind: 'payout', legId: `payout:${task.id}`, recipient: task.payout_address, atomics: bounty }];
	if (fee > 0n) {
		if (!task.fee_recipient) throw typed(409, 'no_fee_recipient', 'This task charged a fee but has no fee wallet recorded.');
		legs.push({ kind: 'fee', legId: `fee:${task.id}`, recipient: task.fee_recipient, atomics: fee });
	}
	assertBalanced(task, legs);
	return legs;
}

/** The single leg that refunds a task: the whole escrow back to the poster agent. */
export function refundLeg(task, destination) {
	if (!destination) throw typed(409, 'no_refund_address', 'The poster agent has no wallet to refund to.');
	const leg = { kind: 'refund', legId: `refund:${task.id}`, recipient: destination, atomics: BigInt(String(task.escrow_atomics)) };
	assertBalanced(task, [leg]);
	return leg;
}

/** Throw unless the legs move exactly the escrow, no more and no less. */
export function assertBalanced(task, legs) {
	const escrow = BigInt(String(task.escrow_atomics));
	const bounty = BigInt(String(task.bounty_atomics));
	const fee = BigInt(String(task.fee_atomics || 0));
	if (bounty + fee !== escrow) throw typed(500, 'escrow_unbalanced', `task ${task.id} escrow does not equal bounty plus fee`);
	const total = legs.reduce((s, l) => s + BigInt(String(l.atomics)), 0n);
	if (total !== escrow) throw typed(500, 'escrow_unbalanced', `legs for task ${task.id} move ${total}, escrow holds ${escrow}`);
}

/** "2.5" for 2500000n. */
export function usdc(atomics) {
	return formatAtomics(atomics, USDC_DECIMALS);
}

export { parseAmount, formatAtomics };

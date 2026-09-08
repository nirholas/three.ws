// Floor accounting in the self-hosted facilitator
// (api/_lib/x402/self-facilitator.js).
//
// Two defects found while triaging why /club had not settled a payment since
// 2026-09-04, both of which bite hardest the moment a NEW payment token goes
// live (which is exactly what $THREE on /club is):
//
//  1. The hard SOL floor compared the bare sponsor balance against the floor and
//     ignored what the settle was about to spend. A settle that has to create the
//     recipient's associated token account carries ~0.00204 SOL of rent, so a
//     sponsor sitting just above the floor passed the gate and then died on chain
//     with InsufficientFundsForRent. The payTo has no $THREE token account, so the
//     first $THREE payment is precisely that case.
//  2. Floor state (which decides whether the 402 keeps advertising the SPONSORED
//     Solana accept) was recorded from whichever wallet paid the fee. A healthy
//     self-pay buyer therefore stamped "not below floor" for a starved sponsor and
//     re-advertised accepts that could not settle.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	Keypair,
	TransactionMessage,
	VersionedTransaction,
	ComputeBudgetProgram,
} from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	createTransferCheckedInstruction,
	createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

const { settleRingPayment, sponsorKnownBelowFloor, SPONSOR_SOL_FLOOR_LAMPORTS } =
	await import('../api/_lib/x402/self-facilitator.js');

const DECIMALS = 6;
const ATA_RENT_LAMPORTS = 2_039_280;

/**
 * Build a buyer-signed transfer. `withAtaCreate` prepends the idempotent
 * ATA-create the facilitator charges rent for, modelling a recipient that has
 * never held this mint.
 */
function buildPayment({ amount = 10_000n, sponsor, withAtaCreate = false } = {}) {
	const buyer = Keypair.generate();
	const recipientOwner = Keypair.generate();
	const mint = Keypair.generate().publicKey;
	process.env.X402_ASSET_MINT_SOLANA = mint.toBase58();
	const feePayerKey = sponsor ? sponsor.publicKey : buyer.publicKey;

	const sourceAta = getAssociatedTokenAddressSync(mint, buyer.publicKey);
	const destAta = getAssociatedTokenAddressSync(mint, recipientOwner.publicKey);
	const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 })];
	if (withAtaCreate) {
		instructions.push(createAssociatedTokenAccountIdempotentInstruction(
			feePayerKey, destAta, recipientOwner.publicKey, mint,
		));
	}
	instructions.push(createTransferCheckedInstruction(
		sourceAta, mint, destAta, buyer.publicKey, amount, DECIMALS,
	));

	const message = new TransactionMessage({
		payerKey: feePayerKey,
		recentBlockhash: '11111111111111111111111111111111',
		instructions,
	}).compileToV0Message();
	const tx = new VersionedTransaction(message);
	tx.sign([buyer]);

	return {
		buyer,
		payTo: recipientOwner.publicKey.toBase58(),
		requirement: {
			network: 'solana',
			asset: mint.toBase58(),
			amount: String(amount),
			payTo: recipientOwner.publicKey.toBase58(),
		},
		paymentPayload: { transaction: Buffer.from(tx.serialize()).toString('base64') },
	};
}

const ENV_KEYS = ['X402_PAY_TO_SOLANA', 'X402_ASSET_MINT_SOLANA', 'X402_FEE_PAYER_SOLANA'];
let saved;
beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('settle affordability: the floor must survive the settle', () => {
	it('refuses an ATA-creating settle the sponsor cannot cover, instead of dying on chain', async () => {
		const sponsor = Keypair.generate();
		const p = buildPayment({ sponsor, withAtaCreate: true });
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		// Comfortably over the bare floor, but not by the ATA rent this settle
		// needs. The old gate passed this and the transaction failed on chain.
		const balance = SPONSOR_SOL_FLOOR_LAMPORTS + 100_000;
		const conn = { getBalance: async () => balance };

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			feePayer: sponsor,
		});

		expect(res.success).toBe(false);
		expect(res.reason).toMatch(/^fee_wallet_cannot_cover_settle:/);
		// The reason carries the numbers an operator needs to size a top-up.
		expect(res.estFeeLamports).toBeGreaterThanOrEqual(ATA_RENT_LAMPORTS);
		expect(res.sponsorSolLamports).toBe(balance);
	});

	it('still reports the plain below-floor reason when the balance is under the floor', async () => {
		const sponsor = Keypair.generate();
		const p = buildPayment({ sponsor, withAtaCreate: true });
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const conn = { getBalance: async () => SPONSOR_SOL_FLOOR_LAMPORTS - 1 };

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			feePayer: sponsor,
		});

		// The two conditions stay distinguishable: "top the wallet up at all" vs
		// "this particular settle costs more than the headroom you have".
		expect(res.success).toBe(false);
		expect(res.reason).toMatch(/^fee_wallet_below_floor:/);
	});

	it('lets an ATA-creating settle through once the rent fits above the floor', async () => {
		const sponsor = Keypair.generate();
		const p = buildPayment({ sponsor, withAtaCreate: true });
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const conn = { getBalance: async () => SPONSOR_SOL_FLOOR_LAMPORTS + ATA_RENT_LAMPORTS + 1_000_000 };

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			feePayer: sponsor,
		});

		// It gets past both SOL gates. It fails later for an unrelated reason (this
		// stub connection cannot broadcast), which is exactly the point: neither
		// floor check is what stopped it.
		expect(res.reason || '').not.toMatch(/fee_wallet_below_floor|fee_wallet_cannot_cover_settle/);
	});
});

describe('floor state is recorded only for the advertised sponsor wallet', () => {
	it('does not clear a starved sponsor because an unrelated self-pay buyer is healthy', async () => {
		const sponsor = Keypair.generate();
		process.env.X402_FEE_PAYER_SOLANA = sponsor.publicKey.toBase58();

		// A starved SPONSOR settle stamps the floor state below.
		const sponsored = buildPayment({ sponsor });
		process.env.X402_PAY_TO_SOLANA = sponsored.payTo;
		await settleRingPayment({
			paymentPayload: sponsored.paymentPayload,
			requirement: sponsored.requirement,
			conn: { getBalance: async () => 1 },
			feePayer: sponsor,
		});
		expect(sponsorKnownBelowFloor()).toBe(true);

		// Now a DIFFERENT wallet self-pays with a healthy balance. It must not
		// speak for the sponsor: the 402 builder would otherwise resume
		// advertising a sponsored accept that cannot settle.
		const selfPaid = buildPayment({});
		process.env.X402_PAY_TO_SOLANA = selfPaid.payTo;
		await settleRingPayment({
			paymentPayload: selfPaid.paymentPayload,
			requirement: selfPaid.requirement,
			conn: { getBalance: async () => SPONSOR_SOL_FLOOR_LAMPORTS * 100 },
		});

		expect(sponsorKnownBelowFloor()).toBe(true);
	});
});

describe('self-pay: a dry sponsor must not close a receiving endpoint', () => {
	it('holds a self-pay buyer to the fee only, not to the sponsor reserve', async () => {
		// The buyer is their own fee payer. Our 0.02 SOL reserve is there to stop
		// the paying loop draining the PLATFORM wallet, so applying it to a
		// stranger's wallet would refuse a payment we can settle for free.
		const p = buildPayment({});
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		// Far under the sponsor floor, but comfortably able to pay its own fee.
		const conn = { getBalance: async () => 30_000 };

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});

		expect(res.reason || '').not.toMatch(/fee_wallet_below_floor|fee_wallet_cannot_cover_settle/);
	});

	it('still refuses a self-pay buyer who cannot cover the fee', async () => {
		const p = buildPayment({});
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const conn = { getBalance: async () => 1 };

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});

		expect(res.success).toBe(false);
		expect(res.reason).toMatch(/^fee_wallet_cannot_cover_settle:/);
	});

	it('leaves the sponsor reserve fully in force for sponsored settles', async () => {
		// The relaxation above must not leak into sponsor mode, which is the only
		// thing standing between the paying loop and an empty platform wallet.
		const sponsor = Keypair.generate();
		const p = buildPayment({ sponsor });
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const conn = { getBalance: async () => 30_000 };

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			feePayer: sponsor,
		});

		expect(res.success).toBe(false);
		expect(res.reason).toMatch(/^fee_wallet_below_floor:30000</);
	});
});

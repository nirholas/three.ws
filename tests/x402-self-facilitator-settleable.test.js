// Tests for the settleability gate in verifyRingPayment
// (api/_lib/x402/self-facilitator.js).
//
// The paid flow is verify → run handler → settle. A static decode alone
// (validateRingTransaction) proves a payment is SHAPED right but not that it can
// actually settle, so a buyer could sign a well-formed TransferChecked from a
// ZERO-balance ATA, pass verify, make the expensive handler run (burning upstream
// provider spend), and only then have settle revert `insufficient funds`. The gate
// simulates the transaction on /verify and rejects anything that cannot settle,
// with a source-balance fallback when simulation RPC is unavailable and a
// fail-closed result when neither can run.

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
} from '@solana/spl-token';

const { verifyRingPayment, validateRingTransaction } = await import('../api/_lib/x402/self-facilitator.js');

const DECIMALS = 6;
const AMOUNT_ATOMIC = 1000n; // 0.001 USDC

// Build a real, buyer-signed SELF-PAY ring transaction: fee payer == the USDC
// authority, so no sponsor key is needed and validateRingTransaction accepts it as
// long as payTo is allowlisted. Returns the payment payload + requirement the
// facilitator consumes.
function buildSelfPayPayment({ amount = AMOUNT_ATOMIC } = {}) {
	const buyer = Keypair.generate();
	const recipientOwner = Keypair.generate();
	const mint = Keypair.generate().publicKey;

	const sourceAta = getAssociatedTokenAddressSync(mint, buyer.publicKey);
	const destAta = getAssociatedTokenAddressSync(mint, recipientOwner.publicKey);

	const transferIx = createTransferCheckedInstruction(
		sourceAta, mint, destAta, buyer.publicKey, amount, DECIMALS,
	);
	// The facilitator only settles mints the platform issues 402s for (pinned
	// to the configured env mints after the 2026-07-23 audit); model this
	// synthetic mint as the configured one.
	process.env.X402_ASSET_MINT_SOLANA = mint.toBase58();
	const message = new TransactionMessage({
		payerKey: buyer.publicKey,
		recentBlockhash: '11111111111111111111111111111111',
		instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), transferIx],
	}).compileToV0Message();
	const tx = new VersionedTransaction(message);
	tx.sign([buyer]);

	return {
		payTo: recipientOwner.publicKey.toBase58(),
		feePayer: buyer.publicKey.toBase58(),
		requirement: {
			network: 'solana',
			asset: mint.toBase58(),
			amount: String(amount),
			payTo: recipientOwner.publicKey.toBase58(),
		},
		paymentPayload: { transaction: Buffer.from(tx.serialize()).toString('base64') },
	};
}

let prevPayTo;
let prevAssetMint;
let prevThreeMint;
let prevFeePayer;
beforeEach(() => {
	prevPayTo = process.env.X402_PAY_TO_SOLANA;
	prevAssetMint = process.env.X402_ASSET_MINT_SOLANA;
	prevThreeMint = process.env.THREE_TOKEN_MINT;
	prevFeePayer = process.env.X402_FEE_PAYER_SOLANA;
});
afterEach(() => {
	if (prevPayTo === undefined) delete process.env.X402_PAY_TO_SOLANA;
	else process.env.X402_PAY_TO_SOLANA = prevPayTo;
	if (prevAssetMint === undefined) delete process.env.X402_ASSET_MINT_SOLANA;
	else process.env.X402_ASSET_MINT_SOLANA = prevAssetMint;
	if (prevThreeMint === undefined) delete process.env.THREE_TOKEN_MINT;
	else process.env.THREE_TOKEN_MINT = prevThreeMint;
	if (prevFeePayer === undefined) delete process.env.X402_FEE_PAYER_SOLANA;
	else process.env.X402_FEE_PAYER_SOLANA = prevFeePayer;
});

describe('verifyRingPayment settleability gate', () => {
	it('rejects a payment whose simulation reverts (zero-balance source ATA)', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		// Simulation of a transfer from an unfunded ATA returns an InstructionError.
		const conn = {
			simulateTransaction: async () => ({ value: { err: { InstructionError: [1, { Custom: 1 }] } } }),
			getTokenAccountBalance: async () => { throw new Error('should not be called'); },
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(false);
		expect(res.invalidReason).toMatch(/^simulation_failed:/);
	});

	it('accepts a payment whose simulation succeeds (funded)', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const conn = {
			simulateTransaction: async () => ({ value: { err: null, logs: [] } }),
			getTokenAccountBalance: async () => { throw new Error('should not be called'); },
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(true);
		expect(res.payer).toBeTruthy();
		expect(res.asset).toBe(p.requirement.asset);
	});

	it('falls back to a source-balance read when simulation is unavailable — rejects a zero balance', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const conn = {
			simulateTransaction: async () => { throw new Error('rpc down'); },
			getTokenAccountBalance: async () => ({ value: { amount: '0' } }),
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(false);
		expect(res.invalidReason).toMatch(/^insufficient_source_balance:/);
	});

	it('falls back to a source-balance read when simulation is unavailable — accepts a sufficient balance', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const conn = {
			simulateTransaction: async () => { throw new Error('rpc down'); },
			getTokenAccountBalance: async () => ({ value: { amount: String(AMOUNT_ATOMIC) } }),
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(true);
	});

	it('fails CLOSED when neither simulation nor balance read is available', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const conn = {
			simulateTransaction: async () => { throw new Error('rpc down'); },
			getTokenAccountBalance: async () => { throw new Error('rpc down'); },
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(false);
		expect(res.invalidReason).toMatch(/^settle_precheck_unavailable:/);
	});

	it('still rejects a malformed static shape before ever simulating', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		let simulated = false;
		const conn = {
			simulateTransaction: async () => { simulated = true; return { value: { err: null } }; },
			getTokenAccountBalance: async () => ({ value: { amount: '0' } }),
		};
		// payTo not in the allowlist → static validation must fail, no RPC touched.
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: { ...p.requirement, payTo: Keypair.generate().publicKey.toBase58() },
			conn,
		});
		expect(res.isValid).toBe(false);
		expect(simulated).toBe(false);
	});
});

describe('mint pin (2026-07-23 audit: junk-mint sponsor drain)', () => {
	it('rejects a well-formed transfer whose mint is not a configured settleable asset', async () => {
		const p = buildSelfPayPayment(); // sets X402_ASSET_MINT_SOLANA to its mint
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		// Point the configured settleable mint ELSEWHERE: the tx's mint is now
		// junk as far as the facilitator is concerned, which is exactly the
		// attack shape — sponsor funds ATA rent + fees for a worthless token.
		process.env.X402_ASSET_MINT_SOLANA = Keypair.generate().publicKey.toBase58();
		delete process.env.THREE_TOKEN_MINT;
		let simulated = false;
		const conn = {
			simulateTransaction: async () => { simulated = true; return { value: { err: null } }; },
			getTokenAccountBalance: async () => ({ value: { amount: '999999999' } }),
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(false);
		expect(res.invalidReason).toMatch(/^mint_not_settleable:/);
		// Static rejection must happen before any simulation RPC is touched.
		expect(simulated).toBe(false);
	});

	it('fails closed when no settleable mint is configured at all', () => {
		const p = buildSelfPayPayment();
		delete process.env.X402_ASSET_MINT_SOLANA;
		delete process.env.THREE_TOKEN_MINT;
		const tx = VersionedTransaction.deserialize(
			Buffer.from(p.paymentPayload.transaction, 'base64'),
		);
		const out = validateRingTransaction({
			txBase64: p.paymentPayload.transaction,
			requirement: p.requirement,
			feePayerPubkey: tx.message.staticAccountKeys[0],
			allowlist: new Set([p.payTo]),
		});
		expect(out.ok).toBe(false);
		expect(out.reason).toMatch(/^mint_not_settleable:/);
	});
});

// An unfundable FEE PAYER gets its own reason class, separate from every other
// simulation revert.
//
// Every consumer of `invalidReason` groups on the token before the first ':'.
// /api/healthz exposes only that prefix, and isRailFault() in
// api/_lib/ops/x402-settle-health.js matches /simulation/, so while this verdict
// was spelled `simulation_failed` a starved platform sponsor was (a) bucketed
// with buyers signing from empty ATAs and (b) counted as a payment-RAIL fault.
// Production on 2026-09-09: 1,438 verify rejects in 24h, top of the book, every
// one of them {"InsufficientFundsForRent":{"account_index":0}} on our own
// sponsor. Account index 0 is the fee payer by definition, so the split is exact.
describe('fee-payer rent failures are their own reason class', () => {
	const RENT_ERR = { InsufficientFundsForRent: { account_index: 0 } };

	it('names the platform sponsor when the dry fee payer is ours', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		process.env.X402_FEE_PAYER_SOLANA = p.feePayer;
		const conn = {
			simulateTransaction: async () => ({ value: { err: RENT_ERR } }),
			getTokenAccountBalance: async () => { throw new Error('should not be called'); },
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(false);
		expect(res.invalidReason.split(':')[0]).toBe('sponsor_fee_unfunded');
		// The suffix keeps the evidence: which wallet the chain refused.
		expect(res.invalidReason).toContain(p.feePayer);
	});

	it('names the buyer when the dry fee payer is not ours', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		process.env.X402_FEE_PAYER_SOLANA = Keypair.generate().publicKey.toBase58();
		const conn = {
			simulateTransaction: async () => ({ value: { err: RENT_ERR } }),
			getTokenAccountBalance: async () => { throw new Error('should not be called'); },
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(false);
		// A broke buyer must never wear the platform's class: nothing to fund.
		expect(res.invalidReason.split(':')[0]).toBe('payer_fee_unfunded');
	});

	it('leaves every other simulation revert as simulation_failed', async () => {
		const p = buildSelfPayPayment();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		process.env.X402_FEE_PAYER_SOLANA = p.feePayer;
		const conn = {
			// A rent failure on a NON-fee-payer account is a different condition and
			// must not be reclassified: only index 0 is the fee payer.
			simulateTransaction: async () => ({
				value: { err: { InsufficientFundsForRent: { account_index: 3 } } },
			}),
			getTokenAccountBalance: async () => { throw new Error('should not be called'); },
		};
		const res = await verifyRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
		});
		expect(res.isValid).toBe(false);
		expect(res.invalidReason.split(':')[0]).toBe('simulation_failed');
	});
});

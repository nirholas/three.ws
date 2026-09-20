// `settlement_pending`: the third settle outcome, end to end.
//
// Before this behavior existed, a settle whose confirmation wait ran out was
// reported as a failure: the facilitator answered `not_confirmed:confirm_timeout`
// and the resource server turned that into a 502. That is wrong whenever the
// transaction actually lands a slot later, which is exactly the case a timeout
// cannot distinguish. The buyer is charged and told they were not, and the good
// they paid for is withheld.
//
// The rail now answers `{ success:false, errorReason:'settlement_pending',
// transaction }` for an unknown outcome, retries it once against the recorded
// signature instead of broadcasting a second transaction, and reconciles the
// result out of band. These tests pin the three properties that make that safe:
//
//   1. UNKNOWN is never reported as failure, and never without a durable record.
//   2. A retry of a payload already broadcast NEVER broadcasts again.
//   3. A definite on-chain failure is still a failure. Pending is for unknown,
//      not for "we would rather not say".
//
// The confirmation window is squeezed to ~1ms via env so the unknown-outcome
// cases do not spend the real 12s wait.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	Keypair,
	TransactionMessage,
	VersionedTransaction,
	ComputeBudgetProgram,
} from '@solana/web3.js';
import {
	TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	createTransferCheckedInstruction,
} from '@solana/spl-token';
import { seedTokenProgramForMint } from '../api/_lib/solana-token-program.js';
import bs58 from 'bs58';

const { settleRingPayment, probeSettlementSignature } = await import(
	'../api/_lib/x402/self-facilitator.js'
);
const {
	SETTLEMENT_PENDING_REASON,
	SETTLEMENT_PENDING_UNRECORDABLE_REASON,
	pendingSettlementKey,
	recordPendingOrTerminal,
} = await import('../api/_lib/x402/pending-settlements.js');

const DECIMALS = 6;

// Self-pay settle (buyer is its own fee payer) so the sponsor min-settle and
// SOL-floor guards are exempt and the flow reaches the broadcast with a minimal
// connection mock. Mirrors the harness in x402-self-facilitator-settle-recovery.
function buildSelfPay(amount = 10_000) {
	const buyer = Keypair.generate();
	const recipientOwner = Keypair.generate();
	const mint = Keypair.generate().publicKey;
	process.env.X402_ASSET_MINT_SOLANA = mint.toBase58();
	// The facilitator pins the token program from the mint, and this synthetic
	// mint has no account to read it from. Model it as classic SPL Token.
	seedTokenProgramForMint(mint, TOKEN_PROGRAM_ID);
	const sourceAta = getAssociatedTokenAddressSync(mint, buyer.publicKey);
	const destAta = getAssociatedTokenAddressSync(mint, recipientOwner.publicKey);
	const transferIx = createTransferCheckedInstruction(
		sourceAta, mint, destAta, buyer.publicKey, amount, DECIMALS,
	);
	const message = new TransactionMessage({
		payerKey: buyer.publicKey,
		recentBlockhash: '11111111111111111111111111111111',
		instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }), transferIx],
	}).compileToV0Message();
	const tx = new VersionedTransaction(message);
	tx.sign([buyer]);
	const txBase64 = Buffer.from(tx.serialize()).toString('base64');
	return {
		sig: bs58.encode(tx.signatures[0]),
		txBase64,
		key: pendingSettlementKey(txBase64),
		payTo: recipientOwner.publicKey.toBase58(),
		requirement: {
			network: 'solana',
			asset: mint.toBase58(),
			amount: String(amount),
			payTo: recipientOwner.publicKey.toBase58(),
		},
		paymentPayload: { transaction: txBase64 },
	};
}

// The PendingSettlementStore contract, in memory. The production store is
// Postgres-backed (shared across Cloud Run replicas); the contract under test
// here is get/set/delete, not the storage.
function memoryStore({ failWrites = false } = {}) {
	const entries = new Map();
	return {
		entries,
		writes: [],
		deletes: [],
		async get(key) {
			return entries.get(key);
		},
		async set(key, txHash, meta) {
			this.writes.push({ key, txHash, meta });
			if (failWrites) return false;
			entries.set(key, txHash);
			return true;
		},
		async delete(key) {
			this.deletes.push(key);
			entries.delete(key);
		},
	};
}

describe('settlement_pending: unknown confirmation is not a failure', () => {
	const saved = {};
	beforeEach(() => {
		saved.payTo = process.env.X402_PAY_TO_SOLANA;
		saved.mint = process.env.X402_ASSET_MINT_SOLANA;
		saved.confirmMs = process.env.X402_SETTLE_CONFIRM_TIMEOUT_MS;
		process.env.X402_SETTLE_CONFIRM_TIMEOUT_MS = '1';
	});
	afterEach(() => {
		for (const [envName, key] of [
			['X402_PAY_TO_SOLANA', 'payTo'],
			['X402_ASSET_MINT_SOLANA', 'mint'],
			['X402_SETTLE_CONFIRM_TIMEOUT_MS', 'confirmMs'],
		]) {
			if (saved[key] === undefined) delete process.env[envName];
			else process.env[envName] = saved[key];
		}
	});

	it('answers settlement_pending (not a failure) when the confirmation wait ends unknown', async () => {
		const p = buildSelfPay();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const store = memoryStore();
		const conn = {
			getBalance: async () => 1_000_000_000,
			sendRawTransaction: async () => p.sig,
			// Broadcast landed nowhere yet: no status at all, which is precisely the
			// state a timeout cannot tell apart from "about to land".
			getSignatureStatuses: async () => ({ value: [null] }),
		};

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			pendingStore: store,
			idempotencyKey: 'idem-1',
		});

		expect(res.success).toBe(false);
		expect(res.reason).toBe(SETTLEMENT_PENDING_REASON);
		expect(res.pending).toBe(true);
		// The signature is what makes the outcome recoverable; a pending answer
		// without one is useless to a retry and to reconciliation.
		expect(res.transaction).toBe(p.sig);
		expect(store.entries.get(p.key)).toBe(p.sig);
		// Recorded with the caller's idempotency key, so the reconcile pass claims
		// the settle credit under the SAME key the resource server used.
		expect(store.writes[0].meta.idempotencyKey).toBe('idem-1');
	});

	it('downgrades pending to a terminal failure when the record cannot be stored', async () => {
		// Answering pending promises that a retry can reconcile. With no record a
		// retry would re-verify and re-broadcast, turning an unknown outcome into a
		// double send, so an unrecordable pending must be terminal instead.
		const p = buildSelfPay();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const store = memoryStore({ failWrites: true });
		const conn = {
			getBalance: async () => 1_000_000_000,
			sendRawTransaction: async () => p.sig,
			getSignatureStatuses: async () => ({ value: [null] }),
		};

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			pendingStore: store,
		});

		expect(res.success).toBe(false);
		expect(res.pending).toBe(false);
		expect(res.reason.startsWith(SETTLEMENT_PENDING_UNRECORDABLE_REASON)).toBe(true);
		// The signature still rides along: it is the only handle anyone has for
		// reconciling this payment by hand.
		expect(res.transaction).toBe(p.sig);
	});

	it('still reports a definite on-chain failure as a failure', async () => {
		const p = buildSelfPay();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const store = memoryStore();
		const conn = {
			getBalance: async () => 1_000_000_000,
			sendRawTransaction: async () => p.sig,
			getSignatureStatuses: async () => ({
				value: [{ err: { InstructionError: [1, 'InsufficientFunds'] }, confirmationStatus: 'confirmed' }],
			}),
		};

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			pendingStore: store,
		});

		expect(res.success).toBe(false);
		expect(res.pending).toBeFalsy();
		expect(res.reason).toContain('not_confirmed');
		expect(res.reason).toContain('InsufficientFunds');
		// Nothing to wait for, so no pending entry is left behind to re-probe.
		expect(store.entries.has(p.key)).toBe(false);
		expect(store.deletes).toContain(p.key);
	});

	it('treats an RPC that cannot answer as unknown, never as failure', async () => {
		const p = buildSelfPay();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const store = memoryStore();
		const conn = {
			getBalance: async () => 1_000_000_000,
			sendRawTransaction: async () => p.sig,
			getSignatureStatuses: async () => {
				throw new Error('429 Too Many Requests');
			},
		};

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			pendingStore: store,
		});

		expect(res.reason).toBe(SETTLEMENT_PENDING_REASON);
		expect(res.pending).toBe(true);
		expect(store.writes[0].meta.lastError).toContain('confirm_rpc_unavailable');
	});

	it('clears the pending entry once a settle confirms', async () => {
		const p = buildSelfPay();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const store = memoryStore();
		const conn = {
			getBalance: async () => 1_000_000_000,
			sendRawTransaction: async () => p.sig,
			getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }),
			getParsedTransaction: async () => ({ meta: { fee: 5000 } }),
		};

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			pendingStore: store,
		});

		expect(res.success).toBe(true);
		expect(store.deletes).toContain(p.key);
		expect(store.entries.size).toBe(0);
	});
});

describe('settlement_pending: a retry reconciles instead of re-broadcasting', () => {
	const saved = {};
	beforeEach(() => {
		saved.payTo = process.env.X402_PAY_TO_SOLANA;
		saved.mint = process.env.X402_ASSET_MINT_SOLANA;
		saved.confirmMs = process.env.X402_SETTLE_CONFIRM_TIMEOUT_MS;
		process.env.X402_SETTLE_CONFIRM_TIMEOUT_MS = '1';
	});
	afterEach(() => {
		for (const [envName, key] of [
			['X402_PAY_TO_SOLANA', 'payTo'],
			['X402_ASSET_MINT_SOLANA', 'mint'],
			['X402_SETTLE_CONFIRM_TIMEOUT_MS', 'confirmMs'],
		]) {
			if (saved[key] === undefined) delete process.env[envName];
			else process.env[envName] = saved[key];
		}
	});

	it('confirms the signature already on the wire without sending a second transaction', async () => {
		const p = buildSelfPay();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const store = memoryStore();
		await store.set(p.key, p.sig, {});
		store.writes.length = 0;

		const send = vi.fn(async () => p.sig);
		const conn = {
			getBalance: async () => 1_000_000_000,
			sendRawTransaction: send,
			getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }),
			getParsedTransaction: async () => ({ meta: { fee: 5000 } }),
		};

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			pendingStore: store,
		});

		// The whole point: one broadcast for one authorization, ever.
		expect(send).not.toHaveBeenCalled();
		expect(res.success).toBe(true);
		expect(res.reconciled).toBe(true);
		expect(res.transaction).toBe(p.sig);
		expect(store.entries.size).toBe(0);
	});

	it('stays pending (and still does not re-broadcast) when the retry is also unknown', async () => {
		const p = buildSelfPay();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const store = memoryStore();
		await store.set(p.key, p.sig, {});

		const send = vi.fn(async () => p.sig);
		const conn = {
			getBalance: async () => 1_000_000_000,
			sendRawTransaction: send,
			getSignatureStatuses: async () => ({ value: [null] }),
		};

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			pendingStore: store,
		});

		expect(send).not.toHaveBeenCalled();
		expect(res.reason).toBe(SETTLEMENT_PENDING_REASON);
		expect(store.entries.get(p.key)).toBe(p.sig);
	});

	it('reports failure (and clears the entry) when the reconciled signature reverted', async () => {
		const p = buildSelfPay();
		process.env.X402_PAY_TO_SOLANA = p.payTo;
		const store = memoryStore();
		await store.set(p.key, p.sig, {});

		const conn = {
			getBalance: async () => 1_000_000_000,
			sendRawTransaction: async () => p.sig,
			getSignatureStatuses: async () => ({
				value: [{ err: { InstructionError: [1, 'Custom'] }, confirmationStatus: 'finalized' }],
			}),
		};

		const res = await settleRingPayment({
			paymentPayload: p.paymentPayload,
			requirement: p.requirement,
			conn,
			pendingStore: store,
		});

		expect(res.success).toBe(false);
		expect(res.reason).toContain('not_confirmed');
		expect(store.entries.has(p.key)).toBe(false);
	});
});

describe('pendingSettlementKey', () => {
	it('is deterministic per payload and distinct across payloads', () => {
		const a = buildSelfPay();
		const b = buildSelfPay();
		expect(pendingSettlementKey(a.txBase64)).toBe(pendingSettlementKey(a.txBase64));
		expect(pendingSettlementKey(a.txBase64)).not.toBe(pendingSettlementKey(b.txBase64));
		expect(pendingSettlementKey(null)).toBe(null);
	});
});

describe('recordPendingOrTerminal', () => {
	it('is terminal when no store is supplied at all', async () => {
		const res = await recordPendingOrTerminal({
			store: null,
			key: 'k',
			signature: 'sig',
			network: 'solana',
			payer: 'payer',
			cause: 'confirm_timeout',
		});
		expect(res.pending).toBe(false);
		expect(res.reason).toContain(SETTLEMENT_PENDING_UNRECORDABLE_REASON);
		expect(res.reason).toContain('confirm_timeout');
	});
});

describe('probeSettlementSignature (the reconcile pass read)', () => {
	it('confirms with the real fee the chain charged', async () => {
		const conn = {
			getSignatureStatuses: async (sigs, opts) => {
				expect(opts?.searchTransactionHistory).toBe(true);
				return { value: [{ err: null, confirmationStatus: 'finalized' }] };
			},
			getParsedTransaction: async () => ({ meta: { fee: 5432 } }),
		};
		const out = await probeSettlementSignature({ conn, signature: 'sig', broadcastAtMs: Date.now() });
		expect(out.state).toBe('confirmed');
		expect(out.feeLamports).toBe(5432);
	});

	it('reports failed for a signature that landed with an error', async () => {
		const conn = {
			getSignatureStatuses: async () => ({ value: [{ err: { InstructionError: [0, 'X'] } }] }),
		};
		const out = await probeSettlementSignature({ conn, signature: 'sig', broadcastAtMs: Date.now() });
		expect(out.state).toBe('failed');
		expect(out.error).toContain('InstructionError');
	});

	it('stays pending while the transaction could still land', async () => {
		const conn = { getSignatureStatuses: async () => ({ value: [null] }) };
		const out = await probeSettlementSignature({ conn, signature: 'sig', broadcastAtMs: Date.now() });
		expect(out.state).toBe('pending');
	});

	it('abandons a signature the ledger has never seen past the blockhash horizon', async () => {
		// A transaction can only be included while its blockhash is live. Past that
		// "not found" stops meaning "not yet" and starts meaning "dropped", which is
		// the difference between waiting forever and closing the row.
		const conn = { getSignatureStatuses: async () => ({ value: [null] }) };
		const out = await probeSettlementSignature({
			conn,
			signature: 'sig',
			broadcastAtMs: Date.now() - 10 * 60_000,
		});
		expect(out.state).toBe('abandoned');
	});

	it('does not conclude anything from an RPC that failed', async () => {
		const conn = {
			getSignatureStatuses: async () => {
				throw new Error('connection reset');
			},
		};
		const out = await probeSettlementSignature({
			conn,
			signature: 'sig',
			// Old enough to be abandoned IF the RPC had actually answered "not found".
			broadcastAtMs: Date.now() - 10 * 60_000,
		});
		expect(out.state).toBe('pending');
		expect(out.error).toContain('probe_rpc_failed');
	});
});

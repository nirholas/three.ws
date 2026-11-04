// One focused test per facilitator guard, plus the settle-recovery behaviour.
// The chain is a scripted RPC double: it dedupes by signature the way a cluster
// does, so duplicate and lost-confirmation cases exercise the real settle path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { createFacilitator, USDC_DEVNET, MemoryPendingStore } from '../src/facilitator/index.js';
import { buildPayment } from '../src/facilitator/attacks.js';

const NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

function chain({ balance = 2_000_000_000, confirm = 'confirmed' } = {}) {
	const state = { balance, landed: new Set(), sends: 0, confirm };
	const sigOf = (raw) => bs58.encode(VersionedTransaction.deserialize(raw).signatures[0]);
	const conn = {
		state,
		async getBalance() {
			return state.balance;
		},
		async simulateTransaction() {
			return { value: { err: null, logs: [] } };
		},
		async isBlockhashValid() {
			return { value: true };
		},
		async sendRawTransaction(raw) {
			const sig = sigOf(raw);
			if (state.landed.has(sig)) throw new Error('Transaction has already been processed');
			state.sends += 1;
			state.landed.add(sig);
			return sig;
		},
		async getSignatureStatuses([sig]) {
			if (state.confirm === 'never') return { value: [null] };
			return { value: [state.landed.has(sig) ? { err: null, confirmationStatus: 'confirmed' } : null] };
		},
		async getParsedTransaction() {
			return { meta: { fee: 5000 } };
		},
	};
	return conn;
}

function setup({ guards = {}, conn = chain(), store } = {}) {
	const sponsor = Keypair.generate();
	const payTo = Keypair.generate().publicKey.toBase58();
	const facilitator = createFacilitator({
		connection: conn,
		feePayer: sponsor,
		payToAllowlist: [payTo],
		settleableMints: [USDC_DEVNET],
		guards: { sponsorSolFloorLamports: 20_000_000, minSponsoredSettleAtomic: 1000, confirmTimeoutMs: 60, ...guards },
		...(store ? { store } : {}),
	});
	const pay = (over = {}) => {
		const b = buildPayment({ network: NETWORK, feePayer: sponsor.publicKey.toBase58(), payTo, mint: USDC_DEVNET, ...over });
		return { paymentPayload: b.paymentPayload, requirement: b.paymentRequirements, feePayerPubkey: sponsor.publicKey.toBase58() };
	};
	return { facilitator, conn, sponsor, payTo, pay };
}

test('guard: sponsor SOL floor refuses a settle when the fee wallet is below it', async () => {
	const { facilitator, pay } = setup({ conn: chain({ balance: 1_000_000 }) });
	const r = await facilitator.settleRingPayment(pay());
	assert.equal(r.success, false);
	assert.match(r.reason, /^fee_wallet_below_floor:/);
});

test('guard: the floor must survive the settle, so a balance just above it still refuses', async () => {
	const { facilitator, pay } = setup({ conn: chain({ balance: 20_000_500 }) });
	const r = await facilitator.settleRingPayment(pay());
	assert.match(r.reason, /^fee_wallet_cannot_cover_settle:/);
});

test('guard: ATA-create rent is bounded and priced into the floor gate', async () => {
	const { facilitator, pay } = setup({ conn: chain({ balance: 20_000_000 + 1_000_000 }) });
	const withoutAta = facilitator.validateRingTransaction({
		txBase64: pay().paymentPayload.payload.transaction,
		requirement: pay().requirement,
	});
	assert.equal(withoutAta.ok, true);
	const p = pay({ createRecipientAta: true });
	const decoded = facilitator.validateRingTransaction({
		txBase64: p.paymentPayload.payload.transaction,
		requirement: p.requirement,
	});
	assert.equal(decoded.ok, true);
	assert.ok(decoded.decoded.estFeeLamports >= 2_039_280, 'rent must be in the estimate');
	assert.ok(decoded.decoded.estFeeLamports < 2_200_000, 'rent estimate is bounded');
	const r = await facilitator.settleRingPayment(p);
	assert.match(r.reason, /^fee_wallet_cannot_cover_settle:/, 'a balance that cannot also cover the rent refuses');
});

test('guard: the rolling fee budget bounds the sponsor burn rate', async () => {
	const { facilitator, pay } = setup({ guards: { feeBudget: { lamports: 15_000, windowMs: 60_000 } } });
	const first = await facilitator.settleRingPayment(pay());
	assert.equal(first.success, true);
	const second = await facilitator.settleRingPayment(pay());
	assert.equal(second.success, false);
	assert.match(second.reason, /^fee_budget_exhausted:/);
	assert.ok(facilitator.feeBudget.used() > 0);
});

test('guard: the fee budget window rolls forward', async () => {
	let now = 1_000_000;
	const { facilitator, pay } = setup({ guards: { feeBudget: { lamports: 15_000, windowMs: 60_000 } } });
	const clocked = createFacilitator({
		connection: chain(),
		feePayer: Keypair.generate(),
		payToAllowlist: [],
		settleableMints: [],
		clock: { now: () => now },
		guards: { feeBudget: { lamports: 100, windowMs: 1000 } },
	});
	clocked.feeBudget.record(100);
	assert.equal(clocked.feeBudget.allows(1), false);
	now += 1500;
	assert.equal(clocked.feeBudget.allows(1), true);
	assert.ok(facilitator && pay);
});

test('guard: minimum sponsored settle refuses a dust transfer and honors the configured value', async () => {
	const { facilitator, pay } = setup();
	const dust = await facilitator.settleRingPayment(pay({ amount: 999n }));
	assert.match(dust.reason, /^amount_below_min_settle:999<1000/);
	const lowered = setup({ guards: { minSponsoredSettleAtomic: 10 } });
	const ok = await lowered.facilitator.settleRingPayment(lowered.pay({ amount: 999n }));
	assert.equal(ok.success, true);
});

test('guard: recipient allowlist refuses a settle to any other wallet', async () => {
	const { facilitator, pay } = setup();
	const stranger = Keypair.generate().publicKey.toBase58();
	const r = await facilitator.settleRingPayment(pay({ payTo: stranger }));
	assert.match(r.reason, /^pay_to_not_allowlisted:/);
});

test('guard: mint allowlist refuses a mint the operator does not settle', async () => {
	const { facilitator, pay } = setup();
	const r = await facilitator.verifyRingPayment(pay({ mint: Keypair.generate().publicKey.toBase58() }));
	assert.match(r.invalidReason, /^mint_not_settleable:/);
});

test('guard: priority-fee ceilings are configurable per facilitator', async () => {
	const { facilitator, pay } = setup({ guards: { maxCuPriceMicroLamports: 500 } });
	const r = await facilitator.verifyRingPayment(pay({ priceMicroLamports: 1000 }));
	assert.match(r.invalidReason, /^cu_price_too_high:/);
	const roomy = setup({ guards: { maxCuPriceMicroLamports: 5000 } });
	assert.equal((await roomy.facilitator.verifyRingPayment(roomy.pay({ priceMicroLamports: 1000 }))).isValid, true);
});

test('guard: rent-failure detection trips the floor only for the advertised sponsor', () => {
	const { facilitator, sponsor } = setup();
	const err = { InsufficientFundsForRent: { account_index: 0 } };
	assert.equal(facilitator.isFeePayerRentFailure(err), true);
	assert.equal(facilitator.isFeePayerRentFailure({ InsufficientFundsForRent: { account_index: 2 } }), false);
	assert.equal(facilitator.isFeePayerRentFailure('Transaction results in an account (0) with insufficient funds for rent'), true);
	assert.equal(facilitator.noteSponsorRentFailure(err, Keypair.generate().publicKey.toBase58()), false);
	assert.equal(facilitator.sponsorKnownBelowFloor(), false);
	assert.equal(facilitator.noteSponsorRentFailure(err, sponsor.publicKey.toBase58()), true);
	assert.equal(facilitator.sponsorKnownBelowFloor(), true);
});

test('recovery: a lost confirmation answers settlement_pending, and the retry reconciles without a second broadcast', async () => {
	const conn = chain({ confirm: 'never' });
	const { facilitator, pay } = setup({ conn });
	const p = pay();
	const first = await facilitator.settleRingPayment(p);
	assert.equal(first.success, false);
	assert.equal(first.pending, true);
	assert.equal(first.reason, 'settlement_pending');
	assert.equal(conn.state.sends, 1);

	conn.state.confirm = 'confirmed';
	const retry = await facilitator.settleRingPayment(p);
	assert.equal(retry.success, true);
	assert.equal(retry.reconciled, true);
	assert.equal(retry.transaction, first.transaction);
	assert.equal(conn.state.sends, 1, 'the retry must not broadcast a second transaction');
});

test('recovery: a settle that cannot be recorded is a terminal failure, never a pending promise', async () => {
	const failingStore = { get: async () => undefined, set: async () => false, delete: async () => {} };
	const { facilitator, pay } = setup({ conn: chain({ confirm: 'never' }), store: failingStore });
	const r = await facilitator.settleRingPayment(pay());
	assert.equal(r.success, false);
	assert.equal(r.pending, false);
	assert.match(r.reason, /^settlement_pending_unrecordable/);
});

test('idempotent settle: submitting the same payment twice lands one transaction and returns one signature', async () => {
	const conn = chain();
	const { facilitator, pay } = setup({ conn });
	const p = pay();
	const a = await facilitator.settleRingPayment(p);
	const b = await facilitator.settleRingPayment(p);
	assert.equal(a.success, true);
	assert.equal(b.success, true);
	assert.equal(b.replayed, true);
	assert.equal(a.transaction, b.transaction);
	assert.equal(conn.state.sends, 1);
});

test('decision log: every verify and settle leaves a machine-readable entry', async () => {
	const { facilitator, pay } = setup();
	await facilitator.settleRingPayment(pay({ amount: 5n }));
	await facilitator.verifyRingPayment(pay({ payTo: Keypair.generate().publicKey.toBase58() }));
	const entries = facilitator.decisionLog.recent(10);
	assert.equal(entries.length, 2);
	assert.deepEqual(entries.map((e) => e.action).sort(), ['settle', 'verify']);
	assert.ok(entries.every((e) => e.ok === false && /^[a-z_]+/.test(e.reason)));
	assert.ok(MemoryPendingStore);
});

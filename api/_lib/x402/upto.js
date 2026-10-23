// x402 v2 `upto` on Solana: the buyer authorizes a CAP, the seller measures the
// work and settles only what was used.
//
// Wire protocol, all from the official `@x402/svm/upto/*` packages (no
// hand-rolled signing):
//   402     accepts[] carries {scheme:'upto', amount:<cap>, extra:{feePayer,
//           receiverAuthorizer, withdrawDelay, tokenProgram, ...}}.
//   client  signs a payment-channel `open` transaction depositing the cap and
//           carries it in payload.openTransaction.
//   deposit settle (before the handler): the facilitator broadcasts the open
//           tx, escrowing the cap on chain.
//   claim   settle (after the handler): requirement.amount = the MEASURED
//           charge, plus a voucher signed by the receiverAuthorizer over that
//           cumulative amount. The program pays the seller the charge and
//           refunds the rest of the deposit to the buyer.
//   cancel  a claim of "0": a handler that failed settles nothing and the whole
//           deposit goes back to the buyer.
//
// three.ws is its own facilitator for this scheme: the UptoSvmScheme
// facilitator runs in-process, co-signing with the sponsor key that already
// backs the exact self-facilitator (X402_FEE_PAYER_SECRET_BASE58). The same key
// is the channel's receiverAuthorizer, so vouchers are signed locally and no
// third-party facilitator has to support `upto`.

import { env } from '../env.js';
import { loadFeePayerKeypair } from './self-facilitator.js';

export const UPTO_SCHEME = 'upto';

// Seconds a channel may stay open. The facilitator refuses longer lifetimes, so
// the 402 never advertises a maxTimeoutSeconds above this.
export const UPTO_MAX_TIMEOUT_SECONDS = 600;

export class UptoError extends Error {
	constructor(code, message, extra = {}) {
		super(message);
		this.name = 'UptoError';
		this.code = code;
		Object.assign(this, extra);
	}
}

let _bundle = null;
let _override = null;

// True when this deployment can run `upto`: opt-in flag plus the sponsor key.
export function uptoEnabled() {
	if (_override) return true;
	if (String(process.env.X402_UPTO_ENABLED || '').toLowerCase() !== 'true') return false;
	return !!process.env.X402_FEE_PAYER_SECRET_BASE58;
}

// Test seam: install a prebuilt { facilitator, server, signer } bundle (a real
// UptoSvmScheme facilitator wired to a test-controlled signer). Pass null to
// clear.
export function setUptoBundleForTests(bundle) {
	_override = bundle || null;
	_bundle = null;
}

async function bundle() {
	if (_override) return _override;
	if (_bundle) return _bundle;
	const [{ createKeyPairSignerFromBytes }, svmFac, svmSrv, svmRoot] = await Promise.all([
		import('@solana/kit'),
		import('@x402/svm/upto/facilitator'),
		import('@x402/svm/upto/server'),
		import('@x402/svm'),
	]);
	const kp = loadFeePayerKeypair();
	const signer = await createKeyPairSignerFromBytes(kp.secretKey);
	const rpc = env.SOLANA_RPC_URL;
	const facilitatorSigner = svmRoot.toFacilitatorSvmSigner(signer, { defaultRpcUrl: rpc });
	const facilitator = new svmFac.UptoSvmScheme(facilitatorSigner, {
		maxChannelLifetimeSecs: 3600,
	});
	const server = new svmSrv.UptoSvmScheme({
		receiverAuthorizerSigner: signer,
		rpcUrl: rpc,
	});
	_bundle = { facilitator, server, signer };
	return _bundle;
}

// Build the `accepts[]` entry for an upto offer. `capAtomics` is the maximum
// the buyer can be charged; the seller settles <= this.
export async function buildUptoRequirement({ capAtomics, network, asset, payTo, resourceUrl, description, mimeType }) {
	const b = await bundle();
	const base = {
		scheme: UPTO_SCHEME,
		network,
		asset,
		amount: String(capAtomics),
		payTo,
		maxTimeoutSeconds: UPTO_MAX_TIMEOUT_SECONDS,
		extra: {},
	};
	const supportedKind = {
		x402Version: 2,
		scheme: UPTO_SCHEME,
		network,
		extra: b.facilitator.getExtra(network) || {},
	};
	const req = await b.server.enhancePaymentRequirements(base, supportedKind, []);
	void resourceUrl;
	void description;
	void mimeType;
	return req;
}

// Verify a client's upto authorization against the requirement it chose.
// Resolves {isValid, invalidReason, payer}. The facilitator checks the signed
// open transaction (program, deposit == cap, payee, fee payer, simulation) and
// rejects a client-supplied voucher.
export async function verifyUpto({ paymentPayload, requirement }) {
	const b = await bundle();
	return b.facilitator.verify(paymentPayload, requirement);
}

// Phase 1: broadcast the open transaction so the cap is escrowed. Must succeed
// before the handler runs, otherwise the seller would do work it cannot collect.
export async function settleUptoDeposit({ paymentPayload, requirement }) {
	const b = await bundle();
	const stamped = await b.server.enrichSettlementPayload({
		phase: 'before-handler',
		paymentPayload,
		requirements: requirement,
	});
	return b.facilitator.settle(withStamp(paymentPayload, stamped), requirement);
}

// Phase 2: claim the measured amount. `amountAtomics` of 0 cancels: the whole
// deposit returns to the buyer. Resolves the facilitator SettleResponse.
export async function settleUptoClaim({ paymentPayload, requirement, amountAtomics }) {
	const b = await bundle();
	const amount = BigInt(amountAtomics);
	const cap = BigInt(requirement.amount);
	if (amount < 0n || amount > cap) {
		throw new UptoError(
			'charge_exceeds_cap',
			`upto: measured charge ${amount} is outside 0..${cap}`,
			{ status: 500 },
		);
	}
	const claimReq = { ...requirement, amount: amount.toString() };
	const stamped = await b.server.enrichSettlementPayload({
		phase: 'after-handler',
		paymentPayload,
		requirements: claimReq,
	});
	return b.facilitator.settle(withStamp(paymentPayload, stamped), claimReq);
}

function withStamp(paymentPayload, stamped) {
	return {
		...paymentPayload,
		payload: { ...paymentPayload.payload, ...(stamped || {}) },
	};
}

// A requirement is an upto offer when its scheme says so.
export function isUptoRequirement(r) {
	return r?.scheme === UPTO_SCHEME;
}

// Normalise a handler's measured charge to bigint, clamped by the cap. A
// handler may return atomic units as a bigint/number/string; anything
// unparseable is an error (we never guess a charge).
export function normaliseCharge(charge, capAtomics) {
	let n;
	try {
		n = BigInt(charge);
	} catch {
		throw new UptoError('invalid_charge', 'upto: handler charge must be a base-10 integer of atomic units', { status: 500 });
	}
	if (n < 0n) throw new UptoError('invalid_charge', 'upto: handler charge cannot be negative', { status: 500 });
	const cap = BigInt(capAtomics);
	return n > cap ? cap : n;
}

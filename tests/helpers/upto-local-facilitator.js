// A test-controlled `upto` facilitator for Solana.
//
// The real @x402/svm upto facilitator needs a live cluster with the payment
// channel program deployed. This stand-in keeps everything cryptographic REAL
// and replaces only the chain itself with an in-memory ledger the test can
// read:
//
//   verify  decodes the buyer's signed `open` transaction (built by the real
//           @x402/svm upto client), checks the buyer's ed25519 signature over
//           the compiled message, the fee payer, the channel program, and that
//           the deposit encoded in the instruction equals the cap.
//   settle  deposit: escrows the cap. claim: checks the receiverAuthorizer's
//           ed25519 voucher over (channelId, cumulative amount, expiresAt) with
//           WebCrypto, refuses a claim above the deposit, pays the seller the
//           claim and refunds the rest to the buyer.
//
// Same interface as UptoSvmScheme (facilitator): verify(payload, requirements)
// and settle(payload, requirements).

import {
	getAddressEncoder,
	getBase58Decoder,
	getBase58Encoder,
	getBase64Encoder,
	getCompiledTransactionMessageDecoder,
	getTransactionDecoder,
} from '@solana/kit';

export const PAYMENT_CHANNELS_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';

async function ed25519Verify({ publicKey, signature, message }) {
	const key = await crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']);
	return crypto.subtle.verify('Ed25519', key, signature, message);
}

// The byte layout the channel program verifies: magic, channel, u64 cumulative,
// i64 expiry. Rebuilt here independently of the package so a drift in what the
// server signs fails the test.
export function voucherBytes({ channelId, cumulativeAmount, expiresAt }) {
	const out = new Uint8Array(50);
	out[0] = 86;
	out[1] = 1;
	out.set(getBase58Encoder().encode(channelId), 2);
	const view = new DataView(out.buffer);
	view.setBigUint64(34, BigInt(cumulativeAmount), true);
	view.setBigInt64(42, BigInt(expiresAt), true);
	return out;
}

function containsU64LE(bytes, value) {
	const needle = new Uint8Array(8);
	new DataView(needle.buffer).setBigUint64(0, BigInt(value), true);
	outer: for (let i = 0; i + 8 <= bytes.length; i++) {
		for (let j = 0; j < 8; j++) if (bytes[i + j] !== needle[j]) continue outer;
		return true;
	}
	return false;
}

export class UptoLocalFacilitator {
	constructor({ feePayerAddress }) {
		this.feePayerAddress = feePayerAddress;
		this.channels = new Map();
		this.events = [];
		this.sig = 0;
	}

	getExtra() {
		return { feePayer: this.feePayerAddress };
	}

	getSigners() {
		return [this.feePayerAddress];
	}

	fail(payload, reason, message) {
		return {
			success: false,
			errorReason: reason,
			errorMessage: message,
			transaction: '',
			network: payload?.accepted?.network,
			payer: payload?.payload?.from,
		};
	}

	async verify(payload, requirements) {
		const raw = payload?.payload;
		const bad = (invalidReason, invalidMessage) => ({ isValid: false, invalidReason, invalidMessage, payer: raw?.from });
		if (payload?.accepted?.scheme !== 'upto' || requirements.scheme !== 'upto') return bad('unsupported_scheme');
		if (!raw?.openTransaction) return bad('invalid_upto_svm_payload_type');
		if ('voucherSignature' in raw || 'type' in raw) return bad('invalid_upto_svm_payload_unexpected_voucher');
		if (BigInt(raw.maxAmount) !== BigInt(requirements.amount)) return bad('invalid_upto_svm_payload_amount');
		if (BigInt(raw.deposit) !== BigInt(requirements.amount)) return bad('invalid_upto_svm_payload_deposit');
		if (raw.authorizedSigner !== requirements.extra?.receiverAuthorizer) {
			return bad('invalid_upto_svm_authorizer_address_mismatch');
		}

		const tx = getTransactionDecoder().decode(getBase64Encoder().encode(raw.openTransaction));
		const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
		const accounts = message.staticAccounts.map(String);
		if (accounts[0] !== requirements.extra?.feePayer) return bad('invalid_upto_svm_fee_payer');
		if (!accounts.includes(PAYMENT_CHANNELS_PROGRAM)) return bad('invalid_upto_svm_program');

		const sig = tx.signatures[raw.from];
		if (!sig) return bad('invalid_upto_svm_missing_payer_signature');
		const ok = await ed25519Verify({
			publicKey: getAddressEncoder().encode(raw.from),
			signature: sig,
			message: tx.messageBytes,
		});
		if (!ok) return bad('invalid_upto_svm_payer_signature');

		const channelIx = message.instructions.find(
			(ix) => accounts[ix.programAddressIndex] === PAYMENT_CHANNELS_PROGRAM,
		);
		if (!channelIx?.data || !containsU64LE(channelIx.data, requirements.amount)) {
			return bad('invalid_upto_svm_deposit_mismatch');
		}
		return { isValid: true, payer: raw.from };
	}

	async settle(payload, requirements) {
		const raw = payload?.payload;
		const base = { network: payload.accepted.network, payer: raw.from };
		if (raw.type === 'deposit') {
			if (this.channels.has(raw.channelId)) return this.fail(payload, 'invalid_upto_svm_channel_already_open');
			this.channels.set(raw.channelId, {
				payer: raw.from,
				payTo: requirements.payTo,
				deposit: BigInt(raw.deposit),
				authorizedSigner: raw.authorizedSigner,
				expiresAt: raw.expiresAt,
				state: 'open',
			});
			const transaction = `LOCAL-OPEN-${++this.sig}`;
			this.events.push({ kind: 'deposit', channelId: raw.channelId, amount: BigInt(raw.deposit) });
			return { success: true, transaction, ...base };
		}
		if (raw.type === 'claim') {
			const channel = this.channels.get(raw.channelId);
			if (!channel || channel.state !== 'open') return this.fail(payload, 'invalid_upto_svm_channel_not_open');
			const amount = BigInt(requirements.amount);
			if (amount > channel.deposit) return this.fail(payload, 'invalid_upto_svm_payload_settlement_exceeds_amount');
			if (!raw.voucherSignature) return this.fail(payload, 'invalid_upto_svm_payload_missing_voucher');
			const ok = await ed25519Verify({
				publicKey: getBase58Encoder().encode(channel.authorizedSigner),
				signature: getBase58Encoder().encode(raw.voucherSignature),
				message: voucherBytes({
					channelId: raw.channelId,
					cumulativeAmount: amount,
					expiresAt: channel.expiresAt,
				}),
			});
			if (!ok) return this.fail(payload, 'invalid_upto_svm_voucher_signature');
			channel.state = 'sealed';
			const transaction = `LOCAL-CLAIM-${++this.sig}`;
			this.events.push({
				kind: amount === 0n ? 'cancel' : 'claim',
				channelId: raw.channelId,
				paid: amount,
				refunded: channel.deposit - amount,
				payTo: channel.payTo,
				payer: channel.payer,
			});
			return { success: true, transaction, ...base };
		}
		return this.fail(payload, 'invalid_upto_svm_payload_type');
	}
}

export { getBase58Decoder };

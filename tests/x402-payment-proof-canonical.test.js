// One settled x402 payment has one identity, however its header is encoded.
//
// The replay guards (idempotency cache, isPaymentSpent, claimSpentPayment) were
// keyed on SHA-256 of the raw X-PAYMENT string, so stripping base64 padding,
// switching to the URL-safe alphabet or reflowing the JSON produced a "new"
// payment and the same settled transaction unlocked the good again.

import { describe, it, expect } from 'vitest';
import { hashPaymentProof, legacyPaymentProofHash } from '../api/_lib/x402/idempotency-cache.js';

const TX = Buffer.from('signed-solana-transaction-bytes-for-test').toString('base64');
const payment = { x402Version: 2, accepted: { network: 'solana:mainnet', amount: '10000' }, payload: { transaction: TX } };

function std(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }

describe('hashPaymentProof', () => {
	it('is stable across base64 padding, alphabet and JSON layout', () => {
		const a = std(payment);
		const unpadded = a.replace(/=+$/, '');
		const urlSafe = a.replace(/\+/g, '-').replace(/\//g, '_');
		const reflowed = Buffer.from(JSON.stringify(payment, null, 2)).toString('base64');
		const reordered = std({ payload: { transaction: TX }, accepted: payment.accepted, x402Version: 2 });
		const innerUnpadded = std({ ...payment, payload: { transaction: TX.replace(/=+$/, '') } });
		const h = hashPaymentProof(a);
		for (const v of [unpadded, urlSafe, reflowed, reordered, innerUnpadded]) expect(hashPaymentProof(v)).toBe(h);
	});

	it('binds to the payment, not the route it is presented to', () => {
		const other = std({ ...payment, accepted: { network: 'solana:mainnet', amount: '5000' }, resource: { url: '/api/x402/other' } });
		expect(hashPaymentProof(other)).toBe(hashPaymentProof(std(payment)));
	});

	it('distinguishes different payments', () => {
		const diff = std({ ...payment, payload: { transaction: Buffer.from('another-transaction').toString('base64') } });
		expect(hashPaymentProof(diff)).not.toBe(hashPaymentProof(std(payment)));
	});

	it('canonicalizes EVM hex case', () => {
		const evm = (nonce) => std({ x402Version: 2, payload: { signature: '0xABCD', authorization: { from: '0xAAaa', nonce } } });
		expect(hashPaymentProof(evm('0xFF01'))).toBe(hashPaymentProof(evm('0xff01')));
	});

	it('keeps the legacy raw-bytes hash available for the transition', () => {
		const a = std(payment);
		expect(legacyPaymentProofHash(a)).toMatch(/^[0-9a-f]{64}$/);
		expect(hashPaymentProof('not-a-payment')).toMatch(/^[0-9a-f]{64}$/);
	});
});

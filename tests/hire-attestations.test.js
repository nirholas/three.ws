// Signed hire-fulfillment attestations (work order 523): every settled
// a2a-hire writes a signed {hire_id, outcome, evidence_hash, signed_by} row,
// signed off-chain with the same platform attestation key
// api/_lib/attest-event.js uses for on-chain provenance. These tests pin:
//   - a correctly-signed attestation verifies against the configured key
//   - any tamper (payload, signature, or signer mismatch) fails closed
//   - the recency-weighted fulfillment rate respects the minimum sample gate

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');

import { verifyHireAttestation, weightedFulfillmentRate } from '../api/_lib/trust/hire-attestations.js';
import { buildHireAttestationPayload, sortedStringify } from '../api/_lib/a2a-hire-phases.js';
import { loadAttesterKeypair } from '../api/_lib/attest-event.js';

const kp = nacl.sign.keyPair();
const TEST_SEED = JSON.stringify(Array.from(kp.secretKey));

beforeEach(() => {
	process.env.ATTEST_AGENT_SECRET_KEY = TEST_SEED;
});

afterEach(() => {
	delete process.env.ATTEST_AGENT_SECRET_KEY;
});

function signWithPlatformKey(payload) {
	const keypair = loadAttesterKeypair();
	const message = Buffer.from(sortedStringify(payload), 'utf8');
	return Buffer.from(nacl.sign.detached(message, keypair.secretKey)).toString('base64');
}

describe('verifyHireAttestation', () => {
	it('verifies a signature produced with the configured platform attester key', () => {
		const keypair = loadAttesterKeypair();
		const payload = buildHireAttestationPayload({
			hireId: 'h1',
			paymentSignature: 'PAYSIG',
			outcome: 'delivered',
			evidenceHash: 'abc123',
			signedBy: keypair.publicKey.toBase58(),
		});
		const signature = signWithPlatformKey(payload);
		expect(verifyHireAttestation({ payload, signature, signedBy: payload.signed_by })).toBe(true);
	});

	it('rejects a payload tampered after signing', () => {
		const keypair = loadAttesterKeypair();
		const payload = buildHireAttestationPayload({
			hireId: 'h1',
			paymentSignature: 'PAYSIG',
			outcome: 'delivered',
			evidenceHash: 'abc123',
			signedBy: keypair.publicKey.toBase58(),
		});
		const signature = signWithPlatformKey(payload);
		const tampered = { ...payload, outcome: 'disputed' };
		expect(verifyHireAttestation({ payload: tampered, signature, signedBy: payload.signed_by })).toBe(false);
	});

	it('rejects a signature minted by a different key', () => {
		const keypair = loadAttesterKeypair();
		const payload = buildHireAttestationPayload({
			hireId: 'h1',
			paymentSignature: null,
			outcome: 'failed',
			evidenceHash: 'xyz',
			signedBy: keypair.publicKey.toBase58(),
		});
		const impostor = nacl.sign.keyPair();
		const message = Buffer.from(sortedStringify(payload), 'utf8');
		const forged = Buffer.from(nacl.sign.detached(message, impostor.secretKey)).toString('base64');
		expect(verifyHireAttestation({ payload, signature: forged, signedBy: payload.signed_by })).toBe(false);
	});

	it('rejects a signed_by claim that does not match the current platform key', () => {
		const payload = buildHireAttestationPayload({
			hireId: 'h1',
			paymentSignature: null,
			outcome: 'delivered',
			evidenceHash: 'abc123',
			signedBy: 'SomeOtherPubkeyNotThePlatformAttester1111',
		});
		const signature = signWithPlatformKey({ ...payload, signed_by: loadAttesterKeypair().publicKey.toBase58() });
		expect(verifyHireAttestation({ payload, signature, signedBy: payload.signed_by })).toBe(false);
	});

	it('fails closed on malformed input instead of throwing', () => {
		expect(verifyHireAttestation({ payload: null, signature: 'not-base64', signedBy: 'x' })).toBe(false);
		expect(verifyHireAttestation({ payload: {}, signature: undefined, signedBy: undefined })).toBe(false);
	});
});

describe('weightedFulfillmentRate', () => {
	const DAY = 86_400_000;
	const now = Date.now();

	it('returns null rate with no records', () => {
		expect(weightedFulfillmentRate([], { now })).toEqual({ rate: null, sampleSize: 0, weightedSampleSize: 0 });
	});

	it('scores an all-delivered recent history at 100%', () => {
		const records = Array.from({ length: 5 }, () => ({ outcome: 'delivered', created_at: new Date(now) }));
		const r = weightedFulfillmentRate(records, { now });
		expect(r.rate).toBeCloseTo(1, 9);
		expect(r.sampleSize).toBe(5);
	});

	it('never counts disputed as delivered', () => {
		const records = [
			{ outcome: 'delivered', created_at: new Date(now) },
			{ outcome: 'disputed', created_at: new Date(now) },
		];
		const r = weightedFulfillmentRate(records, { now });
		expect(r.rate).toBeCloseTo(0.5, 9);
	});

	it('weights recent attestations more than old ones (recency decay)', () => {
		const recentGood = [
			{ outcome: 'delivered', created_at: new Date(now) },
			{ outcome: 'delivered', created_at: new Date(now) },
			{ outcome: 'failed', created_at: new Date(now - 300 * DAY) },
		];
		const r = weightedFulfillmentRate(recentGood, { halfLifeDays: 30, now });
		// the old failure is decayed to near-zero weight at a 30-day half-life
		// after 300 days, so the rate should sit close to 1, not 2/3.
		expect(r.rate).toBeGreaterThan(0.9);
		expect(r.sampleSize).toBe(3);
	});
});

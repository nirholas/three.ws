// Wallet-recovery ownership proof: the challenge text and the signature check
// support runs before releasing a stranded agent-wallet balance. Every
// signature here is real ed25519 over a freshly generated Solana keypair.

import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
	buildChallenge,
	generateNonce,
	verifyWalletSignature,
} from '../scripts/lib/wallet-ownership.mjs';

const b58 = bs58.default ?? bs58;
const AGENT = '0b6f6a3e-6a52-4c8e-9a1d-2f4e8c7b5d10';
const ISSUED = '2026-11-04T12:00:00Z';

function sign(keypair, message) {
	const sig = ed25519.sign(new TextEncoder().encode(message), keypair.secretKey.slice(0, 32));
	return b58.encode(sig);
}

describe('buildChallenge', () => {
	it('produces the exact newline-separated block with no trailing newline', () => {
		const text = buildChallenge({ agentId: AGENT, nonce: 'EAVO7fkpv49J', issuedAt: ISSUED });
		expect(text).toBe(
			`three.ws wallet recovery\nagent: ${AGENT}\nnonce: EAVO7fkpv49J\nissued: ${ISSUED}`,
		);
	});

	it('is byte-stable for the same inputs and normalizes issued to seconds precision UTC', () => {
		const a = buildChallenge({ agentId: AGENT, nonce: 'abc', issuedAt: '2026-11-04T12:00:00.789Z' });
		const b = buildChallenge({ agentId: AGENT, nonce: 'abc', issuedAt: new Date('2026-11-04T12:00:00Z') });
		expect(a).toBe(b);
		expect(a.endsWith('issued: 2026-11-04T12:00:00Z')).toBe(true);
	});

	it('rejects an agent id that is not a UUID', () => {
		expect(() => buildChallenge({ agentId: 'not-a-uuid', nonce: 'abc', issuedAt: ISSUED })).toThrow(/uuid/i);
	});

	it('rejects a nonce that is not base64url', () => {
		expect(() => buildChallenge({ agentId: AGENT, nonce: 'has space', issuedAt: ISSUED })).toThrow(/nonce/i);
	});

	it('rejects an unparseable issued time', () => {
		expect(() => buildChallenge({ agentId: AGENT, nonce: 'abc', issuedAt: 'yesterday' })).toThrow(/issued/i);
	});
});

describe('generateNonce', () => {
	it('returns 9 random bytes as 12 base64url characters, distinct per call', () => {
		const a = generateNonce();
		const b = generateNonce();
		expect(a).toMatch(/^[A-Za-z0-9_-]{12}$/);
		expect(Buffer.from(a, 'base64url')).toHaveLength(9);
		expect(a).not.toBe(b);
	});
});

describe('verifyWalletSignature', () => {
	const kp = Keypair.generate();
	const address = kp.publicKey.toBase58();
	const message = buildChallenge({ agentId: AGENT, nonce: generateNonce(), issuedAt: ISSUED });
	const signature = sign(kp, message);

	it('accepts a real base58 signature from the claimed wallet', () => {
		expect(verifyWalletSignature({ message, address, signature })).toEqual({ ok: true, reason: null });
	});

	it('accepts the same signature base64-encoded', () => {
		const b64 = Buffer.from(b58.decode(signature)).toString('base64');
		expect(verifyWalletSignature({ message, address, signature: b64 }).ok).toBe(true);
	});

	it('rejects a signature made by a different key', () => {
		const other = sign(Keypair.generate(), message);
		expect(verifyWalletSignature({ message, address, signature: other })).toEqual({
			ok: false,
			reason: 'signature_invalid',
		});
	});

	it('rejects a message that differs by one character', () => {
		const altered = message.replace('recovery', 'recoverY');
		expect(verifyWalletSignature({ message: altered, address, signature }).reason).toBe('signature_invalid');
	});

	it('rejects the message with a trailing newline added', () => {
		expect(verifyWalletSignature({ message: `${message}\n`, address, signature }).reason).toBe(
			'signature_invalid',
		);
	});

	it('rejects a truncated signature as an encoding problem', () => {
		const truncated = b58.encode(b58.decode(signature).slice(0, 63));
		expect(verifyWalletSignature({ message, address, signature: truncated }).reason).toBe(
			'bad_signature_encoding',
		);
	});

	it('reads an all-base58 string as base58 even when it also parses as a 64-byte base64 value', () => {
		// The base58 alphabet is a subset of base64's. This is a 63-byte value in
		// base58 (86 chars) whose characters also happen to decode as exactly 64
		// bytes of base64, which used to slip through the base64 fallback about
		// one truncation in sixteen and come back as a wrong signature instead of
		// a malformed one.
		const ambiguous = 'YhYRQC2pxoHNjWXsSczcFsR6zJt38q4C4LpR1BzVbDLPtYT1bAgmyaNQnzKouWfrxHUbc9U3hHwAdj9pmkU3tQ';
		expect(b58.decode(ambiguous).length).toBe(63);
		expect(Buffer.from(ambiguous, 'base64').length).toBe(64);
		expect(verifyWalletSignature({ message, address, signature: ambiguous }).reason).toBe(
			'bad_signature_encoding',
		);
	});

	it('still accepts a genuine base64 signature', () => {
		const b64 = Buffer.from(b58.decode(signature)).toString('base64');
		expect(verifyWalletSignature({ message, address, signature: b64 }).ok).toBe(true);
	});

	it('rejects garbage that is neither base58 nor base64', () => {
		expect(verifyWalletSignature({ message, address, signature: '%%%not-a-sig%%%' }).reason).toBe(
			'bad_signature_encoding',
		);
	});

	it('rejects a non-base58 address', () => {
		expect(verifyWalletSignature({ message, address: '0OIl' + address.slice(4), signature }).reason).toBe(
			'bad_address',
		);
	});

	it('rejects a 31-byte address', () => {
		const short = b58.encode(kp.publicKey.toBytes().slice(0, 31));
		expect(verifyWalletSignature({ message, address: short, signature }).reason).toBe('bad_address');
	});

	it('never throws on missing or non-string claimant input', () => {
		for (const input of [
			{},
			{ message, address: null, signature },
			{ message, address, signature: 12345 },
			{ message: undefined, address, signature },
		]) {
			expect(() => verifyWalletSignature(input)).not.toThrow();
			expect(verifyWalletSignature(input).ok).toBe(false);
		}
	});
});

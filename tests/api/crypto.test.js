import { describe, it, expect } from 'vitest';
import {
	randomToken,
	sha256,
	sha256Base64Url,
	constantTimeEquals,
	hmacSha256,
} from '../../api/_lib/crypto.js';

describe('randomToken', () => {
	it('returns a base64url string', () => {
		const token = randomToken();
		expect(typeof token).toBe('string');
		expect(token.length).toBeGreaterThan(0);
		expect(token).not.toMatch(/[+/=]/);
	});

	it('uses default 32 bytes (produces ~43 chars)', () => {
		const token = randomToken();
		// 32 bytes base64url = ceil(32 * 4/3) = 43 chars (no padding)
		expect(token.length).toBeGreaterThanOrEqual(42);
	});

	it('produces unique tokens each call', () => {
		const a = randomToken();
		const b = randomToken();
		expect(a).not.toBe(b);
	});

	it('respects custom byte length', () => {
		const short = randomToken(8);
		const long = randomToken(64);
		expect(short.length).toBeLessThan(long.length);
	});
});

describe('sha256', () => {
	it('returns lowercase hex string of length 64', async () => {
		const hash = await sha256('hello');
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it('matches known SHA-256 of "hello"', async () => {
		const hash = await sha256('hello');
		expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
	});

	it('accepts Uint8Array input', async () => {
		const bytes = new TextEncoder().encode('hello');
		const hash = await sha256(bytes);
		expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
	});

	it('produces different hashes for different inputs', async () => {
		const a = await sha256('foo');
		const b = await sha256('bar');
		expect(a).not.toBe(b);
	});
});

describe('sha256Base64Url', () => {
	it('returns base64url string (no +/=)', async () => {
		const hash = await sha256Base64Url('hello');
		expect(hash).not.toMatch(/[+/=]/);
		expect(typeof hash).toBe('string');
	});

	it('is consistent across calls', async () => {
		const a = await sha256Base64Url('test');
		const b = await sha256Base64Url('test');
		expect(a).toBe(b);
	});

	it('differs from hex sha256', async () => {
		const hex = await sha256('hello');
		const b64 = await sha256Base64Url('hello');
		expect(hex).not.toBe(b64);
	});
});

describe('constantTimeEquals', () => {
	it('returns true for identical strings', () => {
		expect(constantTimeEquals('abc', 'abc')).toBe(true);
	});

	it('returns false for different strings of same length', () => {
		expect(constantTimeEquals('abc', 'xyz')).toBe(false);
	});

	it('returns false for different lengths', () => {
		expect(constantTimeEquals('abc', 'ab')).toBe(false);
		expect(constantTimeEquals('ab', 'abc')).toBe(false);
	});

	it('returns true for empty strings', () => {
		expect(constantTimeEquals('', '')).toBe(true);
	});

	it('is case-sensitive', () => {
		expect(constantTimeEquals('ABC', 'abc')).toBe(false);
	});
});

describe('hmacSha256', () => {
	it('returns a base64url string', async () => {
		const sig = await hmacSha256('secret', 'message');
		expect(typeof sig).toBe('string');
		expect(sig).not.toMatch(/[+/=]/);
	});

	it('is deterministic for same inputs', async () => {
		const a = await hmacSha256('secret', 'message');
		const b = await hmacSha256('secret', 'message');
		expect(a).toBe(b);
	});

	it('changes with different secret', async () => {
		const a = await hmacSha256('secret1', 'message');
		const b = await hmacSha256('secret2', 'message');
		expect(a).not.toBe(b);
	});

	it('changes with different message', async () => {
		const a = await hmacSha256('secret', 'msg1');
		const b = await hmacSha256('secret', 'msg2');
		expect(a).not.toBe(b);
	});
});

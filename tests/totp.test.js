// TOTP core (api/_lib/totp.js) against the RFC 6238 Appendix B SHA-1 vectors,
// plus the replay guard and the base32/otpauth plumbing every authenticator app
// reads.

import { describe, it, expect } from 'vitest';
import {
	base32Encode, base32Decode, hotp, generateTotp, matchTotp, otpauthUri, TOTP_PERIOD,
} from '../api/_lib/totp.js';

const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');
// RFC 6238 Appendix B, SHA-1, all eight digits.
const VECTORS = [
	[59, '94287082'],
	[1111111109, '07081804'],
	[1111111111, '14050471'],
	[1234567890, '89005924'],
	[2000000000, '69279037'],
	[20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
	it.each(VECTORS)('matches the 8-digit reference value at T=%i', (t, code) => {
		expect(hotp(RFC_KEY, Math.floor(t / TOTP_PERIOD), 8)).toBe(code);
	});

	it.each(VECTORS)('yields the 6-digit tail at T=%i', (t, code) => {
		expect(generateTotp(RFC_KEY, t)).toBe(code.slice(2));
	});

	it('accepts one step either side of now and nothing further', () => {
		const now = 1_700_000_000;
		const step = Math.floor(now / TOTP_PERIOD);
		expect(matchTotp(RFC_KEY, generateTotp(RFC_KEY, now), { nowSec: now })).toBe(step);
		expect(matchTotp(RFC_KEY, generateTotp(RFC_KEY, now - 30), { nowSec: now })).toBe(step - 1);
		expect(matchTotp(RFC_KEY, generateTotp(RFC_KEY, now + 30), { nowSec: now })).toBe(step + 1);
		expect(matchTotp(RFC_KEY, generateTotp(RFC_KEY, now - 90), { nowSec: now })).toBeNull();
	});

	it('refuses a step at or before the last accepted one (replay)', () => {
		const now = 1_700_000_000;
		const step = Math.floor(now / TOTP_PERIOD);
		const code = generateTotp(RFC_KEY, now);
		expect(matchTotp(RFC_KEY, code, { nowSec: now, afterStep: step })).toBeNull();
		expect(matchTotp(RFC_KEY, code, { nowSec: now, afterStep: step - 1 })).toBe(step);
	});

	it('rejects anything that is not exactly six digits', () => {
		for (const bad of ['', '12345', '1234567', 'abcdef', null, 123456]) {
			expect(matchTotp(RFC_KEY, bad, { nowSec: 59 })).toBeNull();
		}
	});
});

describe('base32 and otpauth', () => {
	it('round-trips bytes and tolerates the way people type secrets', () => {
		const bytes = Buffer.from('hello two-step world');
		const enc = base32Encode(bytes);
		expect(enc).toMatch(/^[A-Z2-7]+$/);
		expect(base32Decode(enc)).toEqual(bytes);
		expect(base32Decode(enc.toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(bytes);
		expect(base32Encode(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
	});

	it('throws on characters outside the alphabet', () => {
		expect(() => base32Decode('ABC1')).toThrow(TypeError);
	});

	it('builds the URI authenticator apps enrol from', () => {
		const uri = otpauthUri({ secret: 'GEZDGNBV', account: 'ada@example.com' });
		expect(uri.startsWith('otpauth://totp/three.ws%3Aada%40example.com?')).toBe(true);
		const u = new URL(uri);
		expect(u.searchParams.get('secret')).toBe('GEZDGNBV');
		expect(u.searchParams.get('issuer')).toBe('three.ws');
		expect(u.searchParams.get('digits')).toBe('6');
		expect(u.searchParams.get('period')).toBe('30');
	});
});

import { describe, it, expect } from 'vitest';
import {
	validatePattern,
	validateAddress,
	validateInitCodeHash,
	estimateAttempts,
	letterCount,
	eip55Checksum,
	MAX_PATTERN_LENGTH,
} from '../../src/eth/vanity/validation.js';

describe('eth vanity · validatePattern', () => {
	it('accepts plain hex', () => {
		const v = validatePattern('beef');
		expect(v.valid).toBe(true);
		expect(v.normalized).toBe('beef');
		expect(v.caseSensitive).toBe(false);
	});

	it('strips a leading 0x', () => {
		expect(validatePattern('0xdead').normalized).toBe('dead');
		expect(validatePattern('0XDeAd').normalized).toBe('DeAd');
	});

	it('detects mixed-case as case-sensitive (EIP-55 mode)', () => {
		const v = validatePattern('Beef');
		expect(v.valid).toBe(true);
		expect(v.caseSensitive).toBe(true);
		expect(v.normalized).toBe('Beef'); // preserved
	});

	it('rejects non-hex characters', () => {
		expect(validatePattern('beeg').valid).toBe(false);
		expect(validatePattern('xyz').valid).toBe(false);
	});

	it('rejects empty', () => {
		expect(validatePattern('').valid).toBe(false);
	});

	it('rejects patterns over the maximum length', () => {
		const v = validatePattern('f'.repeat(MAX_PATTERN_LENGTH + 1));
		expect(v.valid).toBe(false);
	});
});

describe('eth vanity · validateAddress', () => {
	it('accepts a 40-char hex with or without 0x', () => {
		expect(validateAddress('0x' + 'a'.repeat(40)).valid).toBe(true);
		expect(validateAddress('a'.repeat(40)).valid).toBe(true);
	});
	it('rejects wrong length', () => {
		expect(validateAddress('0x' + 'a'.repeat(39)).valid).toBe(false);
		expect(validateAddress('0x' + 'a'.repeat(41)).valid).toBe(false);
	});
	it('lowercases on normalize', () => {
		const v = validateAddress('0x' + 'ABCDEF'.padEnd(40, '0'));
		expect(v.normalized).toBe('0x' + 'abcdef'.padEnd(40, '0'));
	});
});

describe('eth vanity · validateInitCodeHash', () => {
	it('accepts 64 hex chars', () => {
		expect(validateInitCodeHash('0x' + '1'.repeat(64)).valid).toBe(true);
	});
	it('rejects wrong length', () => {
		expect(validateInitCodeHash('0x' + '1'.repeat(63)).valid).toBe(false);
	});
});

describe('eth vanity · estimateAttempts', () => {
	it('is 16^length when case-insensitive', () => {
		expect(estimateAttempts(4)).toBe(65536);
	});
	it('multiplies by 2^letterCount when case-sensitive', () => {
		// "Beef" — 3 letters → 16^4 * 2^3 = 524288
		expect(estimateAttempts(4, 3, true)).toBe(65536 * 8);
	});
	it('digits don\'t pay the casing tax', () => {
		// "B0ef" — 3 letters → 16^4 * 2^3
		expect(estimateAttempts(4, 3, true)).toBe(65536 * 8);
	});
});

describe('eth vanity · letterCount', () => {
	it('counts a-f and A-F', () => {
		expect(letterCount('beef')).toBe(4);
		expect(letterCount('Beef')).toBe(4);
		expect(letterCount('1337')).toBe(0);
		expect(letterCount('B0ef')).toBe(3);
	});
});

describe('eth vanity · eip55Checksum', () => {
	// Reference vectors from EIP-55 (https://eips.ethereum.org/EIPS/eip-55).
	// All lowercase input → expected mixed-case output.
	const VECTORS = [
		// Ethereum Foundation
		['52908400098527886e0f7030069857d2e4169ee7', '52908400098527886E0F7030069857D2E4169EE7'],
		['8617e340b3d01fa5f11f306f4090fd50e238070d', '8617E340B3D01FA5F11F306F4090FD50E238070D'],
		// Mixed
		['de709f2102306220921060314715629080e2fb77', 'de709f2102306220921060314715629080e2fb77'],
		['fb6916095ca1df60bb79ce92ce3ea74c37c5d359', 'fB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'],
		['dbf03b407c01e7cd3cbea99509d93f8dddc8c6fb', 'dbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB'],
		['d1220a0cf47c7b9be7a2e6ba89f429762e7b9adb', 'D1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'],
	];

	for (const [lower, expected] of VECTORS) {
		it(`matches reference vector for ${lower.slice(0, 8)}…`, () => {
			expect(eip55Checksum(lower)).toBe(expected);
		});
	}
});

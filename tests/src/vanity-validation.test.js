import { describe, it, expect } from 'vitest';
import {
	validatePattern,
	estimateAttempts,
	formatTimeEstimate,
	BASE58_ALPHABET,
	MAX_PATTERN_LENGTH,
} from '../../src/solana/vanity/validation.js';

describe('vanity validation', () => {
	it('accepts valid base58 prefixes', () => {
		expect(validatePattern('AGNT').valid).toBe(true);
		expect(validatePattern('So').valid).toBe(true);
		expect(validatePattern('123').valid).toBe(true);
	});

	it('rejects empty string', () => {
		expect(validatePattern('').valid).toBe(false);
	});

	it('rejects each confused character with a hint', () => {
		for (const c of ['0', 'O', 'I', 'l']) {
			const r = validatePattern(c);
			expect(r.valid).toBe(false);
			expect(r.errors.join(' ')).toMatch(c);
		}
	});

	it('rejects patterns longer than the maximum', () => {
		const tooLong = 'A'.repeat(MAX_PATTERN_LENGTH + 1);
		expect(validatePattern(tooLong).valid).toBe(false);
	});

	it('rejects whitespace', () => {
		expect(validatePattern(' AB').valid).toBe(false);
		expect(validatePattern('AB ').valid).toBe(false);
	});

	it('alphabet excludes confused chars', () => {
		expect(BASE58_ALPHABET).not.toMatch(/[0OIl]/);
		expect(BASE58_ALPHABET.length).toBe(58);
	});
});

describe('estimateAttempts', () => {
	it('returns 58^length', () => {
		expect(estimateAttempts(1)).toBe(58);
		expect(estimateAttempts(2)).toBe(58 * 58);
		expect(estimateAttempts(4)).toBe(Math.pow(58, 4));
	});
});

describe('formatTimeEstimate', () => {
	it('returns unknown for zero rate', () => {
		expect(formatTimeEstimate(1000, 0)).toBe('unknown');
	});
	it('formats sub-second', () => {
		expect(formatTimeEstimate(10, 1000)).toBe('less than a second');
	});
	it('formats seconds/minutes/hours/days/years', () => {
		expect(formatTimeEstimate(30, 1)).toMatch(/seconds/);
		expect(formatTimeEstimate(300, 1)).toMatch(/minutes/);
		expect(formatTimeEstimate(7200, 1)).toMatch(/hours/);
		expect(formatTimeEstimate(86400 * 3, 1)).toMatch(/days/);
		expect(formatTimeEstimate(31536000 * 2, 1)).toMatch(/years/);
	});
});

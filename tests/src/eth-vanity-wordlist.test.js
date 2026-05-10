import { describe, it, expect } from 'vitest';
import { leetToHex, suggestPrefixFromName, PRESET_CHIPS } from '../../src/eth/vanity/wordlist.js';

describe('eth vanity · wordlist', () => {
	it('all preset chips are valid hex', () => {
		for (const w of PRESET_CHIPS) {
			expect(w).toMatch(/^[0-9a-fA-F]+$/);
		}
	});
});

describe('eth vanity · leetToHex', () => {
	it('passes through pure hex unchanged', () => {
		expect(leetToHex('beef')).toBe('beef');
		expect(leetToHex('CAFE')).toBe('CAFE');
		expect(leetToHex('1337')).toBe('1337');
	});

	it('substitutes l/i/o/s/t/z/g/y to digits', () => {
		expect(leetToHex('alice')).toBe('a11ce');
		expect(leetToHex('lost')).toBe('1057');
		expect(leetToHex('ozzy')).toBe('0221');
	});

	it('preserves case so EIP-55 mode kicks in', () => {
		// 'Alice' has uppercase A → should keep that case
		expect(leetToHex('Alice')).toBe('A11ce');
	});

	it('returns null for unmappable text', () => {
		// "wrx" — w/r/x have no leet mapping
		expect(leetToHex('wrx')).toBe(null);
	});

	it('strips non-alphanumerics before mapping', () => {
		expect(leetToHex('be-ef')).toBe('beef');
		expect(leetToHex('  cafe  ')).toBe('cafe');
	});
});

describe('eth vanity · suggestPrefixFromName', () => {
	it('returns truncated leet for a workable name', () => {
		expect(suggestPrefixFromName('Alice')).toBe('A11ce');
		expect(suggestPrefixFromName('decaf')).toBe('decaf');
	});
	it('returns null for too-short or unmappable names', () => {
		expect(suggestPrefixFromName('')).toBe(null);
		expect(suggestPrefixFromName('wx')).toBe(null);
	});
});

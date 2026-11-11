/**
 * Tag normalization for Florence-2 creation tags (work order 819).
 *
 * The worker (workers/model-florence2/tags.py) and the API normalize tags with
 * the same rules, so a tag the model produced, a tag an owner typed and a word
 * a searcher typed all land on one canonical form. These cases mirror
 * workers/model-florence2/test_tags.py.
 */
import { describe, it, expect } from 'vitest';
import { normalizeTag, normalizeTags, tagQueryVariants, MAX_TAGS } from '../api/_lib/creation-tags.js';

// Built from char codes so the slur never appears as a literal in the repo
// (same convention as tests/display-name-safety.test.js).
const SLUR = String.fromCharCode(110, 105, 103, 103, 101, 114);

describe('normalizeTag', () => {
	it('lowercases and folds accents', () => {
		expect(normalizeTag('  Café Table ')).toBe('cafe table');
	});

	it('strips a leading article, punctuation and underscores', () => {
		expect(normalizeTag('The brass_lantern!')).toBe('brass lantern');
		expect(normalizeTag('a sci-fi helmet')).toBe('sci-fi helmet');
		expect(normalizeTag('--low-poly--')).toBe('low-poly');
	});

	it('rejects generic, numeric, too short, too long and non-string input', () => {
		expect(normalizeTag('background')).toBe('');
		expect(normalizeTag('Image')).toBe('');
		expect(normalizeTag('1234')).toBe('');
		expect(normalizeTag('x')).toBe('');
		expect(normalizeTag('one two three four')).toBe('');
		expect(normalizeTag('a'.repeat(40))).toBe('');
		expect(normalizeTag(null)).toBe('');
		expect(normalizeTag(42)).toBe('');
	});

	it('drops a tag that carries a slur from the shared blocklist', () => {
		expect(normalizeTag(SLUR)).toBe('');
		expect(normalizeTags(['lamp', `${SLUR} lamp`])).toEqual(['lamp']);
	});
});

describe('normalizeTags', () => {
	it('dedupes case and simple plurals, keeping the first spelling', () => {
		expect(normalizeTags(['Sword', 'swords', 'SWORD', 'shield'])).toEqual(['sword', 'shield']);
	});

	it('does not merge a word that only ends in ss', () => {
		expect(normalizeTags(['glass', 'glas'])).toEqual(['glass', 'glas']);
	});

	it('caps the list and ignores junk entries', () => {
		const many = Array.from({ length: 30 }, (_, i) => `tag${i}x`);
		expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
		expect(normalizeTags(many, { limit: 3 })).toEqual(['tag0x', 'tag1x', 'tag2x']);
		expect(normalizeTags('lamp')).toEqual([]);
		expect(normalizeTags([null, '', 'the', 'lamp'])).toEqual(['lamp']);
	});
});

describe('tagQueryVariants', () => {
	it('returns the canonical tag plus its singular and plural', () => {
		expect(tagQueryVariants('Lanterns')).toEqual(['lanterns', 'lantern']);
		expect(tagQueryVariants('lantern')).toEqual(['lantern', 'lanterns']);
	});

	it('returns nothing for a query that is not a valid tag', () => {
		expect(tagQueryVariants('background')).toEqual([]);
		expect(tagQueryVariants('')).toEqual([]);
	});
});

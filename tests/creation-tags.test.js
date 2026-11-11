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

	// Seen in the first 300 real Florence-2 results: the lemmatizer cuts
	// plural-only nouns ("sunglasses" -> "sunglass"), bare colours and body parts
	// show up on nearly every poster, and a watermark gets read as a tag.
	it('restores plural-only nouns the lemmatizer cut, on the last word', () => {
		expect(normalizeTag('sunglass')).toBe('sunglasses');
		expect(normalizeTag('goggle')).toBe('goggles');
		expect(normalizeTag('trouser')).toBe('trousers');
		expect(normalizeTag('black sunglass')).toBe('black sunglasses');
		expect(normalizeTag('leave')).toBe('leaf');
	});

	it('rejects bare colours, body parts and watermark text', () => {
		for (const t of ['red', 'purple', 'eye', 'hair', 'hand', 'human face', 'human head', 'finger', 'watermark', 'pollination ai', 'logo', 'line', 'opening', 'four', 'two']) {
			expect(normalizeTag(t), t).toBe('');
		}
		expect(normalizeTag('red car')).toBe('red car');
		expect(normalizeTag('human hand')).toBe('human hand');
	});

	it('rejects a phrase whose head noun is a generic picture word', () => {
		for (const t of ['violet color', '3d rendering', 'plastic object', 'silver top', 'gray background']) {
			expect(normalizeTag(t), t).toBe('');
		}
		expect(normalizeTag('desk lamp')).toBe('desk lamp');
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

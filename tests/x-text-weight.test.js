import { describe, it, expect } from 'vitest';
import { weightedLength, chunkForX, fitsInPost, findUrls, X_POST_MAX_WEIGHT } from '../api/_lib/x-text-weight.js';

describe('weightedLength', () => {
	it('counts Latin text at 1 per character', () => {
		expect(weightedLength('hello world')).toBe(11);
	});
	it('counts CJK at 2 per character', () => {
		expect(weightedLength('日本語')).toBe(6);
		expect(weightedLength('한국어')).toBe(6);
	});
	it('counts a URL as 23 whatever its length, keeping trailing sentence punctuation out of it', () => {
		const url = 'https://three.ws/a/very/long/path/that/goes/on?and=on&on=1';
		expect(weightedLength(url)).toBe(23);
		expect(weightedLength(`see ${url}.`)).toBe(4 + 23 + 1);
	});
	it('counts an emoji sequence as 2, a ZWJ family included', () => {
		expect(weightedLength('hi 👨‍👩‍👧')).toBe(3 + 2);
		expect(weightedLength('🇺🇸')).toBe(2);
		expect(weightedLength('👍🏽')).toBe(2);
	});
	it('is 0 for empty input', () => {
		expect(weightedLength('')).toBe(0);
		expect(weightedLength(null)).toBe(0);
	});
	it('does not use string length: 140 CJK characters fill a post', () => {
		expect(fitsInPost('日'.repeat(140))).toBe(true);
		expect(fitsInPost('日'.repeat(141))).toBe(false);
		expect('日'.repeat(141).length).toBeLessThan(280);
	});
	it('finds URL spans', () => {
		expect(findUrls('a https://x.co/b, c')).toEqual([{ start: 2, end: 16 }]);
	});
});

describe('chunkForX', () => {
	it('returns one part when it fits', () => {
		expect(chunkForX('short reply')).toEqual(['short reply']);
	});
	it('splits at a paragraph boundary into two parts that each fit', () => {
		const a = 'a'.repeat(200);
		const b = 'b'.repeat(200);
		const parts = chunkForX(`${a}\n\n${b}`);
		expect(parts).toEqual([a, b]);
	});
	it('never yields more than two parts and ends a truncated chain with an ellipsis within weight', () => {
		const parts = chunkForX('word '.repeat(400));
		expect(parts).toHaveLength(2);
		for (const p of parts) expect(weightedLength(p)).toBeLessThanOrEqual(X_POST_MAX_WEIGHT);
		expect(parts[1].endsWith('...')).toBe(true);
	});
	it('weighs CJK by two when chunking', () => {
		const parts = chunkForX('日'.repeat(200));
		expect(parts).toHaveLength(2);
		for (const p of parts) expect(weightedLength(p)).toBeLessThanOrEqual(X_POST_MAX_WEIGHT);
	});
	it('never cuts a URL in half', () => {
		const url = 'https://three.ws/c/' + 'z'.repeat(80);
		const parts = chunkForX(`${'x'.repeat(255)} ${url} tail`);
		expect(parts.join(' ')).toContain(url);
		for (const p of parts) expect(weightedLength(p)).toBeLessThanOrEqual(X_POST_MAX_WEIGHT);
	});
	it('honors maxParts of 1', () => {
		expect(chunkForX('word '.repeat(200), { maxParts: 1 })).toHaveLength(1);
	});
	it('returns [] for blank input', () => {
		expect(chunkForX('   ')).toEqual([]);
	});
});

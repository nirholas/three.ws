// X's weighted-length rule (api/_lib/gateway/x-text-weight.js), reimplemented
// from the documented config (scale 100, default weight 200, Latin-ish
// ranges weighted 100, any http(s) URL fixed at 23) rather than depending on
// the unmaintained `twitter-text` package. See the module header for why.

import { describe, it, expect } from 'vitest';
import { weightedLength, fitsInTweet, sliceToWeight, chunkForX, MAX_WEIGHTED_LENGTH, TRANSFORMED_URL_LENGTH } from '../api/_lib/gateway/x-text-weight.js';

describe('weightedLength', () => {
	it('counts plain ASCII as 1 per character', () => {
		expect(weightedLength('hello world')).toBe(11);
	});

	it('counts Latin accents and Cyrillic/Hebrew/Arabic as 1 per character', () => {
		expect(weightedLength('café')).toBe(4);
		expect(weightedLength('привет')).toBe(6);
		expect(weightedLength('שלום')).toBe(4);
	});

	it('counts CJK ideographs as 2 per character', () => {
		expect(weightedLength('你好')).toBe(4);
		expect(weightedLength('こんにちは')).toBe(10);
	});

	it('counts an emoji (outside the Basic Multilingual Plane) as 2', () => {
		expect(weightedLength('🚀')).toBe(2);
	});

	it('counts any http(s) URL as exactly 23 regardless of its real length', () => {
		const short = weightedLength('see https://x.co');
		const long = weightedLength('see https://example.com/a/very/long/path/that/keeps/going?x=1&y=2');
		expect(short).toBe('see '.length + TRANSFORMED_URL_LENGTH);
		expect(long).toBe('see '.length + TRANSFORMED_URL_LENGTH);
	});

	it('counts multiple URLs independently', () => {
		const text = 'https://a.example/one and https://b.example/two';
		expect(weightedLength(text)).toBe(TRANSFORMED_URL_LENGTH + ' and '.length + TRANSFORMED_URL_LENGTH);
	});

	it('treats null/undefined/empty as zero', () => {
		expect(weightedLength('')).toBe(0);
		expect(weightedLength(null)).toBe(0);
		expect(weightedLength(undefined)).toBe(0);
	});
});

describe('fitsInTweet', () => {
	it('accepts exactly 280 and rejects 281', () => {
		expect(fitsInTweet('a'.repeat(280))).toBe(true);
		expect(fitsInTweet('a'.repeat(281))).toBe(false);
	});

	it('a CJK string hits the cap at half the codepoint count', () => {
		expect(fitsInTweet('你'.repeat(140))).toBe(true);
		expect(fitsInTweet('你'.repeat(141))).toBe(false);
	});
});

describe('sliceToWeight', () => {
	it('returns the whole string when it already fits', () => {
		expect(sliceToWeight('short', 280)).toBe('short');
	});

	it('breaks on a word boundary near the limit', () => {
		const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
		const cut = sliceToWeight(words, 30);
		expect(weightedLength(cut)).toBeLessThanOrEqual(30);
		expect(words.startsWith(cut)).toBe(true);
		expect(cut.endsWith(' ')).toBe(false);
	});

	it('never splits a surrogate pair', () => {
		const text = '🚀'.repeat(20);
		const cut = sliceToWeight(text, 7);
		expect(weightedLength(cut)).toBeLessThanOrEqual(7);
		expect([...cut].every((ch) => [...ch].length === 1)).toBe(true);
	});
});

describe('chunkForX', () => {
	it('returns one chunk for short text', () => {
		expect(chunkForX('hello there')).toEqual(['hello there']);
	});

	it('returns an empty array for blank input', () => {
		expect(chunkForX('')).toEqual([]);
		expect(chunkForX('   ')).toEqual([]);
	});

	it('splits text that needs two posts', () => {
		const text = `${'a'.repeat(300)} ${'b'.repeat(100)}`;
		const chunks = chunkForX(text);
		expect(chunks).toHaveLength(2);
		for (const c of chunks) expect(fitsInTweet(c)).toBe(true);
	});

	it('never yields a third part: a huge reply is truncated into exactly two', () => {
		const text = Array.from({ length: 30 }, (_, i) => `sentence number ${i} keeps going on and on.`).join(' ');
		const chunks = chunkForX(text);
		expect(chunks.length).toBeLessThanOrEqual(2);
		for (const c of chunks) expect(fitsInTweet(c)).toBe(true);
		expect(chunks[1].endsWith('...')).toBe(true);
	});
});

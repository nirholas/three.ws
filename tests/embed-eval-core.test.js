import { describe, it, expect } from 'vitest';
import {
	slugify,
	splitSections,
	chunkSection,
	reduceDim,
	normalize,
	rankIds,
	recallAt,
	ndcgAt,
	percentile,
} from '../scripts/lib/embed-eval-core.mjs';

describe('splitSections', () => {
	const md = [
		'intro before any heading',
		'# Agent wallets',
		'Lead paragraph.',
		'## Key custody',
		'Encrypted with `AES-256-GCM`.',
		'```bash',
		'# not a heading, a shell comment',
		'```',
		'## Related',
		'one',
		'### Related',
		'two',
	].join('\n');

	it('ids sections by GitHub-style slug, ignores fenced code and dedupes repeats', () => {
		const ids = splitSections('docs/agent-wallets.md', md).map((s) => s.id);
		expect(ids).toEqual([
			'docs/agent-wallets.md#agent-wallets',
			'docs/agent-wallets.md#key-custody',
			'docs/agent-wallets.md#related',
			'docs/agent-wallets.md#related-1',
		]);
	});

	it('prefixes the document title and keeps code blocks in the body', () => {
		const custody = splitSections('d.md', md)[1];
		expect(custody.text.startsWith('Agent wallets > Key custody\n')).toBe(true);
		expect(custody.text).toContain('# not a heading');
	});

	it('slugifies punctuation away the way GitHub anchors do', () => {
		expect(slugify('The program and client (primary sources)')).toBe('the-program-and-client-primary-sources');
		expect(slugify('Quote, then confirm')).toBe('quote-then-confirm');
		expect(slugify('API (session auth, CSRF on mutations)')).toBe('api-session-auth-csrf-on-mutations');
	});
});

describe('chunkSection', () => {
	it('keeps a short section whole', () => {
		expect(chunkSection({ text: 'H\nshort' }, 100)).toEqual(['H\nshort']);
	});

	it('splits a long section under the budget and repeats the heading on every piece', () => {
		const body = Array.from({ length: 20 }, (_, i) => `paragraph ${i} `.repeat(10)).join('\n\n');
		const parts = chunkSection({ text: `Title > Heading\n${body}` }, 400);
		expect(parts.length).toBeGreaterThan(1);
		for (const p of parts) {
			expect(p.length).toBeLessThanOrEqual(400);
			expect(p.startsWith('Title > Heading\n')).toBe(true);
		}
		expect(parts.join(' ')).toContain('paragraph 19');
	});
});

describe('vector helpers', () => {
	it('reduceDim truncates and renormalizes to unit length', () => {
		const v = reduceDim(Float32Array.from([3, 4, 12]), 2);
		expect(Array.from(v)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6)]);
		expect(Math.hypot(...normalize(Float32Array.from([1, 2, 2])))).toBeCloseTo(1, 6);
	});

	it('rankIds keeps the best passage per id and refuses a dimension mismatch', () => {
		const docs = [[1, 0], [0, 1], [0.9, 0.1]].map((v) => normalize(Float32Array.from(v)));
		expect(rankIds(normalize(Float32Array.from([1, 0])), docs, ['a', 'b', 'a'], 10)).toEqual(['a', 'b']);
		expect(() => rankIds(Float32Array.from([1, 0, 0]), docs, ['a', 'b', 'a'], 10)).toThrow(/dimension mismatch/);
	});
});

describe('IR metrics', () => {
	it('recall@k is the share of relevant ids in the top k', () => {
		expect(recallAt(['x', 'a', 'y', 'b'], { a: 1, b: 1 }, 2)).toBe(0.5);
		expect(recallAt(['x', 'a', 'y', 'b'], { a: 1, b: 1 }, 4)).toBe(1);
		expect(recallAt(['x'], { a: 0 }, 4)).toBe(0);
	});

	it('nDCG@10 is 1 for the ideal order and uses graded gains', () => {
		expect(ndcgAt(['a', 'b'], { a: 2, b: 1 }, 10)).toBeCloseTo(1, 10);
		const swapped = ndcgAt(['b', 'a'], { a: 2, b: 1 }, 10);
		const expected = (1 + 3 / Math.log2(3)) / (3 + 1 / Math.log2(3));
		expect(swapped).toBeCloseTo(expected, 10);
		expect(ndcgAt(['z'], { a: 1 }, 10)).toBe(0);
	});

	it('percentile uses nearest rank', () => {
		expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
		expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
		expect(percentile([], 50)).toBeNull();
	});
});

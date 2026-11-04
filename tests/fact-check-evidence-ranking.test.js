import { describe, it, expect } from 'vitest';
import { rankEvidence, sourceTier } from '../agents/fact-checker/src/search-sources.js';

const NOW = Date.parse('2026-11-04T00:00:00Z');

const blog = {
	url: 'https://someone.medium.com/why-the-moon-landing-was-staged-2b1f',
	title: 'Why I still do not trust the Moon landing',
	snippet: 'An opinion piece about the Apollo missions.',
};
const nasa = {
	url: 'https://www.nasa.gov/mission/apollo-11/',
	title: 'Apollo 11 | NASA',
	snippet: 'Apollo 11 landed the first humans on the Moon on July 20, 1969.',
};
const wiki = {
	url: 'https://en.wikipedia.org/wiki/Apollo_11',
	title: 'Apollo 11 - Wikipedia',
	snippet: 'Apollo 11 was the American spaceflight that first landed humans on the Moon.',
};

describe('sourceTier', () => {
	it('classifies by registrable domain and TLD, with subdomains', () => {
		expect(sourceTier('https://www.nasa.gov/x').name).toBe('primary');
		expect(sourceTier('https://data.cityname.gov.uk/x').name).toBe('primary');
		expect(sourceTier('https://someone.medium.com/p').name).toBe('blog_social');
		expect(sourceTier('https://en.wikipedia.org/wiki/A').name).toBe('encyclopedia');
		expect(sourceTier('https://example-shop.com/p').name).toBe('reference_other');
		expect(sourceTier('not a url').name).toBe('reference_other');
	});
	it('does not match look-alike suffixes', () => {
		expect(sourceTier('https://notnasa.gov.evil.com/').name).toBe('reference_other');
		expect(sourceTier('https://fakenature.com/').name).toBe('reference_other');
	});
});

describe('rankEvidence', () => {
	it('ranks a primary source above a blog even when the blog came first', () => {
		const out = rankEvidence([blog, wiki, nasa], { now: NOW });
		expect(out[0].url).toBe(nasa.url);
		expect(out[out.length - 1].url).toBe(blog.url);
	});
	it('keeps one passage per domain, the best one', () => {
		const dup = { ...nasa, url: 'https://www.nasa.gov/other', snippet: 'short' };
		const out = rankEvidence([dup, nasa, wiki], { now: NOW });
		expect(out.filter((p) => p.url.includes('nasa.gov'))).toHaveLength(1);
	});
	it('prefers the newer passage for a time-bound claim, not otherwise', () => {
		const old = { url: 'https://www.reuters.com/a', title: 'Old', snippet: 'x', publishedAt: '2019-01-01' };
		const fresh = { url: 'https://www.bbc.com/b', title: 'Fresh', snippet: 'x', publishedAt: '2026-10-30' };
		expect(rankEvidence([old, fresh], { now: NOW, timeBound: true })[0].url).toBe(fresh.url);
		const neutral = rankEvidence([old, fresh], { now: NOW, timeBound: false });
		expect(neutral[0].url).toBe(old.url);
	});
	it('is stable for equal scores, preserving input order', () => {
		const a = { url: 'https://a-shop.com/1', title: 'a', snippet: 'a' };
		const b = { url: 'https://b-shop.com/1', title: 'b', snippet: 'b' };
		expect(rankEvidence([a, b], { now: NOW }).map((p) => p.url)).toEqual([a.url, b.url]);
	});
	it('annotates tier and does not mutate input', () => {
		const input = [blog, nasa];
		const out = rankEvidence(input, { now: NOW });
		expect(input[0]).toBe(blog);
		expect(out[0].tier).toBe('primary');
	});
});

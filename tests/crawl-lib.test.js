// The Crawl: boundary rules shared by the API and the worker (api/_lib/crawl.js).
import { describe, expect, it } from 'vitest';
import {
	MAX_LINKS, MAX_SEEDS, MAX_TEXT_CHARS, domainOf, estimateTokens, isFrameB64, isPrivateHostname, normalizeUrl,
	pageMemory, sanitizeLinkRect, sanitizePage, sanitizeStep, urlHash, validateMission,
} from '../api/_lib/crawl.js';

describe('normalizeUrl', () => {
	it('strips fragments, tracking tags, default ports and trailing slashes', () => {
		expect(normalizeUrl('https://Example.com:443/a/b/?utm_source=x&b=2&a=1#top')).toBe('https://example.com/a/b?a=1&b=2');
		expect(normalizeUrl('http://example.com:80/')).toBe('http://example.com/');
		expect(normalizeUrl('https://example.com/p?fbclid=1&gclid=2')).toBe('https://example.com/p');
	});

	it('refuses non-web schemes and embedded credentials', () => {
		expect(normalizeUrl('javascript:alert(1)')).toBeNull();
		expect(normalizeUrl('ftp://example.com/x')).toBeNull();
		expect(normalizeUrl('https://user:pass@example.com/')).toBeNull();
		expect(normalizeUrl('not a url')).toBeNull();
	});

	it('keys the same page identically however it was linked', () => {
		const a = urlHash(normalizeUrl('https://example.com/post/?utm_medium=feed'));
		const b = urlHash(normalizeUrl('https://EXAMPLE.com/post#comments'));
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('small helpers', () => {
	it('domainOf drops www and lowercases', () => {
		expect(domainOf('https://WWW.Example.org/x')).toBe('example.org');
		expect(domainOf('nope')).toBe('');
	});

	it('estimateTokens is four characters a token, rounded up', () => {
		expect(estimateTokens('')).toBe(0);
		expect(estimateTokens('abcde')).toBe(2);
	});

	it('pageMemory names the page, the topic and the gist', () => {
		const m = pageMemory({ title: 'Spiders', url: 'https://e.com/s', gist: 'They spin.' }, 'arachnids');
		expect(m).toBe('Read "Spiders" (https://e.com/s) while crawling for arachnids: They spin.');
	});
});

describe('sanitizeLinkRect', () => {
	it('keeps a well-formed rect and clips it to the viewport', () => {
		expect(sanitizeLinkRect({ x: 0.9, y: 0.5, w: 0.3, h: 0.05, t: '  Read   more ' })).toEqual({ x: 0.9, y: 0.5, w: expect.closeTo(0.1, 10), h: 0.05, t: 'Read more' });
	});

	it('drops degenerate or malformed rects', () => {
		expect(sanitizeLinkRect({ x: 0.2, y: 0.2, w: 0, h: 0.1 })).toBeNull();
		expect(sanitizeLinkRect({ x: 'a', y: 0, w: 0.1, h: 0.1 })).toBeNull();
		expect(sanitizeLinkRect({ x: 1, y: 0.5, w: 0.1, h: 0.1 })).toBeNull();
		expect(sanitizeLinkRect(null)).toBeNull();
	});
});

describe('sanitizeStep', () => {
	const link = { x: 0.1, y: 0.2, w: 0.2, h: 0.03, t: 'Next' };

	it('keeps target and nextUrl only when they point at a real link', () => {
		const s = sanitizeStep({ url: 'https://e.com/a', status: 'walking', links: [link], target: 0, nextUrl: 'https://e.com/b#x', seq: 7 });
		expect(s.target).toBe(0);
		expect(s.nextUrl).toBe('https://e.com/b');
		expect(s.domain).toBe('e.com');
		expect(s.seq).toBe(7);

		const bad = sanitizeStep({ url: 'https://e.com/a', links: [link], target: 3, nextUrl: 'https://e.com/b' });
		expect(bad.target).toBeNull();
		expect(bad.nextUrl).toBeNull();
	});

	it('bounds the link list, coerces unknown statuses, and clamps scroll', () => {
		const many = Array.from({ length: MAX_LINKS + 20 }, () => link);
		const s = sanitizeStep({ url: 'https://e.com', links: many, status: 'dancing', scrollY: 4, seq: -1 });
		expect(s.links).toHaveLength(MAX_LINKS);
		expect(s.status).toBe('reading');
		expect(s.scrollY).toBe(1);
		expect(s.seq).toBe(0);
	});

	it('rejects a missing step', () => {
		expect(sanitizeStep(null)).toBeNull();
	});
});

describe('sanitizePage', () => {
	it('bounds text and derives hash, domain and tokens', () => {
		const p = sanitizePage({ url: 'https://www.e.com/x/', title: 't', text: 'a'.repeat(MAX_TEXT_CHARS + 50), relevance: 3, linksOut: -2 });
		expect(p.url).toBe('https://www.e.com/x');
		expect(p.domain).toBe('e.com');
		expect(p.text).toHaveLength(MAX_TEXT_CHARS);
		expect(p.tokens).toBe(MAX_TEXT_CHARS / 4);
		expect(p.relevance).toBe(1);
		expect(p.linksOut).toBe(0);
		expect(p.hash).toBe(urlHash(p.url));
	});

	it('refuses a page with no usable URL', () => {
		expect(sanitizePage({ url: 'mailto:x@y.z' })).toBeNull();
	});
});

describe('isFrameB64', () => {
	it('accepts JPEG base64 only', () => {
		const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]).toString('base64');
		expect(isFrameB64(jpeg)).toBe(true);
		const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100, 7)]).toString('base64');
		expect(isFrameB64(png)).toBe(false);
		expect(isFrameB64('/9j/<script>')).toBe(false);
	});
});

describe('validateMission', () => {
	it('accepts a topic with seeds as a list or a pasted string', () => {
		expect(validateMission({ topic: 'solana validators', seeds: 'docs.solana.com, https://solana.com/news' })).toEqual({
			topic: 'solana validators', seeds: ['https://docs.solana.com/', 'https://solana.com/news'], enabled: true,
		});
		expect(validateMission({ topic: 'x'.repeat(10), seeds: [], enabled: false }).enabled).toBe(false);
	});

	it('rejects bad topics, private hosts and too many seeds', () => {
		expect(validateMission({ topic: 'a' }).error).toMatch(/topic/);
		expect(validateMission({ topic: 'x'.repeat(121) }).error).toMatch(/topic/);
		expect(validateMission({ topic: 'ok topic', seeds: ['http://127.0.0.1/admin'] }).error).toMatch(/public/);
		expect(validateMission({ topic: 'ok topic', seeds: ['http://metadata.google.internal/'] }).error).toMatch(/public/);
		const seeds = Array.from({ length: MAX_SEEDS + 1 }, (_, i) => `https://e${i}.com`);
		expect(validateMission({ topic: 'ok topic', seeds }).error).toMatch(/at most/);
	});
});

describe('isPrivateHostname', () => {
	it.each([
		'localhost', 'app.localhost', 'printer.local', 'db.internal', 'metadata', '10.1.2.3', '127.0.0.1', '169.254.169.254',
		'172.20.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '[::1]', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'intranet',
	])('treats %s as private', (h) => expect(isPrivateHostname(h)).toBe(true));

	it.each(['example.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])('treats %s as public', (h) => {
		expect(isPrivateHostname(h)).toBe(false);
	});
});

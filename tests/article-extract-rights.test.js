// Rights limits on the article reader's fetch ladder: it identifies itself
// honestly, never touches a withdrawn publisher's host, honors robots.txt and
// the page's own noarchive/nosnippet request, and has no third-party proxy rung
// (no reader service, no web archive) that could route around a publisher's "no".

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pinned = vi.fn();
vi.mock('../api/_lib/ssrf-guard.js', () => ({
	fetchSafePublicUrlPinned: (...a) => pinned(...a),
	assertSafePublicUrl: async (u) => new URL(u),
}));
vi.mock('../api/_lib/article-lanes.js', () => ({
	fetchPrimaryFiling: async () => ({ paragraphs: [], filing: null }),
	fetchSiblings: async () => ({ paragraphs: [], siblings: [] }),
}));

const { extractArticle, resetRobotsCache } = await import('../api/_lib/article-extract.js');

const PROSE = Array.from(
	{ length: 4 },
	(_, i) => `<p>Paragraph ${i + 1} of the story, long enough to count as real prose for the extractor.</p>`,
).join('');
const page = (head = '') => `<html><head>${head}<title>Story</title></head><body><article>${PROSE}</article></body></html>`;
const htmlResponse = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

function route({ robots = null, html = page() } = {}) {
	pinned.mockImplementation(async (url) => {
		if (String(url).endsWith('/robots.txt')) {
			return robots === null ? new Response('', { status: 404 }) : new Response(robots, { status: 200, headers: { 'content-type': 'text/plain' } });
		}
		return htmlResponse(html);
	});
}
const articleCalls = () => pinned.mock.calls.filter((c) => !String(c[0]).endsWith('/robots.txt'));

beforeEach(() => {
	pinned.mockReset();
	resetRobotsCache();
});

describe('article reader fetch rights', () => {
	it('reads an allowed page and identifies itself as three.ws, not as a browser', async () => {
		route();
		const out = await extractArticle('https://publisher.example/story');
		expect(out.extraction).toBe('page');
		const ua = articleCalls()[0][1].headers['user-agent'];
		expect(ua).toMatch(/three\.ws/);
		expect(ua).not.toMatch(/Chrome|Windows NT/);
	});

	it('never fetches a restricted publisher host', async () => {
		route();
		const out = await extractArticle('https://www.ft.com/content/abc');
		expect(out.extraction).toBe('preview');
		expect(out.blocked_reason).toMatch(/not available/i);
		expect(pinned).not.toHaveBeenCalled();
	});

	it('refuses a page robots.txt disallows for automated readers', async () => {
		route({ robots: 'User-agent: *\nDisallow: /story\n' });
		const out = await extractArticle('https://publisher.example/story');
		expect(out.extraction).toBe('preview');
		expect(out.blocked_reason).toMatch(/robots/i);
		expect(articleCalls()).toHaveLength(0);
	});

	it('honors a group that names three.ws-news, and the longest matching rule', async () => {
		route({ robots: 'User-agent: *\nDisallow: /\n\nUser-agent: three.ws-news\nDisallow: /private/\nAllow: /private/open\n' });
		expect((await extractArticle('https://publisher.example/story')).extraction).toBe('page');
		expect((await extractArticle('https://publisher.example/private/x')).extraction).toBe('preview');
		expect((await extractArticle('https://publisher.example/private/open')).extraction).toBe('page');
	});

	it('treats an unreachable robots.txt (5xx) as a full disallow and a 404 as allow', async () => {
		pinned.mockImplementation(async (url) => (String(url).endsWith('/robots.txt') ? new Response('', { status: 503 }) : htmlResponse(page())));
		expect((await extractArticle('https://publisher.example/story')).extraction).toBe('preview');
		resetRobotsCache();
		route({ robots: null });
		expect((await extractArticle('https://publisher.example/story')).extraction).toBe('page');
	});

	it('reads robots.txt once per host', async () => {
		route({ robots: 'User-agent: *\nAllow: /\n' });
		await extractArticle('https://publisher.example/a');
		await extractArticle('https://publisher.example/b');
		expect(pinned.mock.calls.filter((c) => String(c[0]).endsWith('/robots.txt'))).toHaveLength(1);
	});

	it.each(['noarchive', 'nosnippet'])('keeps nothing from a page that says %s', async (directive) => {
		route({ html: page(`<meta name="robots" content="index, ${directive}">`) });
		const out = await extractArticle('https://publisher.example/story');
		expect(out.extraction).toBe('preview');
		expect(out.paragraphs).toEqual([]);
		expect(out.html).toBeNull();
		expect(out.blocked_reason).toMatch(/archiv|snippet/i);
	});

	it('does not call a reader service or the web archive when the page is blocked', async () => {
		pinned.mockImplementation(async (url) => (String(url).endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response('no', { status: 403 })));
		const out = await extractArticle('https://publisher.example/story');
		expect(out.extraction).toBe('preview');
		const hosts = pinned.mock.calls.map((c) => new URL(String(c[0])).hostname);
		expect(hosts.every((h) => h === 'publisher.example')).toBe(true);
	});
});

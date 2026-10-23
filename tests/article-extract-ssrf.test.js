// Regression guard for the 2026-07-23 security audit fix in
// api/_lib/article-extract.js. The public /api/news/article?url= endpoint
// fetches a fully caller-controlled URL; the extractor used to guard it with
// a local check that validated only the FIRST DNS answer, pinned nothing, and
// followed redirects without re-validating any hop, so a public host could
// 302 the server into 169.254.169.254 or another internal address and the
// response text flowed back to the caller (and into the news knowledge base).
//
// Both fetch rungs must now go through the platform pinned guard
// (fetchSafePublicUrlPinned / assertSafePublicUrl in api/_lib/ssrf-guard.js),
// which validates every DNS answer, pins the socket to the checked IP, and
// re-validates every redirect hop. These tests fail if a raw
// redirect-following fetch ever returns to this module.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const pinned = vi.fn();
const assertSafe = vi.fn();

vi.mock('../api/_lib/ssrf-guard.js', () => ({
	fetchSafePublicUrlPinned: (...args) => pinned(...args),
	assertSafePublicUrl: (...args) => assertSafe(...args),
}));

import { fetchArticleHtml, fetchViaReader, extractParagraphs } from '../api/_lib/article-extract.js';
import { fetchViaWayback, fetchPrimaryFiling, LANE_USER_AGENT } from '../api/_lib/article-lanes.js';

const MAX_BYTES = 5 * 1024 * 1024;

beforeEach(() => {
	pinned.mockReset();
	assertSafe.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('fetchArticleHtml (rung 1)', () => {
	it('fetches only through the pinned guard, never raw fetch', async () => {
		const rawFetch = vi.fn();
		vi.stubGlobal('fetch', rawFetch);
		pinned.mockResolvedValueOnce(
			new Response('<html><body><p>story</p></body></html>', {
				status: 200,
				headers: { 'content-type': 'text/html' },
			}),
		);

		const html = await fetchArticleHtml('https://publisher.example/story');

		expect(pinned).toHaveBeenCalledTimes(1);
		expect(pinned).toHaveBeenCalledWith(
			'https://publisher.example/story',
			expect.objectContaining({
				headers: expect.objectContaining({ 'user-agent': expect.any(String) }),
			}),
			{ maxBytes: MAX_BYTES },
		);
		expect(rawFetch).not.toHaveBeenCalled();
		expect(html).toContain('story');
	});

	it('propagates a guard block instead of falling back to a direct fetch', async () => {
		const rawFetch = vi.fn();
		vi.stubGlobal('fetch', rawFetch);
		pinned.mockRejectedValueOnce(
			Object.assign(new Error('host resolves to a blocked range'), { code: 'ssrf_blocked' }),
		);

		await expect(
			fetchArticleHtml('http://169.254.169.254/latest/meta-data'),
		).rejects.toThrow(/blocked range/);
		expect(rawFetch).not.toHaveBeenCalled();
	});

	it('still enforces the html content-type contract', async () => {
		pinned.mockResolvedValueOnce(
			new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
		);
		await expect(fetchArticleHtml('https://publisher.example/data')).rejects.toThrow(
			/unsupported content type/,
		);
	});
});

describe('fetchViaReader (rung 2)', () => {
	it('validates the target BEFORE handing it to the reader service', async () => {
		assertSafe.mockResolvedValueOnce(undefined);
		pinned.mockResolvedValueOnce(
			new Response('Markdown Content:\n\nA perfectly ordinary paragraph of article prose, long enough to keep.', {
				status: 200,
			}),
		);

		await fetchViaReader('https://publisher.example/story');

		expect(assertSafe).toHaveBeenCalledWith('https://publisher.example/story');
		expect(pinned).toHaveBeenCalledTimes(1);
		expect(pinned.mock.calls[0][0]).toBe('https://r.jina.ai/https://publisher.example/story');
		expect(pinned.mock.calls[0][2]).toEqual({ maxBytes: MAX_BYTES });
	});

	it('never calls the reader service for a rejected target', async () => {
		assertSafe.mockRejectedValueOnce(
			Object.assign(new Error('url is not a valid URL'), { code: 'ssrf_blocked' }),
		);

		await expect(fetchViaReader('http://127.0.0.1:8080/internal')).rejects.toThrow();
		expect(pinned).not.toHaveBeenCalled();
	});
});

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const PAGE = `<article><p>${'The archived story body is long enough to count as a real paragraph. '.repeat(2)}</p></article>`;

describe('wayback lane', () => {
	it('validates the target, then fetches lookup and snapshot only through the pinned guard', async () => {
		const rawFetch = vi.fn();
		vi.stubGlobal('fetch', rawFetch);
		pinned
			.mockResolvedValueOnce(json({ archived_snapshots: { closest: { available: true, timestamp: '20240105123000', url: 'http://web.archive.org/web/20240105123000/https://publisher.example/story' } } }))
			.mockResolvedValueOnce(html(PAGE));

		const out = await fetchViaWayback('https://publisher.example/story', extractParagraphs);

		expect(assertSafe).toHaveBeenCalledWith('https://publisher.example/story', { allowHttp: true });
		expect(pinned.mock.calls[0][0]).toContain('https://archive.org/wayback/available?url=');
		expect(pinned.mock.calls[1][0]).toBe('https://web.archive.org/web/20240105123000id_/https://publisher.example/story');
		expect(pinned.mock.calls[1][2]).toEqual({ maxBytes: MAX_BYTES });
		expect(rawFetch).not.toHaveBeenCalled();
		expect(out.paragraphs.length).toBe(1);
		expect(out.html).toContain('archived story body');
	});

	it('does not touch the archive for a target the guard rejects', async () => {
		assertSafe.mockRejectedValueOnce(new Error('blocked'));
		await expect(fetchViaWayback('http://169.254.169.254/x', extractParagraphs)).rejects.toThrow('blocked');
		expect(pinned).not.toHaveBeenCalled();
	});

	it('returns no paragraphs and no snapshot fetch when nothing is archived', async () => {
		pinned.mockResolvedValueOnce(json({ archived_snapshots: {} }));
		const out = await fetchViaWayback('https://publisher.example/story', extractParagraphs);
		expect(out).toEqual({ paragraphs: [], snapshot: null, html: null });
		expect(pinned).toHaveBeenCalledTimes(1);
	});
});

describe('primary lane (SEC EDGAR)', () => {
	it('searches and fetches the filing through the guard with the SEC contact User-Agent, caching by accession', async () => {
		const hit = { _id: '0001193125-26-000009:ex991.htm', _source: { ciks: ['0001234567'], display_names: ['Acme Holdings Corp  (CIK 0001234567)'], form: '8-K', file_type: 'EX-99.1', file_date: '2026-10-01' } };
		pinned
			.mockResolvedValueOnce(json({ hits: { hits: [hit] } }))
			.mockResolvedValueOnce(html(PAGE))
			.mockResolvedValueOnce(json({ hits: { hits: [hit] } }));

		const first = await fetchPrimaryFiling('Acme Holdings Corp reports record quarter', '2026-10-01T00:00:00Z', extractParagraphs, Date.parse('2026-10-05'));
		expect(first.filing.accession).toBe('0001193125-26-000009');
		expect(pinned.mock.calls[0][0]).toContain('https://efts.sec.gov/LATEST/search-index?q=%22Acme%20Holdings%20Corp%22');
		expect(pinned.mock.calls[0][0]).toContain('startdt=2026-09-17&enddt=2026-10-05');
		expect(pinned.mock.calls[1][0]).toBe('https://www.sec.gov/Archives/edgar/data/1234567/000119312526000009/ex991.htm');
		expect(pinned.mock.calls[1][1].headers['user-agent']).toBe(LANE_USER_AGENT);
		expect(LANE_USER_AGENT).toMatch(/\S+@\S+\.\S+/);

		const second = await fetchPrimaryFiling('Acme Holdings Corp reports record quarter', '2026-10-01T00:00:00Z', extractParagraphs, Date.parse('2026-10-05'));
		expect(second.paragraphs).toEqual(first.paragraphs);
		expect(pinned).toHaveBeenCalledTimes(3); // second run: search only, filing document served from the accession cache
	});

	it('makes no request when the headline names no filer', async () => {
		const out = await fetchPrimaryFiling('Markets rally as rates fall', null, extractParagraphs);
		expect(out).toEqual({ paragraphs: [], filing: null });
		expect(pinned).not.toHaveBeenCalled();
	});
});

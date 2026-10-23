// Ladder order for api/_lib/article-extract.js with the extra lanes wired in:
// page -> reader -> wayback -> primary -> siblings -> feed -> preview.
// The lane modules are mocked here so the test pins the DECISIONS extractArticle
// makes (which rung wins, what each lane receives), not the lanes' own parsing,
// which tests/news-article-extract.test.js and tests/article-extract-ssrf.test.js cover.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pinned = vi.fn();
vi.mock('../api/_lib/ssrf-guard.js', () => ({
	fetchSafePublicUrlPinned: (...a) => pinned(...a),
	assertSafePublicUrl: async () => new URL('https://publisher.example/story'),
}));

const wayback = vi.fn();
const primary = vi.fn();
const siblings = vi.fn();
vi.mock('../api/_lib/article-lanes.js', () => ({
	fetchViaWayback: (...a) => wayback(...a),
	fetchPrimaryFiling: (...a) => primary(...a),
	fetchSiblings: (...a) => siblings(...a),
}));

import { extractArticle } from '../api/_lib/article-extract.js';

const URL_ = 'https://publisher.example/story';
const body = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} of the recovered story, long enough to be real prose.`);

beforeEach(() => {
	pinned.mockReset().mockResolvedValue(new Response('blocked', { status: 403 }));
	wayback.mockReset().mockResolvedValue({ paragraphs: [], snapshot: null, html: null });
	primary.mockReset().mockResolvedValue({ paragraphs: [], filing: null });
	siblings.mockReset().mockResolvedValue({ paragraphs: [], siblings: [] });
});

describe('extractArticle lanes', () => {
	it('uses the Wayback snapshot when the page and reader are blocked', async () => {
		wayback.mockResolvedValue({ paragraphs: body(5), snapshot: 'https://web.archive.org/web/20240105123000id_/' + URL_, html: '<title>Archived headline</title>' });
		const out = await extractArticle(URL_, { title: 'Headline' });
		expect(out.extraction).toBe('wayback');
		expect(out.paragraphs).toHaveLength(5);
		expect(out.html).toContain('Archived headline');
		expect(out.lane_sources).toEqual([{ label: 'Internet Archive snapshot', url: expect.stringContaining('web.archive.org') }]);
		expect(primary).not.toHaveBeenCalled();
		expect(siblings).not.toHaveBeenCalled();
	});

	it('falls to the SEC filing, passing the headline and publish time, when nothing is archived', async () => {
		primary.mockResolvedValue({
			paragraphs: body(3),
			filing: { filer: 'Acme Holdings Corp', form: '8-K', filed: '2026-10-01', url: 'https://www.sec.gov/Archives/edgar/data/1/2/ex.htm' },
		});
		const out = await extractArticle(URL_, { title: 'Acme Holdings Corp reports', publishedAt: '2026-10-01T00:00:00Z' });
		expect(out.extraction).toBe('primary');
		expect(primary.mock.calls[0].slice(0, 2)).toEqual(['Acme Holdings Corp reports', '2026-10-01T00:00:00Z']);
		expect(out.lane_sources[0].label).toBe('Acme Holdings Corp 8-K filed 2026-10-01');
		expect(siblings).not.toHaveBeenCalled();
	});

	it('falls to sibling coverage only when it names at least two outlets', async () => {
		siblings.mockResolvedValue({ paragraphs: ['A reports: x', 'B reports: y'], siblings: [{ source: 'A', link: 'https://a.example/1' }, { source: 'B', link: 'https://b.example/1' }] });
		const out = await extractArticle(URL_, { title: 'Headline' });
		expect(out.extraction).toBe('siblings');
		expect(out.lane_sources.map((s) => s.label)).toEqual(['A', 'B']);

		siblings.mockResolvedValue({ paragraphs: ['A reports: x'], siblings: [{ source: 'A', link: 'https://a.example/1' }] });
		expect((await extractArticle(URL_, { title: 'Headline' })).extraction).toBe('preview');
	});

	it('skips the title-driven lanes when no headline is known', async () => {
		await extractArticle(URL_);
		expect(primary).not.toHaveBeenCalled();
		expect(siblings).not.toHaveBeenCalled();
	});

	it('lets a real feed body beat an empty preview after every lane misses', async () => {
		const feed = 'The publisher feed carries the whole story in its content body. '.repeat(12);
		const out = await extractArticle(URL_, { title: 'Headline', feedContentText: feed });
		expect(out.extraction).toBe('feed');
	});

	it('survives every lane throwing and reports an honest preview', async () => {
		wayback.mockRejectedValue(new Error('archive down'));
		primary.mockRejectedValue(new Error('edgar down'));
		siblings.mockRejectedValue(new Error('feeds down'));
		const out = await extractArticle(URL_, { title: 'Headline' });
		expect(out.extraction).toBe('preview');
		expect(out.paragraphs).toEqual([]);
		expect(out.blocked_reason).toMatch(/403/);
	});
});

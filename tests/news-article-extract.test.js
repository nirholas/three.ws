// Guards api/_lib/article-extract.js — the /markets/news full-text extraction
// ladder. The bug this fixes: Cloudflare-blocked publishers (The Defiant,
// CoinDesk, …) 403 a direct fetch, so the reader fell straight through to the
// one-line RSS teaser and the story page looked empty. These tests pin the
// pure parsing + ladder-decision logic (no network) so a regression can't
// silently reintroduce the empty page.

import { describe, it, expect } from 'vitest';
import {
	paragraphsFromReaderMarkdown,
	paragraphsFromFeed,
	extractParagraphs,
} from '../api/_lib/article-extract.js';
import { enrichTickers } from '../api/_lib/news-coins.js';
import { waybackRawUrl, filerPhrase, pickFiling, pickSiblings } from '../api/_lib/article-lanes.js';

describe('paragraphsFromReaderMarkdown', () => {
	const md = `Title: eToro Takes Strategic Stake in Extended

URL Source: https://thedefiant.io/news/x

Markdown Content:
eToro has become a strategic investor in Extended, an onchain perpetual futures exchange, and said the round begins a partnership with Zengo, the self-custody wallet eToro acquired earlier this year.

Extended said on X that eToro [is now a strategic investor](https://x.com/e) and that the partnership will focus on expanding access to global financial markets through next-generation on-chain infrastructure.

Share
Subscribe to our newsletter

![hero image](https://cdn.example/img.png)

*   Nav item one
*   Nav item two`;

	it('keeps real article prose', () => {
		const paras = paragraphsFromReaderMarkdown(md);
		expect(paras.length).toBe(2);
		expect(paras[0]).toContain('strategic investor in Extended');
	});

	it('strips markdown link syntax, keeping the link text', () => {
		const paras = paragraphsFromReaderMarkdown(md);
		expect(paras[1]).toContain('is now a strategic investor');
		expect(paras[1]).not.toContain('](');
		expect(paras[1]).not.toContain('https://x.com');
	});

	it('drops images, nav lists, and subscribe/share chrome', () => {
		const joined = paragraphsFromReaderMarkdown(md).join(' ');
		expect(joined).not.toContain('hero image');
		expect(joined).not.toContain('Nav item');
		expect(joined).not.toMatch(/subscribe/i);
	});

	it('returns nothing for a page that is all chrome', () => {
		const chrome = `Markdown Content:\n*   Home\n*   About\n\nShare\n\nSubscribe`;
		expect(paragraphsFromReaderMarkdown(chrome)).toEqual([]);
	});
});

describe('paragraphsFromFeed', () => {
	it('coalesces a feed body into readable paragraphs', () => {
		const body =
			'Bitcoin rose 5% today. Analysts point to ETF inflows. ' +
			'The move pushed BTC above a key level that had capped it for weeks.';
		const paras = paragraphsFromFeed(body);
		expect(paras.length).toBeGreaterThan(0);
		expect(paras.join(' ')).toContain('Bitcoin rose 5%');
	});
});

describe('extractParagraphs', () => {
	it('pulls <p> prose from an article container and skips short fragments', () => {
		const html = `<html><body><article>
			<p>Share</p>
			<p>Ethereum's latest upgrade shipped on mainnet this week, lowering fees for rollups and changing how blobs are priced across the network.</p>
			<p>Validators reported a smooth transition with no missed slots during the activation window, according to client teams.</p>
		</article></body></html>`;
		const paras = extractParagraphs(html);
		expect(paras.length).toBe(2); // the 5-char "Share" is dropped
		expect(paras[0]).toContain('Ethereum');
	});
});

describe('enrichTickers', () => {
	it('returns nothing when no ticker maps to a known coin id', async () => {
		// EXTENDED / ZENGO / ETORO are not in TICKER_COIN_IDS — no network call.
		expect(await enrichTickers(['EXTENDED', 'ZENGO'])).toEqual([]);
		expect(await enrichTickers([])).toEqual([]);
	});
});

describe('wayback lane', () => {
	const closest = { available: true, status: '200', timestamp: '20240105123000', url: 'http://web.archive.org/web/20240105123000/https://publisher.example/story' };

	it('builds the raw-capture URL from a real web.archive.org snapshot', () => {
		expect(waybackRawUrl(closest, 'https://publisher.example/story')).toBe(
			'https://web.archive.org/web/20240105123000id_/https://publisher.example/story',
		);
	});

	it('refuses a snapshot that is not served from web.archive.org', () => {
		expect(waybackRawUrl({ ...closest, url: 'http://169.254.169.254/web/20240105123000/x' }, 'https://publisher.example/story')).toBeNull();
		expect(waybackRawUrl({ ...closest, url: 'https://web.archive.org.evil.example/web/1/x' }, 'https://publisher.example/story')).toBeNull();
	});

	it('returns null when nothing is archived or the timestamp is malformed', () => {
		expect(waybackRawUrl(undefined, 'https://publisher.example/story')).toBeNull();
		expect(waybackRawUrl({ ...closest, timestamp: 'x' }, 'https://publisher.example/story')).toBeNull();
	});
});

describe('primary lane (SEC EDGAR)', () => {
	it('takes the longest capitalised run in the headline as the filer', () => {
		expect(filerPhrase('Acme Holdings Corp reports record quarter as shares jump')).toBe('Acme Holdings Corp');
	});

	it('does not treat a lone sentence-opening word as a filer', () => {
		expect(filerPhrase('Markets rally as rates fall')).toBeNull();
		expect(filerPhrase('')).toBeNull();
	});

	const hit = (id, file_type, name) => ({
		_id: id,
		_source: { ciks: ['0001234567'], display_names: [`${name}  (CIK 0001234567)`], form: '8-K', file_type, file_date: '2026-10-01' },
	});

	it('prefers the press-release exhibit and builds the archive URL', () => {
		const filing = pickFiling(
			{ hits: { hits: [hit('0001193125-26-000001:main8k.htm', '8-K', 'Acme Holdings Corp'), hit('0001193125-26-000001:ex991.htm', 'EX-99.1', 'Acme Holdings Corp')] } },
			'Acme Holdings Corp',
		);
		expect(filing.url).toBe('https://www.sec.gov/Archives/edgar/data/1234567/000119312526000001/ex991.htm');
		expect(filing).toMatchObject({ accession: '0001193125-26-000001', form: '8-K', filer: 'Acme Holdings Corp', filed: '2026-10-01' });
	});

	it('rejects a filing whose filer does not match the headline phrase', () => {
		expect(pickFiling({ hits: { hits: [hit('0001193125-26-000002:ex991.htm', 'EX-99.1', 'Other Industries Inc')] } }, 'Acme Holdings Corp')).toBeNull();
	});

	it('skips non-HTML documents', () => {
		expect(pickFiling({ hits: { hits: [hit('0001193125-26-000003:ex991.pdf', 'EX-99.1', 'Acme Holdings Corp')] } }, 'Acme Holdings Corp')).toBeNull();
	});
});

describe('siblings lane', () => {
	const mk = (title, source, host, description) => ({ title, source, link: `https://${host}/a`, description });
	const body = 'The exchange confirmed the listing of the new token after a review by its listings committee on Tuesday.';
	const title = 'Exchange confirms listing of THREE token after committee review';

	it('keeps other publishers covering the same story, one per outlet', () => {
		const out = pickSiblings(
			[
				mk('Exchange confirms THREE token listing following committee review', 'Outlet A', 'a.example', body),
				mk('THREE token listing confirmed by exchange committee review', 'Outlet A again', 'a.example', body),
				mk('Unrelated story about mining difficulty adjustments', 'Outlet B', 'b.example', body),
				mk('Exchange confirms listing of THREE token after committee review', 'Same publisher', 'publisher.example', body),
			],
			{ title, url: 'https://publisher.example/story' },
		);
		expect(out.map((s) => s.source)).toEqual(['Outlet A']);
	});

	it('bounds each sibling description to the excerpt limit', () => {
		const long = `${body} `.repeat(20);
		const [s] = pickSiblings([mk('Exchange confirms THREE token listing following committee review', 'Outlet A', 'a.example', long)], {
			title,
			url: 'https://publisher.example/story',
		});
		expect(s.text.length).toBeLessThanOrEqual(401);
	});

	it('returns nothing for a headline too short to match on', () => {
		expect(pickSiblings([mk('Short one', 'A', 'a.example', body)], { title: 'Short one', url: 'https://publisher.example/s' })).toEqual([]);
	});
});

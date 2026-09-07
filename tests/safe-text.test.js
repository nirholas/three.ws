// Coverage for api/_lib/safe-text.js and the truncation sites that feed a
// crawler.
//
// The bug this file exists for: Google Search Console reported "Unparsable
// structured data: truncated Unicode character" on an archived story page on
// 2026-09-06. api/_lib/news-archive-store.js cut the publisher description at
// 240 UTF-16 code units with a plain `.slice()`, which landed between the two
// halves of an emoji. JSON.stringify is well-formed since ES2019, so it wrote
// the surviving half into the JSON-LD as a literal "\ud83d" escape and Google
// dropped the page from rich results.
//
// A half character is invisible in every local check (it renders as a
// replacement glyph, the page still returns 200, the JSON still parses in
// Node), so it is asserted here directly.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/http.js', () => ({ wrap: (fn) => fn }));
vi.mock('../api/_lib/env.js', () => ({ env: {} }));

const { truncateChars, stripLoneSurrogates, hasLoneSurrogate, scriptJson } = await import('../api/_lib/safe-text.js');
const { compact } = await import('../api/_lib/news-archive-store.js');
const { excerptText, excerptParagraphs, EXCERPT_MAX_CHARS } = await import('../api/_lib/news-rights.js');
const { renderStoryHtml } = await import('../api/news/story-page.js');

const CHART = String.fromCodePoint(0x1f4ca); // two UTF-16 code units
const FLAG = String.fromCodePoint(0x1f1fa, 0x1f1f8); // two code points, one grapheme
const FAMILY = '\u{1f468}‍\u{1f469}‍\u{1f467}'; // ZWJ sequence

describe('truncateChars', () => {
	it('never splits a surrogate pair', () => {
		const s = `chart ${CHART} tail`;
		expect(hasLoneSurrogate(s.slice(0, 7))).toBe(true); // what a plain slice does
		expect(truncateChars(s, 7)).toBe('chart ');
		expect(truncateChars(s, 8)).toBe(`chart ${CHART}`);
		expect(hasLoneSurrogate(truncateChars(s, 7))).toBe(false);
	});

	it('keeps multi-code-point graphemes whole', () => {
		expect(truncateChars(`ab${FLAG}`, 3)).toBe('ab');
		expect(truncateChars(`ab${FLAG}`, 6)).toBe(`ab${FLAG}`);
		expect(truncateChars(FAMILY, 5)).toBe('');
		expect(truncateChars(FAMILY, FAMILY.length)).toBe(FAMILY);
	});

	it('passes through anything already inside the budget', () => {
		expect(truncateChars('short', 240)).toBe('short');
		expect(truncateChars('', 240)).toBe('');
		expect(truncateChars(null, 240)).toBe('');
		expect(truncateChars('anything', 0)).toBe('');
	});
});

describe('stripLoneSurrogates', () => {
	it('drops an unpaired half and keeps whole characters', () => {
		const broken = `chart ${CHART} tail`.slice(0, 7);
		expect(hasLoneSurrogate(broken)).toBe(true);
		expect(stripLoneSurrogates(broken)).toBe('chart ');
		expect(stripLoneSurrogates(`ok ${CHART} ok`)).toBe(`ok ${CHART} ok`);
	});

	it('keeps scriptJson output free of escaped lone surrogates', () => {
		const json = scriptJson({ d: `chart ${CHART} tail`.slice(0, 7), html: '</script>' });
		expect(/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(json)).toBe(false);
		expect(json).not.toContain('</script>');
		expect(JSON.parse(json.replace(/\\u003c/g, '<')).d).toBe('chart ');
	});
});

describe('archive compact()', () => {
	it('cuts an over-long description without leaving half a character', () => {
		const description = `${CHART} Technical analysis. ${'word '.repeat(60)}${CHART} tail`;
		expect(description.length).toBeGreaterThan(240);
		const out = compact({ id: 'a'.repeat(16), title: `${CHART} headline`, description });
		expect(out.description.length).toBeLessThanOrEqual(240);
		expect(hasLoneSurrogate(out.description)).toBe(false);
	});
});

describe('rights excerpts', () => {
	it('bounds an emoji-heavy body without splitting a character', () => {
		const body = `${CHART} ${'analysis '.repeat(80)}${CHART}`;
		const out = excerptText(body);
		expect(out.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS + 1); // + the ellipsis
		expect(hasLoneSurrogate(out)).toBe(false);
	});

	it('keeps the whole budget for a paragraph with no spaces', () => {
		const runOn = `${CHART}${'x'.repeat(EXCERPT_MAX_CHARS * 2)}`;
		const { paragraphs } = excerptParagraphs([runOn]);
		expect(paragraphs[0].length).toBeGreaterThan(EXCERPT_MAX_CHARS * 0.5);
		expect(hasLoneSurrogate(paragraphs[0])).toBe(false);
	});
});

describe('story page output', () => {
	const shell = `<!doctype html><html><head><title data-i18n="news_article.meta_title">Reader</title>
<meta name="description" content="x" data-i18n-attr="content"><meta name="robots" content="noindex">
<meta property="og:title" content="x"><meta property="og:description" content="x">
<meta property="og:image" content="x"><meta property="og:url" content="x"><meta property="og:image:alt" content="x">
<meta name="twitter:title" content="x"><meta name="twitter:description" content="x"><meta name="twitter:image" content="x">
<link rel="canonical" href="https://three.ws/markets/news">
<script type="application/ld+json">{}</script></head>
<body><article id="art-root"></article></body></html>`;

	const article = {
		id: 'abcdefabcdefabcd',
		title: `${CHART} Technical analysis ${FLAG}`,
		link: 'https://publisher.example/story',
		description: `${CHART} ${'context '.repeat(80)}${CHART}`,
		source: 'Publisher',
		source_key: 'publisher',
		category: 'general',
		pub_date: '2026-08-10T07:46:06.000Z',
		tickers: ['THREE'],
		sentiment: { label: 'neutral', score: 0 },
	};

	it('emits JSON-LD with no truncated character, and it parses', () => {
		const html = renderStoryHtml(shell, article);
		const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
		expect(/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(ld)).toBe(false);
		expect(hasLoneSurrogate(ld)).toBe(false);
		const graph = JSON.parse(ld.replace(/\\u003c/g, '<'))['@graph'];
		expect(graph[0]['@type']).toBe('NewsArticle');
		expect(hasLoneSurrogate(graph[0].description || '')).toBe(false);
	});

	it('emits a clean seed and clean meta tags', () => {
		const html = renderStoryHtml(shell, article);
		const seed = html.match(/id="art-seed">([\s\S]*?)<\/script>/)[1];
		expect(hasLoneSurrogate(seed)).toBe(false);
		expect(hasLoneSurrogate(html)).toBe(false);
		JSON.parse(seed.replace(/\\u003c/g, '<'));
	});

	it('survives a description that already arrived with half a character', () => {
		const poisoned = { ...article, description: `already broken ${CHART}`.slice(0, 16) };
		expect(hasLoneSurrogate(poisoned.description)).toBe(true);
		const html = renderStoryHtml(shell, poisoned);
		expect(hasLoneSurrogate(html)).toBe(false);
		const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
		expect(/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(ld)).toBe(false);
	});
});

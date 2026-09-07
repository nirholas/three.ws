// The UA split in api/_lib/crawler-page.js decides whether a crawler page ends
// with a script that navigates to the URL it is already on. Get it wrong in one
// direction and an indexing crawler loops on a content-free response; get it
// wrong in the other and a human who arrives behind a scraper UA is stranded on
// a static page. Both halves are asserted here.

import { describe, it, expect } from 'vitest';
import { isSearchCrawler, renderCrawlerPage, renderCrawlerNotFound } from '../../api/_lib/crawler-page.js';

const SEARCH = [
	'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/128.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
	'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
	'Mozilla/5.0 (Device; OS) AppleWebKit/537.36 (KHTML, like Gecko) Version/8.0 Safari/600.0 (Applebot/0.1)',
	'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
	'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
	'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
	'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
	'Mozilla/5.0 (compatible; DuckDuckBot-Https/1.1; https://duckduckgo.com/duckduckbot)',
];

const UNFURLERS = [
	'Twitterbot/1.0',
	'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
	'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
	'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
	'TelegramBot (like TwitterBot)',
	'Mozilla/5.0 (compatible; Embedly/0.2; snap; +http://support.embed.ly/)',
	'Iframely/1.3.1 (+https://iframely.com/docs/about)',
	'WhatsApp/2.19.81 A',
];

const PAGE = {
	title: 'Nova',
	desc: 'A chrome scout.',
	pageUrl: 'https://three.ws/avatars/abc',
	ogImage: 'https://three.ws/api/avatars/abc/og',
	origin: 'https://three.ws',
	trail: [
		{ name: 'Home', path: '/' },
		{ name: 'Gallery', path: '/gallery' },
		{ name: 'Nova', path: '/avatars/abc' },
	],
};

describe('isSearchCrawler', () => {
	it('recognises every indexing crawler we serve pages to', () => {
		for (const ua of SEARCH) expect(isSearchCrawler(ua), ua).toBe(true);
	});

	it('does not claim link unfurlers index anything', () => {
		for (const ua of UNFURLERS) expect(isSearchCrawler(ua), ua).toBe(false);
	});

	it('treats a missing user-agent as a non-indexer', () => {
		expect(isSearchCrawler(undefined)).toBe(false);
		expect(isSearchCrawler('')).toBe(false);
		expect(isSearchCrawler(null)).toBe(false);
	});
});

describe('renderCrawlerPage', () => {
	it('emits the self-navigating script only when asked', () => {
		expect(renderCrawlerPage({ ...PAGE, redirect: false })).not.toContain('location.replace');
		expect(renderCrawlerPage({ ...PAGE, redirect: true })).toContain(
			'location.replace("/avatars/abc")',
		);
	});

	it('puts the content in the body and the canonical in the head', () => {
		const html = renderCrawlerPage(PAGE);
		expect(html).toMatch(/<h1>Nova<\/h1>/);
		expect(html).toContain('A chrome scout.');
		expect(html).toContain('<link rel="canonical" href="https://three.ws/avatars/abc">');
		expect(html).toMatch(/name="robots" content="index, follow/);
		expect(html).toContain('BreadcrumbList');
	});

	it('closes the ld+json script against a name that carries markup', () => {
		const html = renderCrawlerPage({
			...PAGE,
			title: 'x</script><script>alert(1)</script>',
			jsonLd: { '@type': '3DModel', name: 'x</script><script>alert(1)</script>' },
		});
		expect(html).not.toContain('</script><script>alert(1)');
		expect(html).toContain('\\u003c/script');
	});
});

describe('renderCrawlerNotFound', () => {
	it('is always noindex and carries a way out', () => {
		const html = renderCrawlerNotFound({
			heading: 'Gone',
			message: 'Nothing here.',
			origin: 'https://three.ws',
			actions: [{ label: 'Gallery', href: '/gallery' }],
		});
		expect(html).toMatch(/name="robots" content="noindex, follow"/);
		expect(html).toContain('href="/gallery"');
		expect(html).not.toContain('rel="canonical"');
	});
});

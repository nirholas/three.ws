// News card images load through the same-origin /api/img proxy first. Several
// publishers send `Cross-Origin-Resource-Policy: same-origin` on their images,
// so a direct <img> was refused by the browser (ERR_BLOCKED_BY_RESPONSE
// .NotSameOrigin) and logged on every /markets/news visit before the proxy
// retry ran (console sweep 2026-11-12). The proxy answers a miss with a quiet
// 204 (fallback=none) so the card's initials tile shows. There is no direct-URL
// retry: an image the proxy cannot fetch is gone or unreachable, and retrying it
// from the browser would only log the same refusal again.

import { describe, it, expect } from 'vitest';
import { newsMedia } from '../src/shared/news-render.js';

const IMG = 'https://publisher.example/wp-content/uploads/2026/11/story.jpg';

function attrs(html) {
	const out = {};
	for (const [, k, v] of html.matchAll(/([a-z-]+)="([^"]*)"/g)) out[k] = v.replaceAll('&amp;', '&');
	return out;
}

describe('newsMedia', () => {
	it('loads the image through /api/img with no placeholder art, and never retries the direct URL', () => {
		const a = attrs(newsMedia({ image: IMG, source: 'Publisher', link: 'https://publisher.example/story' }));
		const src = new URL(a.src, 'https://three.ws');
		expect(src.pathname).toBe('/api/img');
		expect(src.searchParams.get('url')).toBe(IMG);
		expect(src.searchParams.get('fallback')).toBe('none');
		expect(a['data-retry']).toBeUndefined();
		expect(a['data-fallback']).toBe('PU');
	});

	it('renders the designed tile, not an image, when the article has no picture', () => {
		const html = newsMedia({ image: '', source: 'Publisher', link: 'https://publisher.example/story' });
		expect(html).not.toContain('<img');
		expect(html).toContain('data-resolve="https://publisher.example/story"');
	});
});

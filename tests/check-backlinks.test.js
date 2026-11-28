import { describe, it, expect } from 'vitest';
import { classifyPage } from '../scripts/check-backlinks.mjs';

const URL_ = 'https://example.com/post';
const page = (body, head = '') => `<html><head>${head}</head><body>${body}</body></html>`;

describe('classifyPage', () => {
	it('counts a plain link to three.ws (or a subdomain) as followed', () => {
		const r = classifyPage({
			url: URL_,
			html: page('<a href="https://three.ws/forge">x</a><a href="https://docs.three.ws/">d</a>'),
		});
		expect(r.status).toBe('followed');
		expect(r.followedTargets).toEqual(['https://three.ws/forge', 'https://docs.three.ws/']);
	});

	it('treats rel=noopener as followed but nofollow, ugc and sponsored as not', () => {
		expect(classifyPage({ url: URL_, html: page('<a rel="noopener" href="https://three.ws">x</a>') }).status).toBe('followed');
		for (const rel of ['nofollow', 'ugc', 'sponsored', 'noopener nofollow']) {
			expect(classifyPage({ url: URL_, html: page(`<a rel="${rel}" href="https://three.ws">x</a>`) }).status).toBe('nofollow');
		}
	});

	it('demotes every link when the page itself says nofollow (meta or header)', () => {
		const link = '<a href="https://three.ws">x</a>';
		expect(
			classifyPage({ url: URL_, html: page(link, '<meta name="robots" content="index, nofollow">') }).status,
		).toBe('nofollow');
		expect(classifyPage({ url: URL_, html: page(link), robotsHeader: 'nofollow' }).status).toBe('nofollow');
	});

	it('flags a page that names three.ws without linking it', () => {
		expect(classifyPage({ url: URL_, html: page('<p>We tried three.ws last week.</p>') }).status).toBe('unlinked');
	});

	it('does not mistake look-alike hosts or script text for a link or mention', () => {
		const r = classifyPage({
			url: URL_,
			html: page('<a href="https://notthree.ws/">a</a><a href="https://three.ws.evil.com/">b</a><script>"three.ws"</script>'),
		});
		expect(r.status).toBe('gone');
		expect(r.links).toBe(0);
	});
});

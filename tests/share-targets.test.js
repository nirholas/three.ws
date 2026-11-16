import { describe, it, expect } from 'vitest';
import { teamsShareUrl, linkedinShareUrl } from '../src/shared/share-targets.js';
import { checkPreview, imageSize } from '../scripts/lib/share-preview-rules.mjs';

describe('share URLs', () => {
	it('builds the Teams launcher URL with href, message and preview', () => {
		const u = new URL(teamsShareUrl('https://three.ws/m/abc?x=1&y=2', 'A model & more'));
		expect(u.origin + u.pathname).toBe('https://teams.microsoft.com/share');
		expect(u.searchParams.get('href')).toBe('https://three.ws/m/abc?x=1&y=2');
		expect(u.searchParams.get('msgText')).toBe('A model & more');
		expect(u.searchParams.get('preview')).toBe('true');
	});
	it('omits msgText when there is no text', () => {
		expect(new URL(teamsShareUrl('https://three.ws/x')).searchParams.has('msgText')).toBe(false);
	});
	it('builds the LinkedIn share-offsite URL', () => {
		const u = new URL(linkedinShareUrl('https://three.ws/m/abc?x=1&y=2'));
		expect(u.origin + u.pathname).toBe('https://www.linkedin.com/sharing/share-offsite/');
		expect(u.searchParams.get('url')).toBe('https://three.ws/m/abc?x=1&y=2');
	});
});

const GOOD = `<link rel="canonical" href="https://three.ws/a">
<meta property="og:title" content="T"><meta property="og:description" content="D"><meta property="og:type" content="website">
<meta property="og:url" content="https://three.ws/a"><meta property="og:image" content="https://three.ws/i.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`;

describe('checkPreview', () => {
	it('passes a compliant head', () => {
		expect(checkPreview(GOOD, { image: { status: 200, contentType: 'image/png', bytes: 1000, width: 1200, height: 630 } })).toEqual([]);
	});
	it('names the exact offending tags', () => {
		const html = GOOD.replace(/<meta property="og:image:width"[^>]*>/, '').replace('https://three.ws/i.png', 'http://x/i.png');
		const tags = checkPreview(html).map((v) => v.tag);
		expect(tags).toContain('og:image:width');
		expect(tags).toContain('og:image');
	});
	it('rejects svg and oversized images', () => {
		const t = checkPreview(GOOD, { image: { status: 200, contentType: 'image/svg+xml', bytes: 6e6 } });
		expect(t.map((v) => v.problem).join()).toMatch(/not PNG/);
		expect(t.map((v) => v.problem).join()).toMatch(/bytes, max/);
	});
	it('reads PNG dimensions', () => {
		const b = Buffer.alloc(32); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(1200, 16); b.writeUInt32BE(630, 20);
		expect(imageSize(b)).toEqual({ width: 1200, height: 630 });
	});
});

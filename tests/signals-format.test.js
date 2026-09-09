// Display helpers behind /signals and /signals/:slug (src/shared/signals-format.js).
//
// Two of the three sit on the price the marketplace advertises, and the third
// decides whether a publisher with no profile image gets an identicon or an
// empty grey square. Both used to be duplicated per page and both were wrong on
// one of them, so the edges are pinned here.

import { describe, expect, it } from 'vitest';
import { fmtUsdc, epochLabel, publisherAvatarHtml } from '../src/shared/signals-format.js';

describe('fmtUsdc', () => {
	it('caps a normal price at two decimals and drops trailing zeros', () => {
		expect(fmtUsdc(0.25)).toBe('0.25');
		expect(fmtUsdc(5)).toBe('5');
		expect(fmtUsdc(12.345678)).toBe('12.35');
		expect(fmtUsdc(2.5)).toBe('2.5');
	});
	it('groups thousands', () => {
		expect(fmtUsdc(1234.5)).toBe('1,234.5');
	});
	it('keeps a sub-cent price instead of rounding it to zero', () => {
		expect(fmtUsdc(0.0005)).toBe('0.0005');
		expect(fmtUsdc(0.000125)).toBe('0.000125');
	});
	it('reads a missing or non-positive amount as zero', () => {
		expect(fmtUsdc(null)).toBe('0');
		expect(fmtUsdc(undefined)).toBe('0');
		expect(fmtUsdc(NaN)).toBe('0');
		expect(fmtUsdc(-3)).toBe('0');
	});
});

describe('epochLabel', () => {
	it('names whole days and hours', () => {
		expect(epochLabel(86400)).toBe('day');
		expect(epochLabel(3600)).toBe('hour');
		expect(epochLabel(7 * 86400)).toBe('7d');
		expect(epochLabel(4 * 3600)).toBe('4h');
	});
	it('falls back to minutes', () => {
		expect(epochLabel(900)).toBe('15m');
		expect(epochLabel(300)).toBe('5m');
	});
	it('never divides by a missing epoch', () => {
		expect(epochLabel(0)).toBe('epoch');
		expect(epochLabel(null)).toBe('epoch');
	});
});

describe('publisherAvatarHtml', () => {
	it('renders an img, never a CSS background, so the identicon actually paints', () => {
		const html = publisherAvatarHtml({ agent_id: 'agent-1', name: 'Pub', image: null });
		expect(html.startsWith('<img')).toBe(true);
		expect(html).not.toContain('style="background');
		expect(html).toContain('src="data:image/svg+xml');
	});
	it('prefers the publisher image and keeps the identicon as the swap target', () => {
		const html = publisherAvatarHtml({ agent_id: 'agent-1', name: 'Pub', image: 'https://cdn.example/a.png' });
		expect(html).toContain('src="https://cdn.example/a.png"');
		expect(html).toContain('data-fallback-src="data:image/svg+xml');
	});
	it('escapes a hostile image url out of the attribute', () => {
		const html = publisherAvatarHtml({ agent_id: 'a', name: 'p', image: '"><script>alert(1)</script>' });
		expect(html).not.toContain('<script>');
		expect(html).toContain('&quot;');
	});
	it('accepts a custom class for the detail hero', () => {
		expect(publisherAvatarHtml({ agent_id: 'a' }, 'sm-avatar sd-av')).toContain('class="sm-avatar sd-av"');
	});
});

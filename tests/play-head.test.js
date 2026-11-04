// server/play-head.mjs: the per-coin <head> on /play?coin=<mint>, so an invite
// link unfurls as that coin's world instead of the lobby.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPlayPath, playMeta, rewritePlayHead } from '../server/play-head.mjs';

const SHELL = readFileSync(new URL('../pages/play.html', import.meta.url), 'utf8');
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const OTHER_MINT = 'THREEsynthetic1111111111111111111111111111';

function head(html) {
	return /<head[^>]*>[\s\S]*?<\/head>/i.exec(html)[0];
}
function meta(html, attr, key) {
	const re = new RegExp(`<meta\\b[^>]*\\b${attr}=["']${key}["'][^>]*>`, 'gi');
	const tags = head(html).match(re) || [];
	return tags.map((t) => /content="([^"]*)"/.exec(t)?.[1]);
}

describe('isPlayPath', () => {
	it('matches only the world shell', () => {
		expect(isPlayPath('/play')).toBe(true);
		expect(isPlayPath('/play/')).toBe(true);
		expect(isPlayPath('/play/arena')).toBe(false);
		expect(isPlayPath('/features/play')).toBe(false);
	});
});

describe('playMeta', () => {
	it('is null without a valid mint, so the lobby keeps its own head', () => {
		expect(playMeta(new URLSearchParams())).toBeNull();
		expect(playMeta(new URLSearchParams('coin=nope'))).toBeNull();
		expect(playMeta(new URLSearchParams('coin=<script>'))).toBeNull();
	});

	it('names $THREE from HOME_TOWN on the bare QR link', () => {
		const m = playMeta(new URLSearchParams({ coin: THREE_MINT }));
		expect(m.label).toBe('$THREE');
		expect(m.pageUrl).toBe(`https://three.ws/play?coin=${THREE_MINT}`);
		const card = new URL(m.image);
		expect(card.pathname).toBe('/api/play-og');
		expect(card.searchParams.get('coin')).toBe(THREE_MINT);
		expect(card.searchParams.get('symbol')).toBe('three');
		expect(card.searchParams.get('image')).toMatch(/^\/api\/img\?/);
	});

	it('carries the invite link identity into the card and drops unsafe images', () => {
		const m = playMeta(new URLSearchParams({ coin: OTHER_MINT, name: 'Other Coin', symbol: '$othr', image: 'javascript:alert(1)' }));
		expect(m.label).toBe('$OTHR');
		expect(m.description).toContain('$OTHR (Other Coin)');
		expect(new URL(m.image).searchParams.has('image')).toBe(false);
	});

	it('still points at the coin when the link carries no name', () => {
		const m = playMeta(new URLSearchParams({ coin: OTHER_MINT }));
		expect(m.label).toBe('');
		expect(m.title).toBe('A live 3D coin world · three.ws');
		expect(new URL(m.image).searchParams.get('coin')).toBe(OTHER_MINT);
	});
});

describe('rewritePlayHead', () => {
	it('returns null for the lobby', () => {
		expect(rewritePlayHead(SHELL, new URLSearchParams())).toBeNull();
	});

	it('names the coin in every social tag, exactly once each', () => {
		const html = rewritePlayHead(SHELL, new URLSearchParams({ coin: THREE_MINT, name: 'three.ws', symbol: 'three' }));
		expect(head(html)).toMatch(/<title>\$THREE, a live 3D world · three\.ws<\/title>/);
		expect(meta(html, 'property', 'og:title')).toEqual(['$THREE, a live 3D world · three.ws']);
		expect(meta(html, 'name', 'twitter:title')).toEqual(['$THREE, a live 3D world · three.ws']);
		expect(meta(html, 'property', 'og:url')).toEqual([`https://three.ws/play?coin=${THREE_MINT}`]);
		const [ogImage] = meta(html, 'property', 'og:image');
		expect(ogImage).toMatch(/^https:\/\/three\.ws\/api\/play-og\?coin=FeMb/);
		expect(meta(html, 'name', 'twitter:image')).toEqual([ogImage]);
		expect(meta(html, 'name', 'twitter:card')).toEqual(['summary_large_image']);
		expect(head(html)).toContain(`<link rel="canonical" href="https://three.ws/play?coin=${THREE_MINT}" />`);
		expect(head(html)).toContain(encodeURIComponent(`https://three.ws/play?coin=${THREE_MINT}`));
		// The runtime locale swap must not be able to put the lobby strings back.
		expect(head(html)).not.toMatch(/og:title[^>]*data-i18n-attr/);
		const ld = head(html).match(/application\/ld\+json/g);
		expect(ld).toHaveLength(1);
		expect(head(html)).not.toContain('page-og?s=crypto');
	});

	it('escapes hostile params instead of injecting markup', () => {
		const html = rewritePlayHead(SHELL, new URLSearchParams({ coin: OTHER_MINT, name: '"><script>alert(1)</script>', symbol: 'x' }));
		expect(head(html)).not.toContain('<script>alert(1)</script>');
		expect(head(html)).toContain('&quot;&gt;&lt;script&gt;')
	});

	it('leaves the body untouched', () => {
		const html = rewritePlayHead(SHELL, new URLSearchParams({ coin: THREE_MINT }));
		const after = (s) => s.slice(s.indexOf('</head>'));
		expect(after(html)).toBe(after(SHELL));
	});
});

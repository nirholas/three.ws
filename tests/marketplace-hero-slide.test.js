// @vitest-environment jsdom
// The /marketplace hero is poster-first: each slide paints its stored thumbnail
// as a plain <img> in the first frame and carries an inert <model-slot> that
// becomes a real <model-viewer> only when the visitor engages with the hero.
//
// Measured on 2026-11-13 against production (Lighthouse desktop): the active
// slide shipped an eager <model-viewer> with no poster, so the page downloaded
// a 2,144 KiB GLB and parsed model-viewer (its second-largest CPU cost) during
// load, while the stage showed a shimmering initial until the mesh arrived.
import { describe, it, expect } from 'vitest';
import { heroSlideHtml, heroPosterUrl, wireHeroPoster, HERO_POSTER_WIDTH } from '../src/shared/marketplace-hero.js';

const item = {
	name: 'Michelle',
	glbUrl: 'https://three.ws/avatars/michelle.glb',
	image: 'https://three.ws/cdn/thumb/13f259c7-7024-4d68-b1f0-dbbf52c06209.webp',
};

function parse(html) {
	const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
	return doc.getElementById('root').firstElementChild;
}

describe('heroPosterUrl', () => {
	it('serves a first-party thumbnail through the display-sized /cdn/ variant', () => {
		expect(heroPosterUrl(item)).toBe(
			`https://three.ws/cdn/_v/${HERO_POSTER_WIDTH}/thumb/13f259c7-7024-4d68-b1f0-dbbf52c06209.webp`,
		);
	});

	it('returns null when the item has no picture', () => {
		expect(heroPosterUrl({ name: 'x', glbUrl: 'https://three.ws/a.glb' })).toBeNull();
		expect(heroPosterUrl(null)).toBeNull();
	});
});

describe('heroSlideHtml', () => {
	it('builds no <model-viewer> during load: the model waits in a <model-slot>', () => {
		const slide = parse(heroSlideHtml(item, 0, 0));
		expect(slide.querySelector('model-viewer')).toBeNull();
		const slot = slide.querySelector('model-slot');
		expect(slot).not.toBeNull();
		expect(slot.getAttribute('data-src')).toBe(item.glbUrl);
		expect(slot.hasAttribute('src')).toBe(false);
		expect(slot.getAttribute('alt')).toBe('Michelle');
		expect(slot.hasAttribute('camera-controls')).toBe(true);
	});

	it('paints the active slide poster eagerly at high priority', () => {
		const slide = parse(heroSlideHtml(item, 0, 0));
		expect(slide.classList.contains('active')).toBe(true);
		const img = slide.querySelector('img.market-hero-poster');
		expect(img.getAttribute('src')).toBe(heroPosterUrl(item));
		expect(img.getAttribute('fetchpriority')).toBe('high');
		expect(img.getAttribute('loading')).not.toBe('lazy');
		expect(img.getAttribute('alt')).toBe('');
	});

	it('lets off-screen slides fetch their poster lazily', () => {
		const slide = parse(heroSlideHtml(item, 1, 0));
		expect(slide.classList.contains('active')).toBe(false);
		expect(slide.dataset.slot).toBe('1');
		const img = slide.querySelector('img.market-hero-poster');
		expect(img.getAttribute('loading')).toBe('lazy');
		expect(img.hasAttribute('fetchpriority')).toBe(false);
	});

	it('falls back to the initial placeholder when there is no picture', () => {
		const slide = parse(heroSlideHtml({ name: 'zed', glbUrl: item.glbUrl }, 0, 0));
		expect(slide.querySelector('img.market-hero-poster')).toBeNull();
		expect(slide.querySelector('.market-hero-placeholder-initial').textContent).toBe('Z');
	});

	it('escapes untrusted names and URLs', () => {
		const html = heroSlideHtml({ name: '<b>"x"</b>', glbUrl: 'https://three.ws/a.glb?"><script>', image: null }, 0, 0);
		expect(html).not.toContain('<b>');
		expect(html).not.toContain('<script>');
		expect(parse(html).querySelector('.market-hero-placeholder-name').textContent).toBe('<b>"x"</b>');
	});
});

// Found 2026-11-13 in the browser check: the live revision predates the /cdn/_v/
// handler, so every variant URL answered 404 and the active slide lost its
// poster outright, leaving only the initial. The poster now retries the
// untouched original before it gives up.
describe('wireHeroPoster', () => {
	function mount(html) {
		document.body.innerHTML = html;
		return document.body.querySelector('.market-hero-slide');
	}

	it('records the untouched original next to the sized variant', () => {
		const img = parse(heroSlideHtml(item, 0, 0)).querySelector('img.market-hero-poster');
		expect(img.dataset.original).toBe(item.image);
	});

	it('swaps to the original when the sized variant fails', () => {
		const slide = mount(heroSlideHtml(item, 0, 0));
		wireHeroPoster(slide);
		const img = slide.querySelector('img.market-hero-poster');
		img.dispatchEvent(new Event('error'));
		expect(slide.querySelector('img.market-hero-poster')).toBe(img);
		expect(img.getAttribute('src')).toBe(item.image);
	});

	it('drops the poster when the original fails too, so the initial shows', () => {
		const slide = mount(heroSlideHtml(item, 0, 0));
		wireHeroPoster(slide);
		const img = slide.querySelector('img.market-hero-poster');
		img.dispatchEvent(new Event('error'));
		img.dispatchEvent(new Event('error'));
		expect(slide.querySelector('img.market-hero-poster')).toBeNull();
		expect(slide.classList.contains('hero-poster-ready')).toBe(false);
	});

	it('marks the slide ready once the poster paints', () => {
		const slide = mount(heroSlideHtml(item, 0, 0));
		wireHeroPoster(slide);
		slide.querySelector('img.market-hero-poster').dispatchEvent(new Event('load'));
		expect(slide.classList.contains('hero-poster-ready')).toBe(true);
	});
});

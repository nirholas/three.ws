// Slide markup for the /marketplace hero carousel.
//
// The hero is poster-first. Each slide paints the avatar's stored thumbnail as
// a plain <img> in the first frame (served as a display-sized WebP through
// /cdn/_v/), and carries its viewer as an inert <model-slot> that becomes a
// real <model-viewer> only once the visitor engages with the hero (hover,
// focus or tap), the same contract the grid cards follow. Before this, the
// active slide shipped an eager <model-viewer> with no poster: every visit
// downloaded a ~2 MB GLB and parsed model-viewer during load while the stage
// showed only a shimmering initial (measured 2026-11-13, docs/site-performance.md).

import { modelSlotHtml } from './model-slot.js';
import { resizedImageUrl } from './image-url.js';

// The stage paints the poster with object-fit: contain into a box about 300 px
// tall on desktop, so 512 px stays sharp at 2x without paying for 768.
export const HERO_POSTER_WIDTH = 512;

function escapeHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
	);
}

function initialOf(name) {
	const s = String(name || '?').trim();
	return s ? s[0].toUpperCase() : '?';
}

/**
 * The poster for one featured avatar, or null when it has no picture.
 * @param {{ image?: string|null }} item
 * @returns {string|null}
 */
export function heroPosterUrl(item) {
	const src = item?.image;
	if (typeof src !== 'string' || !src) return null;
	return resizedImageUrl(src, HERO_POSTER_WIDTH);
}

/**
 * Markup for one hero slide.
 * @param {{ name?: string, glbUrl: string, image?: string|null }} item
 * @param {number} index this slide's position in the carousel
 * @param {number} activeIndex the slide on screen
 * @returns {string}
 */
export function heroSlideHtml(item, index, activeIndex) {
	const active = index === activeIndex;
	const name = item?.name || 'Avatar';
	const poster = heroPosterUrl(item);
	const original = poster && poster !== item.image ? ` data-original="${escapeHtml(item.image)}"` : '';
	const posterImg = poster
		? `<img class="market-hero-poster" src="${escapeHtml(poster)}"${original} alt="" decoding="async" ${
				active ? 'fetchpriority="high"' : 'loading="lazy"'
			} />`
		: '';
	const slot = modelSlotHtml({
		'data-src': item?.glbUrl || '',
		alt: name,
		autoplay: true,
		'rotation-per-second': '20deg',
		'camera-controls': true,
		'interaction-prompt': 'none',
		exposure: '1.05',
		'shadow-intensity': '0.8',
		'tone-mapping': 'aces',
		reveal: 'auto',
	});
	return `<div class="market-hero-slide${active ? ' active' : ''}" data-slot="${index}">
		<div class="market-hero-placeholder" aria-hidden="true">
			<span class="market-hero-placeholder-initial">${escapeHtml(initialOf(name))}</span>
			<span class="market-hero-placeholder-name">${escapeHtml(name)}</span>
		</div>
		${posterImg}
		${slot}
	</div>`;
}

/**
 * Wire one slide's poster: the slide covers its initial placeholder once the
 * picture paints. A sized variant that fails retries the untouched original
 * once (the variant route can lag a deploy or a cache); only when that fails
 * too is the image dropped, so the placeholder shows instead of a broken icon.
 * @param {Element} slide
 */
export function wireHeroPoster(slide) {
	const img = slide?.querySelector('img.market-hero-poster');
	if (!img) return;
	const ready = () => slide.classList.add('hero-poster-ready');
	if (img.complete && img.naturalWidth > 0) {
		ready();
		return;
	}
	img.addEventListener('load', ready);
	img.addEventListener('error', function onError() {
		const original = img.dataset.original;
		if (original) {
			delete img.dataset.original;
			img.setAttribute('src', original);
			return;
		}
		img.removeEventListener('error', onError);
		img.removeEventListener('load', ready);
		img.remove();
	});
}

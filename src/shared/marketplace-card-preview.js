// Preview strip markup for /marketplace grid cards.
//
// Pure string builders with no DOM access, so the card contract (what the
// visitor sees before any GLB has loaded) is unit-testable in Node.

import { resizedImageUrl } from './image-url.js';

function escapeHtml(s) {
	return String(s || '').replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
	);
}

function initial(name) {
	const s = String(name || '?').trim();
	return s ? s[0].toUpperCase() : '?';
}

// Name-initial placeholder rendered behind a model-viewer preview that has no
// stored thumbnail. Stays visible until model-viewer loads (then faded out via
// .mv-loaded), so cards and the hero never show a blank black void.
export function placeholderHtml(name) {
	const i = escapeHtml(initial(name || 'A'));
	return `<div class="mv-placeholder" aria-hidden="true"><span class="mv-placeholder-initial">${i}</span></div>`;
}

// A grid card's thumbnail, fetched at the size the card actually paints.
//
// Avatar and forge thumbnails are stored full-size on R2 (768x768 renders, and
// forge previews up to 344 KB each) and painted into a card 160-370 CSS px
// wide. On 2026-09-08 a Pixel 5 over slow 4G pulled 2,488 KB of images across
// 206 <img> elements opening /marketplace, which was 60% of the page's whole
// 4,141 KB. /api/img re-encodes to WebP at a fixed width ladder and caches the
// result immutably at the edge, so the same picture costs a tenth of that.
//
// srcset rather than one width because the card is 160px in a phone's two-up
// grid and 370px in its one-up, and a DPR-2 screen wants twice either; the
// browser is in a better position to choose than this function is. The `sizes`
// list mirrors public/marketplace.css's own grid breakpoints.
const CARD_THUMB_SIZES = '(max-width: 600px) 100vw, (max-width: 900px) 50vw, 300px';
export function cardThumbHtml(url, alt) {
	const srcset = [320, 480, 960]
		.map((w) => `${escapeHtml(resizedImageUrl(url, w))} ${w}w`)
		.join(', ');
	return (
		`<img src="${escapeHtml(resizedImageUrl(url, 480))}" srcset="${srcset}" sizes="${CARD_THUMB_SIZES}"` +
		` alt="${alt}" loading="lazy" decoding="async" data-fallback="element"` +
		` data-fallback-class="card-img-fallback" />`
	);
}

// Preview strip for an agent card.
//
// The base layer is what the visitor sees until they attend to the card: the
// stored thumbnail as a real <img> when there is one, the name placeholder
// otherwise. When the agent has a public avatar GLB a lazy model-viewer sits
// on top; it only fetches on hover/focus/tap (attendRotation) and fades in
// over the base layer once loaded (.mv-loaded). The thumbnail must not be a
// model-viewer `poster`: the grid's viewer is opacity:0 until it has loaded,
// so a poster is hidden with it and every card showed only its letter.
export function agentCardPreviewHtml(a) {
	const name = escapeHtml(a.name || 'Agent');
	const base = a.thumbnail_url ? cardThumbHtml(a.thumbnail_url, name) : placeholderHtml(a.name);
	if (!a.avatar_glb_url) return `<div class="thumb">${base}</div>`;
	return `<div class="thumb">${base}<model-viewer
				data-src="${escapeHtml(a.avatar_glb_url)}"
				alt="${name}"
				autoplay
				rotation-per-second="14deg"
				interaction-prompt="none"
				disable-zoom
				disable-pan
				disable-tap
				exposure="1"
				shadow-intensity="0.4"
				tone-mapping="aces"
				loading="lazy"
			></model-viewer></div>`;
}

// An inert stand-in for a <model-viewer> that should not exist yet.
//
// A page that defines <model-viewer> upgrades every one of those tags the
// moment it is inserted: shadow DOM, resize and intersection observers,
// renderer registration. That is about 32 ms per element on a mid-range phone
// (Pixel 5, 4x CPU) whether or not the element ever gets a model. /marketplace
// gave every card a viewer whose model only loads on hover, and re-rendered its
// grid three times while the feeds arrived, so one load constructed 90 viewers
// to keep 39: 2.9 s of main-thread blocking (measured 2026-11-13).
//
// A <model-slot> carries the viewer's attributes verbatim and costs what any
// unknown element costs. `materializeModelSlot` swaps it for the real
// <model-viewer> with the same attributes in the same place, at the moment the
// visitor engages with the card. An optional poster renders as a plain <img>
// child, so a card can still show a picture before the viewer exists.

export const MODEL_SLOT_TAG = 'model-slot';
export const MODEL_SLOT_READY_EVENT = 'model-slot-ready';

// Bookkeeping a page sets on the slot itself, never meant for the viewer.
const SLOT_ONLY_ATTRIBUTES = new Set(['aria-hidden', 'data-observed', 'data-poster-wired', 'data-slot-bound']);

function escapeAttr(s) {
	return String(s).replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
	);
}

/**
 * Markup for a deferred viewer.
 * @param {Record<string, string|boolean|null|undefined>} attrs the attributes the
 *   <model-viewer> will carry. `true` writes a bare boolean attribute; `false`,
 *   `null` and `undefined` are skipped. A `poster` also paints as an <img>.
 * @returns {string}
 */
export function modelSlotHtml(attrs) {
	let out = `<${MODEL_SLOT_TAG} aria-hidden="true"`;
	for (const [name, value] of Object.entries(attrs || {})) {
		if (value === false || value === null || value === undefined) continue;
		out += value === true ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`;
	}
	out += '>';
	if (attrs?.poster) out += posterImgHtml(attrs.poster);
	return `${out}</${MODEL_SLOT_TAG}>`;
}

function posterImgHtml(src) {
	return `<img class="model-slot-poster" src="${escapeAttr(src)}" alt="" loading="lazy" decoding="async" />`;
}

/**
 * Show `src` as the slot's poster (and the viewer's, once it exists).
 * @param {Element} slot
 * @param {string} src
 */
export function setModelSlotPoster(slot, src) {
	slot.setAttribute('poster', src);
	const img = slot.querySelector(':scope > img.model-slot-poster');
	if (img) img.setAttribute('src', src);
	else slot.insertAdjacentHTML('afterbegin', posterImgHtml(src));
}

/**
 * Replace a <model-slot> with a <model-viewer> carrying the same attributes,
 * then announce it with a bubbling `model-slot-ready` event whose
 * `detail.viewer` is the new element. Anything that is not a connected slot is
 * returned unchanged, so calling this twice is harmless.
 * @param {Element} slot
 * @returns {Element} the <model-viewer>, or `slot` when there was nothing to do
 */
export function materializeModelSlot(slot) {
	if (!slot || slot.localName !== MODEL_SLOT_TAG || !slot.isConnected) return slot;
	const viewer = slot.ownerDocument.createElement('model-viewer');
	for (const { name, value } of Array.from(slot.attributes)) {
		if (!SLOT_ONLY_ATTRIBUTES.has(name)) viewer.setAttribute(name, value);
	}
	slot.replaceWith(viewer);
	viewer.dispatchEvent(new CustomEvent(MODEL_SLOT_READY_EVENT, { bubbles: true, detail: { viewer } }));
	return viewer;
}

// @vitest-environment jsdom
//
// src/shared/model-slot.js: the inert stand-in /marketplace cards carry instead
// of a <model-viewer> until someone engages with the card. See the module
// header for the measurement behind it.

import { describe, it, expect } from 'vitest';
import { modelSlotHtml, materializeModelSlot, setModelSlotPoster, MODEL_SLOT_READY_EVENT } from '../src/shared/model-slot.js';

const GLB = 'https://three.ws/cdn/forge/9b86c6f92389/3c37961e.glb';

describe('modelSlotHtml', () => {
	it('writes every attribute onto an inert element, never a model-viewer', () => {
		const html = modelSlotHtml({ 'data-src': GLB, alt: 'A "quoted" <name>', autoplay: true, 'disable-zoom': true, exposure: '1', skip: false, none: null });
		expect(html).not.toContain('<model-viewer');
		expect(html.startsWith('<model-slot aria-hidden="true"')).toBe(true);
		expect(html).toContain(`data-src="${GLB}"`);
		expect(html).toContain('alt="A &quot;quoted&quot; &lt;name&gt;"');
		expect(html).toMatch(/ autoplay[ >]/);
		expect(html).not.toContain('skip');
		expect(html).not.toContain('none');
		expect(html).not.toContain('<img');
	});

	it('paints a poster as a visible <img> child', () => {
		const html = modelSlotHtml({ 'data-src': GLB, poster: '/api/img?url=x&w=264' });
		expect(html).toContain('<img class="model-slot-poster" src="/api/img?url=x&amp;w=264" alt=""');
	});
});

describe('materializeModelSlot', () => {
	it('swaps the slot for a model-viewer with the same attributes, in place, and announces it', () => {
		document.body.innerHTML = `<div class="card"><span class="before"></span>${modelSlotHtml({ 'data-src': GLB, alt: 'Agent', autoplay: true, poster: '/p.webp' })}<span class="after"></span></div>`;
		const card = document.querySelector('.card');
		const slot = card.querySelector('model-slot');
		slot.dataset.observed = '1';
		slot.dataset.posterWired = '1';
		let announced = null;
		card.addEventListener(MODEL_SLOT_READY_EVENT, (e) => { announced = e.detail.viewer; });

		const mv = materializeModelSlot(slot);

		expect(mv.localName).toBe('model-viewer');
		expect(announced).toBe(mv);
		expect(card.querySelector('model-slot')).toBeNull();
		expect(mv.previousElementSibling.className).toBe('before');
		expect(mv.nextElementSibling.className).toBe('after');
		expect(mv.dataset.src).toBe(GLB);
		expect(mv.getAttribute('alt')).toBe('Agent');
		expect(mv.hasAttribute('autoplay')).toBe(true);
		expect(mv.getAttribute('poster')).toBe('/p.webp');
		// The slot's own bookkeeping stays behind.
		expect(mv.hasAttribute('aria-hidden')).toBe(false);
		expect(mv.dataset.observed).toBeUndefined();
		expect(mv.dataset.posterWired).toBeUndefined();
		// The poster <img> belonged to the stand-in; the viewer draws its own.
		expect(mv.children.length).toBe(0);
	});

	it('is a no-op on anything that is not a connected slot', () => {
		document.body.innerHTML = modelSlotHtml({ 'data-src': GLB });
		const slot = document.querySelector('model-slot');
		const mv = materializeModelSlot(slot);
		expect(materializeModelSlot(mv)).toBe(mv);
		expect(materializeModelSlot(slot)).toBe(slot);
		expect(document.querySelectorAll('model-viewer').length).toBe(1);
	});
});

describe('setModelSlotPoster', () => {
	it('adds the poster image once and updates it in place after that', () => {
		document.body.innerHTML = modelSlotHtml({ 'data-src': GLB });
		const slot = document.querySelector('model-slot');
		setModelSlotPoster(slot, 'blob:one');
		setModelSlotPoster(slot, 'blob:two');
		const imgs = slot.querySelectorAll('img.model-slot-poster');
		expect(imgs.length).toBe(1);
		expect(imgs[0].getAttribute('src')).toBe('blob:two');
		expect(slot.getAttribute('poster')).toBe('blob:two');
	});
});

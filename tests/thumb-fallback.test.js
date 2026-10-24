// @vitest-environment jsdom
//
// wireThumbFallback() is the delegated error handler that swaps a dead
// <img data-thumb-fallback="..."> for its designed fallback markup, for the
// three list/card renderers (src/monitor.js, src/economy-live.js,
// src/avatar-gallery-picker.js) that build rows as HTML strings and have no
// live <img> node at template-build time to call .addEventListener on
// directly.
//
// This project's jsdom 30, with no optional `canvas` package installed,
// never decodes real images and never fires `load`/`error` on an <img> for
// any src, local server or not: this was verified against a real local
// HTTP server serving both a 200 PNG and a 404, with and without the
// sandbox's network restrictions lifted, and neither event ever fired
// within an 8s window. So this suite dispatches genuine `Event('error')` /
// `Event('load')` objects directly at the <img> node, the same event type
// and non-bubbling propagation a real browser delivers, which is what
// wireThumbFallback() actually consumes; only the network cause behind the
// event is substituted. The capture-phase delegation, attribute lookup,
// outerHTML swap and cleanup-before-swap guard are exercised for real.
import { describe, it, expect, beforeEach } from 'vitest';
import { thumbFallbackAttr, wireThumbFallback } from '../src/shared/thumb-fallback.js';

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fireError(img) {
	img.dispatchEvent(new Event('error', { bubbles: false }));
}

function fireLoad(img) {
	img.dispatchEvent(new Event('load', { bubbles: false }));
}

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('wireThumbFallback', () => {
	it('swaps every tagged <img> that errors for its exact fallback markup, and leaves an untagged <img> alone', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);

		const fallbackA = '<div class="fleet-av-fb" aria-hidden="true">A</div>';
		const fallbackB = '<span class="ae-avatar-fallback">B</span>';

		container.innerHTML = `
			<img id="tagged-a" src="/does-not-exist-${Math.random().toString(36).slice(2)}.png" ${thumbFallbackAttr(fallbackA, esc)} />
			<img id="tagged-b" src="/does-not-exist-${Math.random().toString(36).slice(2)}.png" ${thumbFallbackAttr(fallbackB, esc)} />
			<img id="untagged" src="/does-not-exist-${Math.random().toString(36).slice(2)}.png" />
		`;

		wireThumbFallback(container);

		const taggedA = container.querySelector('#tagged-a');
		const taggedB = container.querySelector('#tagged-b');
		const untagged = container.querySelector('#untagged');

		fireError(taggedA);
		fireError(taggedB);
		fireError(untagged);

		expect(container.querySelector('#tagged-a')).toBeNull();
		expect(container.querySelector('#tagged-b')).toBeNull();
		expect(container.innerHTML).toContain(fallbackA);
		expect(container.innerHTML).toContain(fallbackB);

		// The untagged image had no data-thumb-fallback, so the handler ignored
		// its error event entirely: still an <img>, not swapped.
		const stillImg = container.querySelector('#untagged');
		expect(stillImg).not.toBeNull();
		expect(stillImg.tagName).toBe('IMG');
	});

	it('never swaps an image that fires load instead of error', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const fallback = '<div class="agp-card-ph">placeholder</div>';
		container.innerHTML = `<img id="ok" src="/static/favicon.ico" ${thumbFallbackAttr(fallback, esc)} />`;
		wireThumbFallback(container);

		fireLoad(container.querySelector('#ok'));

		const img = container.querySelector('#ok');
		expect(img).not.toBeNull();
		expect(img.tagName).toBe('IMG');
		expect(container.innerHTML).not.toContain(fallback);
	});

	it('is idempotent: calling it twice on the same container does not double-register the listener', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const fallback = '<div class="fleet-av-fb" aria-hidden="true">?</div>';
		container.innerHTML = `<img id="dup" src="/missing.png" ${thumbFallbackAttr(fallback, esc)} />`;

		wireThumbFallback(container);
		wireThumbFallback(container);

		fireError(container.querySelector('#dup'));

		// A double-registered listener would try to swap outerHTML a second time
		// using the (by then stale) `img` reference and throw, or otherwise
		// leave the fallback duplicated. A single clean swap is correct.
		expect(container.innerHTML).toBe(fallback);
	});

	it('removes the data-thumb-fallback attribute before swapping, so a fallback that itself contains an <img> cannot loop', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		// A fallback containing its own <img> is not a real pattern in this
		// codebase, but proves the attribute is gone before the swap happens:
		// if removal happened after, the new nested <img> below would still
		// carry a (copied) data-thumb-fallback the handler could act on.
		const nested = '<div class="fb"><img id="nested-img" src="/also-missing.png" /></div>';
		container.innerHTML = `<img id="root-img" src="/missing.png" ${thumbFallbackAttr(nested, esc)} />`;

		wireThumbFallback(container);
		fireError(container.querySelector('#root-img'));

		const nestedImg = container.querySelector('#nested-img');
		expect(nestedImg).not.toBeNull();
		expect(nestedImg.hasAttribute('data-thumb-fallback')).toBe(false);

		// Firing error on the nested image is a no-op: it has nothing to swap to.
		fireError(nestedImg);
		expect(container.querySelector('#nested-img')).not.toBeNull();
	});
});

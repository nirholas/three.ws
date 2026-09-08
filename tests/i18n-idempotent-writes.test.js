// @vitest-environment jsdom
//
// The catalog pass must not rewrite a node that already holds the catalog's
// value. On the default locale that is nearly every node on the page: the markup
// ships the English source and the English catalog hands the same string back.
//
// The cost is Largest Contentful Paint. Replacing an element's text destroys its
// text node and creates a new one, and Chrome scores that as a fresh LCP
// candidate at the moment it happens. The catalog lands after an async fetch, so
// on a phone every page's LCP was re-dated to the i18n pass: measured on a Pixel
// 5 over slow 4G against production on 2026-09-08, `/` reported LCP 10,188 ms on
// `h1.hero-h`, a static heading, against an FCP of 2,336 ms.
//
// These tests pin the identity guard by node identity, not by value: the
// assertion is that the ORIGINAL node survives, which is the only thing the
// browser's LCP bookkeeping cares about.

import { describe, it, expect, beforeEach } from 'vitest';
import { applyCatalog } from '../src/i18n.js';

// An "English catalog": every key resolves to the source text already in the DOM.
const identity = (map) => (key) => (key in map ? map[key] : key);

describe('applyCatalog leaves an already-correct node alone', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('keeps the same text node when data-i18n resolves to what is there', () => {
		document.body.innerHTML = '<p data-i18n="a.b">Already right.</p>';
		const el = document.querySelector('p');
		const before = el.firstChild;
		applyCatalog(document, identity({ 'a.b': 'Already right.' }));
		expect(el.firstChild).toBe(before);
		expect(el.textContent).toBe('Already right.');
	});

	it('still replaces the text node when the translation differs', () => {
		document.body.innerHTML = '<p data-i18n="a.b">Already right.</p>';
		const el = document.querySelector('p');
		const before = el.firstChild;
		applyCatalog(document, identity({ 'a.b': 'Ya está bien.' }));
		expect(el.firstChild).not.toBe(before);
		expect(el.textContent).toBe('Ya está bien.');
	});

	it('keeps the same child nodes when data-i18n-html round-trips to what is there', () => {
		// The raw catalog string is deliberately NOT byte-identical to the DOM's
		// serialization (self-closing tag, single-quoted attribute). The guard has
		// to normalize before comparing or it never matches and the whole fix is
		// dead code that still looks present.
		document.body.innerHTML = '<h1 data-i18n-html="h.1">The 3D agent<br>layer.</h1>';
		const el = document.querySelector('h1');
		const before = [...el.childNodes];
		applyCatalog(document, identity({ 'h.1': "The 3D agent<br/>layer." }));
		expect([...el.childNodes]).toEqual(before);
	});

	it('still replaces markup when the translation differs', () => {
		document.body.innerHTML = '<h1 data-i18n-html="h.1">The 3D agent<br>layer.</h1>';
		const el = document.querySelector('h1');
		const before = el.firstChild;
		applyCatalog(document, identity({ 'h.1': 'La capa<br/>de agentes 3D.' }));
		expect(el.firstChild).not.toBe(before);
		expect(el.textContent).toBe('La capade agentes 3D.');
	});

	it('does not re-set an attribute that already holds the catalog value', () => {
		document.body.innerHTML =
			'<img data-i18n-attr="alt:i.alt" alt="A 3D agent" src="/x.png" />';
		const el = document.querySelector('img');
		let writes = 0;
		const observer = new MutationObserver((records) => {
			writes += records.length;
		});
		observer.observe(el, { attributes: true });
		applyCatalog(document, identity({ 'i.alt': 'A 3D agent' }));
		// MutationObserver delivers asynchronously; a microtask is enough.
		return Promise.resolve().then(() => {
			observer.disconnect();
			expect(writes).toBe(0);
			expect(el.getAttribute('alt')).toBe('A 3D agent');
		});
	});

	it('still writes an attribute whose translation differs', () => {
		document.body.innerHTML =
			'<img data-i18n-attr="alt:i.alt" alt="A 3D agent" src="/x.png" />';
		applyCatalog(document, identity({ 'i.alt': 'Un agente 3D' }));
		expect(document.querySelector('img').getAttribute('alt')).toBe('Un agente 3D');
	});
});

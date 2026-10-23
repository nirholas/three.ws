// The single address formatter (src/shared/address.js) and the shared modal
// focus trap (src/shared/focus-trap.js). Every address-shortening helper in
// src/ routes through shortAddress, so these pin the contract for all of them.

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { shortAddress, spokenAddress, addressHtml, addressElement } from '../src/shared/address.js';
import { trapFocus } from '../src/shared/focus-trap.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

describe('shortAddress', () => {
	it('keeps head and tail around an ellipsis', () => {
		expect(shortAddress(THREE_MINT)).toBe('FeMb…pump');
		expect(shortAddress(THREE_MINT, 6, 4)).toBe('FeMbDo…pump');
	});
	it('honours head, tail and separator', () => {
		expect(shortAddress(EVM, 6, 4)).toBe('0x742d…f44e');
		expect(shortAddress(EVM, 6, 4, { sep: '...' })).toBe('0x742d...f44e');
	});
	it('returns short and empty values unharmed', () => {
		expect(shortAddress('abc')).toBe('abc');
		expect(shortAddress(null)).toBe('');
		expect(shortAddress('', 4, 4, { empty: 'none' })).toBe('none');
	});
});

describe('spokenAddress', () => {
	it('groups by four and round-trips', () => {
		const s = spokenAddress(THREE_MINT);
		expect(s.replace(/ /g, '')).toBe(THREE_MINT);
		expect(s.split(' ').every((g) => g.length <= 4)).toBe(true);
	});
	it('keeps 0x as its own group', () => {
		expect(spokenAddress(EVM).startsWith('0x 742d 35Cc')).toBe(true);
	});
	it('is empty for nothing', () => {
		expect(spokenAddress(undefined)).toBe('');
	});
});

describe('addressHtml / addressElement', () => {
	it('draws the short form, announces the chunked full value, titles the full value', () => {
		const el = addressElement(THREE_MINT, { label: 'Token mint' });
		expect(el.getAttribute('title')).toBe(THREE_MINT);
		expect(el.getAttribute('translate')).toBe('no');
		expect(el.querySelector('[aria-hidden="true"]').textContent).toBe(shortAddress(THREE_MINT));
		expect(el.textContent).toContain('Token mint: ' + spokenAddress(THREE_MINT));
	});
	it('escapes hostile input', () => {
		const html = addressHtml('"><img src=x onerror=alert(1)>', { label: '<b>' });
		const host = document.createElement('div');
		host.innerHTML = html;
		expect(host.querySelector('img')).toBeNull();
		expect(host.querySelector('b')).toBeNull();
	});
	it('renders the empty text when there is no value', () => {
		expect(addressHtml(null, { empty: 'No wallet' })).toBe('No wallet');
	});
});

describe('trapFocus', () => {
	let opener, bg, dialog, a, b;
	beforeEach(() => {
		document.body.innerHTML = `
			<main id="bg"><button id="opener">Open</button></main>
			<div id="dialog"><button id="a">A</button><button id="b">B</button></div>`;
		opener = document.getElementById('opener');
		bg = document.getElementById('bg');
		dialog = document.getElementById('dialog');
		a = document.getElementById('a');
		b = document.getElementById('b');
		for (const el of [a, b, opener]) el.getClientRects = () => [{}];
		opener.focus();
	});

	it('makes the background inert and restores only what it changed', () => {
		const t = trapFocus(dialog);
		expect(bg.hasAttribute('inert')).toBe(true);
		expect(dialog.hasAttribute('inert')).toBe(false);
		t.release();
		expect(bg.hasAttribute('inert')).toBe(false);
	});

	it('wraps Tab and Shift+Tab inside the dialog', () => {
		const t = trapFocus(dialog, { initialFocus: a });
		expect(document.activeElement).toBe(a);
		b.focus();
		const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		document.dispatchEvent(tab);
		expect(tab.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(a);
		const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
		document.dispatchEvent(back);
		expect(document.activeElement).toBe(b);
		t.release(false);
	});

	it('calls onEscape and returns focus to the opener on release', () => {
		let escaped = 0;
		const t = trapFocus(dialog, { onEscape: () => escaped++, initialFocus: a });
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		expect(escaped).toBe(1);
		t.release();
		expect(document.activeElement).toBe(opener);
	});

	it('release is idempotent and stops handling keys', () => {
		let escaped = 0;
		const t = trapFocus(dialog, { onEscape: () => escaped++ });
		t.release();
		t.release();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(escaped).toBe(0);
	});
});

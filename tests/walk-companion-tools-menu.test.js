// @vitest-environment jsdom
//
// The phone tools drawer for the corner companion (src/walk-companion-tools-menu.js).
// On a 112px phone companion five settings controls overlapped in one row; the
// drawer collapses them behind one button. These tests pin the behavior that
// CSS alone cannot: the toggle state, idempotent mounting across host rebuilds,
// and the three ways the drawer closes.

import { describe, it, expect, beforeEach } from 'vitest';
import { ensureToolsMenu, OPEN_CLASS, TOOL_CLASSES } from '../src/walk-companion-tools-menu.js';

function makeHost() {
	const host = document.createElement('div');
	host.className = 'walk-companion';
	for (const cls of TOOL_CLASSES) {
		const b = document.createElement('button');
		b.className = cls;
		// Mirrors feedback-companion.js: its click handler stops propagation.
		b.addEventListener('click', (e) => e.stopPropagation());
		host.appendChild(b);
	}
	document.body.appendChild(host);
	return host;
}

describe('companion phone tools drawer', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('mounts one closed toggle button and a phone-scoped stylesheet', () => {
		const host = makeHost();
		ensureToolsMenu(host);
		ensureToolsMenu(host);
		const btns = host.querySelectorAll('.walk-companion-tools');
		expect(btns).toHaveLength(1);
		expect(btns[0].getAttribute('aria-expanded')).toBe('false');
		expect(btns[0].getAttribute('aria-label')).toBe('More companion controls');
		expect(host.classList.contains(OPEN_CLASS)).toBe(false);
		const css = document.getElementById('walk-companion-tools-style').textContent;
		// Every hiding rule must live inside the phone query so desktop keeps its row.
		const phone = css.indexOf('@media (max-width:520px)');
		expect(phone).toBeGreaterThan(-1);
		for (const cls of TOOL_CLASSES) expect(css.indexOf(`.walk-companion .${cls}`)).toBeGreaterThan(phone);
	});

	it('toggles open and closed from its button', () => {
		const host = makeHost();
		ensureToolsMenu(host);
		const btn = host.querySelector('.walk-companion-tools');
		btn.click();
		expect(host.classList.contains(OPEN_CLASS)).toBe(true);
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		btn.click();
		expect(host.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it('closes on a tap outside the companion but not on a tap inside it', () => {
		const host = makeHost();
		ensureToolsMenu(host);
		host.querySelector('.walk-companion-tools').click();
		host.querySelector('.walk-companion-trail').dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(host.classList.contains(OPEN_CLASS)).toBe(true);
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(host.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it('closes on Escape and returns focus to the toggle', () => {
		const host = makeHost();
		ensureToolsMenu(host);
		const btn = host.querySelector('.walk-companion-tools');
		// jsdom applies the desktop display:none rule but cannot match the phone
		// media query that shows the button, and it refuses focus to hidden
		// elements. Drop the sheet so the button is focusable as on a phone.
		document.getElementById('walk-companion-tools-style').remove();
		btn.click();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(host.classList.contains(OPEN_CLASS)).toBe(false);
		expect(document.activeElement).toBe(btn);
	});

	it('gets out of the way when the feedback control opens its panel', () => {
		const host = makeHost();
		ensureToolsMenu(host);
		host.querySelector('.walk-companion-tools').click();
		host.querySelector('.walk-companion-feedback').click();
		expect(host.classList.contains(OPEN_CLASS)).toBe(false);
	});

	it('mounts on a rebuilt host after an avatar swap', () => {
		const first = makeHost();
		ensureToolsMenu(first);
		first.remove();
		const second = makeHost();
		ensureToolsMenu(second);
		expect(second.querySelectorAll('.walk-companion-tools')).toHaveLength(1);
		second.querySelector('.walk-companion-tools').click();
		expect(second.classList.contains(OPEN_CLASS)).toBe(true);
	});
});

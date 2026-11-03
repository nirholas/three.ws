// @vitest-environment jsdom
//
// Meetup #3 client audit (accessibility): the cash counter in the world HUD
// changed silently, so a screen-reader player never learned that a job paid out
// or a purchase spent. Every change after the first snapshot is now spoken
// through the shared polite live region (a11y.js announce()).

import { describe, it, expect, beforeEach, vi } from 'vitest';

HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });

let WorldHud;
beforeEach(async () => {
	document.body.innerHTML = '';
	vi.resetModules();
	({ WorldHud } = await import('../src/game/hud/world-hud.js'));
});

const live = () => document.querySelector('[aria-live="polite"].cc-sr-live')?.textContent.replace(/​/g, '') || '';

describe('world HUD cash announcements', () => {
	it('stays quiet on the first snapshot, then speaks each change with the new total', () => {
		const hud = new WorldHud();
		hud.setCash(1200, { animate: false });
		expect(live()).toBe('');
		hud.setCash(1450);
		expect(live()).toMatch(/\+\$250/);
		expect(live()).toMatch(/\$1,450/);
		hud.setCash(1000);
		expect(live()).toMatch(/-\$450/);
	});

	it('does not repeat an unchanged total', () => {
		const hud = new WorldHud();
		hud.setCash(50, { animate: false });
		hud.setCash(80);
		const first = live();
		hud.setCash(80);
		expect(live()).toBe(first);
	});
});

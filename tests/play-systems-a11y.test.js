// @vitest-environment jsdom
//
// Keyboard and screen-reader contract for the PlaySystems HUD (backpack, skills,
// My Cosmetics, the gold purse). Audit 09 for Meetup #3 found two gaps:
//
//   1. The three side panels had no keyboard way out. They are deliberately not
//      on the modal Escape stack (a player keeps the backpack open while walking,
//      and the stack would mute every world hotkey), so Escape did nothing.
//   2. The always-visible gold purse changed silently. Gold from fishing, jobs or
//      the wheel only reached a screen reader while the Store or Bank was open.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Scene } from 'three';
import { PlaySystems } from '../src/game/play-systems.js';

function make() {
	const net = { on: vi.fn(() => () => {}), spinInfo: vi.fn() };
	const ui = { toast: vi.fn() };
	return new PlaySystems({ scene: new Scene(), getPlayer: () => ({ x: 0, y: 0, z: 0, yaw: 0, height: 1.7 }), net, ui });
}

const politeText = () => document.querySelector('.cc-sr-live[aria-live="polite"]')?.textContent.replace(/​/g, '') || '';

const snap = (gold) => ({ gold, hp: 10, maxHp: 10, inv: [], hotbar: [], activeSlot: -1, skills: {}, cosmetics: { owned: [], equipped: {} } });

describe('PlaySystems side panels and Escape', () => {
	beforeEach(() => { document.body.innerHTML = ''; });

	it('closes the most recently opened side panel, one per press', () => {
		const ps = make();
		ps.toggleInventory(true);
		ps.toggleSkills(true);
		expect(ps.invPanel.hidden).toBe(false);
		expect(ps.skillsPanel.hidden).toBe(false);

		expect(ps.closeTopPanel()).toBe(true);
		expect(ps.skillsPanel.hidden).toBe(true);
		expect(ps.invPanel.hidden).toBe(false);

		expect(ps.closeTopPanel()).toBe(true);
		expect(ps.invPanel.hidden).toBe(true);

		// Nothing open: Escape is not consumed, so the world can use it.
		expect(ps.closeTopPanel()).toBe(false);
	});

	it('honours a panel closed by its own button before Escape reaches it', () => {
		const ps = make();
		ps.toggleCosmetics(true);
		ps.toggleInventory(true);
		ps.toggleInventory(false);
		expect(ps.closeTopPanel()).toBe(true);
		expect(ps.cosPanel.hidden).toBe(true);
		expect(ps.closeTopPanel()).toBe(false);
	});

	it('returns focus to the rail button that opened the panel', () => {
		const ps = make();
		ps.invBtn.focus();
		ps.toggleInventory(true);
		ps.invPanel.querySelector('.ps-x').focus();
		ps.closeTopPanel();
		expect(document.activeElement).toBe(ps.invBtn);
	});
});

describe('PlaySystems gold purse announces changes', () => {
	beforeEach(() => { document.body.innerHTML = ''; });

	it('stays quiet on the first snapshot, then announces each change with the new total', () => {
		const ps = make();
		ps.setProfile(snap(120));
		expect(politeText()).toBe('');
		ps.setProfile(snap(145));
		expect(politeText()).toMatch(/\+25 gold/);
		expect(politeText()).toMatch(/145/);
		ps.setProfile(snap(100));
		expect(politeText()).toMatch(/-45 gold/);
	});

	it('hides the decorative coin glyph from assistive tech', () => {
		const ps = make();
		expect(ps.gold.querySelector('.ps-gold-coin').getAttribute('aria-hidden')).toBe('true');
	});
});

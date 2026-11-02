// @vitest-environment jsdom
//
// Halloween Weekend 2026 and the Autumn 2026 look that follows it: the windows,
// the wallpaper rules, the /play grant and the classic homepage look.
//
// The server (api/_lib/seasonal-drops.js) is the only authority on claims, but
// three clients theme themselves from their own copy of the window: the shared
// module (desktop and /halloween), and the self-contained classic IIFE
// (public/seasonal.js). If any copy drifts, a page would show "claim now" while
// the server refuses, so these tests pin all of them to the server's instants.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: () => Promise.resolve([]) }));
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));

const server = await import('../api/_lib/seasonal-drops.js');
const shared = await import('../src/shared/seasonal-drops.js');
const desk = await import('../src/desktop/seasonal.js');
const { COSMETICS_BY_ID, SLOT_LABELS } = await import('../multiplayer/src/cosmetics-catalog.js');
const { newProfile, mergeGrantedFromLedger, ownedCosmeticSet } = await import('../multiplayer/src/economy.js');

const ROOT = resolve(__dirname, '..');
const CLASSIC = readFileSync(resolve(ROOT, 'public/seasonal.js'), 'utf8');
const { startsAt, endsAt } = server.HALLOWEEN_2026;
const START = Date.parse(startsAt);
const END = Date.parse(endsAt);
const AUTUMN_END = Date.parse(shared.AUTUMN_2026.endsAt);

describe('one window everywhere', () => {
	it('shared client mirror matches the server', () => {
		expect(shared.HALLOWEEN_2026.id).toBe(server.HALLOWEEN_2026.id);
		expect(shared.HALLOWEEN_2026.startsAt).toBe(startsAt);
		expect(shared.HALLOWEEN_2026.endsAt).toBe(endsAt);
	});

	it('the classic homepage IIFE carries the same instants', () => {
		expect(CLASSIC).toContain(`Date.parse('${startsAt}')`);
		expect(CLASSIC).toContain(`Date.parse('${endsAt}')`);
	});

	it('covers the whole weekend in every timezone', () => {
		// Saturday 00:00 at UTC+14 and Sunday 24:00 at UTC-12.
		expect(START).toBe(Date.UTC(2026, 9, 31, 0) - 14 * 3600e3);
		expect(END).toBe(Date.UTC(2026, 10, 2, 0) + 12 * 3600e3);
	});

	it('server and client agree on the phase at both edges', () => {
		for (const t of [START - 1, START, END - 1, END]) {
			expect(shared.dropPhase(shared.HALLOWEEN_2026, t)).toBe(server.dropPhase(server.HALLOWEEN_2026, t));
		}
		expect(server.dropPhase(server.HALLOWEEN_2026, START - 1)).toBe('upcoming');
		expect(server.dropPhase(server.HALLOWEEN_2026, START)).toBe('live');
		expect(server.dropPhase(server.HALLOWEEN_2026, END)).toBe('ended');
	});
});

describe('autumn follows Halloween', () => {
	it('starts the instant Halloween ends and runs through November', () => {
		expect(shared.AUTUMN_2026.startsAt).toBe(endsAt);
		expect(AUTUMN_END).toBe(Date.UTC(2026, 11, 1, 12));
	});

	it('exactly one season is live on each side of the handover, none after November', () => {
		expect(desk.activeSeason(END - 1)?.id).toBe('halloween');
		expect(desk.activeSeason(END)?.id).toBe('autumn');
		expect(desk.activeSeason(AUTUMN_END - 1)?.id).toBe('autumn');
		expect(desk.activeSeason(AUTUMN_END)).toBeNull();
		expect(desk.activeSeason(START - 1)).toBeNull();
	});

	it('the classic homepage IIFE carries the autumn instants', () => {
		expect(CLASSIC).toContain(`Date.parse('${shared.AUTUMN_2026.startsAt}')`);
		expect(CLASSIC).toContain(`Date.parse('${shared.AUTUMN_2026.endsAt}')`);
		expect(CLASSIC).toContain(`'${shared.AUTUMN_LOOK_OFF_FLAG}'`);
	});

	it('ships the harvest wallpaper', () => {
		expect(() => readFileSync(resolve(ROOT, 'public/wallpapers/harvest.svg'))).not.toThrow();
	});

	it('the autumn opt-out is its own switch, separate from Halloween', () => {
		localStorage.clear();
		shared.setSeasonalLookEnabled(false);
		expect(shared.autumnLookEnabled()).toBe(true);
		shared.setAutumnLookEnabled(false);
		expect(shared.autumnLookEnabled()).toBe(false);
		expect(desk.seasonState(END + 1).lookOn).toBe(false);
		shared.setAutumnLookEnabled(true);
		expect(desk.seasonState(END + 1)).toMatchObject({ seasonWall: 'harvest', lookOn: true, live: false });
		localStorage.clear();
	});
});

describe('claims', () => {
	it('refuses a first claim outside the window without touching storage', async () => {
		await expect(server.claimDrop('u1', server.HALLOWEEN_2026, START - 1)).resolves.toEqual({ ok: false, reason: 'upcoming' });
		await expect(server.claimDrop('u1', server.HALLOWEEN_2026, END)).resolves.toEqual({ ok: false, reason: 'ended' });
	});

	it('grants exactly the two event wearables, which /play knows as headwear and aura', () => {
		const ids = server.dropCosmeticIds(server.HALLOWEEN_2026);
		expect(ids).toEqual(['pumpkin-cap-halloween-2026', 'aura-witchlight-halloween-2026']);
		const slots = ids.map((id) => COSMETICS_BY_ID.get(id));
		expect(slots.map((c) => c?.tier)).toEqual(['event', 'event']);
		expect(slots.map((c) => SLOT_LABELS[c.slot])).toEqual(['Headwear', 'Aura']);
	});

	it('ships the 3D model and thumbnail the gift cards point at', () => {
		const cap = server.HALLOWEEN_2026.gifts.find((g) => g.id === 'pumpkin-cap-halloween-2026');
		for (const p of [cap.model, cap.thumb, '/wallpapers/haunted.svg', '/fonts/creepster.css']) {
			expect(() => readFileSync(resolve(ROOT, 'public', p.slice(1)))).not.toThrow();
		}
	});
});

describe('/play grant ledger merge', () => {
	it('adds event gifts and ignores anything that is not event tier', () => {
		const profile = newProfile('p1');
		const premium = [...COSMETICS_BY_ID.values()].find((c) => c.tier !== 'event' && c.tier !== 'free');
		const n = mergeGrantedFromLedger(profile, ['pumpkin-cap-halloween-2026', 'aura-witchlight-halloween-2026', premium?.id, 'nope']);
		expect(n).toBe(2);
		const owned = ownedCosmeticSet(profile);
		expect(owned.has('pumpkin-cap-halloween-2026')).toBe(true);
		expect(owned.has('aura-witchlight-halloween-2026')).toBe(true);
		if (premium) expect(owned.has(premium.id)).toBe(false);
	});

	it('is idempotent across joins', () => {
		const profile = newProfile('p1');
		mergeGrantedFromLedger(profile, ['pumpkin-cap-halloween-2026']);
		expect(mergeGrantedFromLedger(profile, ['pumpkin-cap-halloween-2026'])).toBe(0);
	});
});

describe('desktop wallpaper rules', () => {
	const base = { customId: 'custom', fallback: 'horizon' };

	const halloween = { ...base, seasonWall: 'haunted', live: true };

	it('paints haunted over a built-in wallpaper while live with the look on', () => {
		expect(desk.pickWall('horizon', { ...halloween, lookOn: true, claimed: false })).toBe('haunted');
	});

	it('never paints over a personal photo', () => {
		expect(desk.pickWall('custom', { ...halloween, lookOn: true, claimed: false })).toBe('custom');
		expect(desk.pickWall('custom', { ...base, seasonWall: 'harvest', live: false, lookOn: true, claimed: false })).toBe('custom');
	});

	it('respects the look switched off', () => {
		expect(desk.pickWall('horizon', { ...halloween, lookOn: false, claimed: false })).toBe('horizon');
	});

	it('paints harvest over a built-in wallpaper during autumn, even over a kept haunted', () => {
		const autumn = { ...base, seasonWall: 'harvest', live: false, lookOn: true };
		expect(desk.pickWall('horizon', { ...autumn, claimed: false })).toBe('harvest');
		expect(desk.pickWall('haunted', { ...autumn, claimed: true })).toBe('harvest');
	});

	it('keeps harvest as an ordinary choice once the look is off or autumn is over', () => {
		expect(desk.pickWall('harvest', { ...base, seasonWall: null, live: false, lookOn: false, claimed: false })).toBe('harvest');
	});

	it('keeps haunted for claimers after the weekend and falls back for everyone else', () => {
		expect(desk.pickWall('haunted', { ...base, live: false, lookOn: true, claimed: true })).toBe('haunted');
		expect(desk.pickWall('haunted', { ...base, live: false, lookOn: true, claimed: false })).toBe('horizon');
	});

	it('lists the Halloween Gifts app only while live', () => {
		expect(desk.seasonalApps(START).map((a) => a.id)).toEqual(['halloween']);
		expect(desk.seasonalApps(END)).toEqual([]);
	});
});

describe('classic homepage look (public/seasonal.js)', () => {
	class FakeObserver { observe() {} unobserve() {} disconnect() {} }
	const run = () => new Function(CLASSIC)();

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		window.requestAnimationFrame = () => 0;
		window.cancelAnimationFrame = () => {};
		window.ResizeObserver = FakeObserver;
		window.IntersectionObserver = FakeObserver;
		window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
		HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
		localStorage.clear();
		document.documentElement.removeAttribute('data-season');
		document.head.innerHTML = '';
		document.body.innerHTML = `
			<section class="hero"><button class="hero-try" data-i18n="x" data-prompt="fox">fox</button>
			<div id="hero-stage"></div><div id="hero-chips"></div></section>`;
	});
	afterEach(() => vi.useRealTimers());

	it('does nothing outside both windows', () => {
		vi.setSystemTime(AUTUMN_END);
		run();
		expect(document.getElementById('halloween-ribbon')).toBeNull();
		expect(document.getElementById('autumn-ribbon')).toBeNull();
		expect(document.documentElement.dataset.season).toBeUndefined();
	});

	it('hands over from Halloween to autumn at the end of the weekend', () => {
		vi.setSystemTime(END);
		run();
		expect(document.getElementById('halloween-ribbon')).toBeNull();
		expect(document.querySelector('.hero-chip--halloween')).toBeNull();
		expect(document.documentElement.dataset.season).toBe('autumn');
	});

	it('themes the page, adds the falling leaves, the chip and autumn prompts during autumn', () => {
		vi.setSystemTime(END + 86400e3);
		run();
		expect(document.documentElement.dataset.season).toBe('autumn');
		expect(document.getElementById('autumn-ribbon')).not.toBeNull();
		expect(document.querySelector('.autumn-sky canvas')).not.toBeNull();
		const chip = document.querySelector('.hero-chip--autumn');
		expect(chip.tagName).toBe('BUTTON');
		expect(chip.dataset.anim).toBe('jump');
		expect(chip.getAttribute('aria-label')).toBeTruthy();
		chip.click();
		const tryBtn = document.querySelector('.hero-try');
		expect(tryBtn.dataset.prompt).toMatch(/harvest basket/);
		expect(tryBtn.hasAttribute('data-i18n')).toBe(false);
	});

	it('honors the desktop "Autumn look" opt-out', () => {
		vi.setSystemTime(END + 86400e3);
		localStorage.setItem(shared.AUTUMN_LOOK_OFF_FLAG, '1');
		run();
		expect(document.getElementById('autumn-ribbon')).toBeNull();
		expect(document.documentElement.dataset.season).toBeUndefined();
	});

	it('the autumn look is idempotent', () => {
		vi.setSystemTime(END + 86400e3);
		run();
		run();
		expect(document.querySelectorAll('.hero-chip--autumn')).toHaveLength(1);
		expect(document.querySelectorAll('.autumn-sky')).toHaveLength(1);
	});

	it('themes the page, adds the sky, the chip and Halloween prompts while live', () => {
		vi.setSystemTime(START + 3600e3);
		run();
		expect(document.documentElement.dataset.season).toBe('halloween');
		expect(document.getElementById('halloween-ribbon')).not.toBeNull();
		expect(document.querySelector('.halloween-sky canvas')).not.toBeNull();
		expect(document.querySelector('link[href="/fonts/creepster.css"]')).not.toBeNull();
		const chip = document.querySelector('.hero-chip--halloween');
		expect(chip.tagName).toBe('BUTTON');
		expect(chip.dataset.anim).toBe('thriller');
		const tryBtn = document.querySelector('.hero-try');
		expect(tryBtn.dataset.prompt).toMatch(/jack-o'-lantern/);
		expect(tryBtn.hasAttribute('data-i18n')).toBe(false);
	});

	it('honors the desktop "Halloween look" opt-out', () => {
		vi.setSystemTime(START + 3600e3);
		localStorage.setItem(shared.LOOK_OFF_FLAG, '1');
		run();
		expect(document.getElementById('halloween-ribbon')).toBeNull();
	});

	it('is idempotent', () => {
		vi.setSystemTime(START + 3600e3);
		run();
		run();
		expect(document.querySelectorAll('.hero-chip--halloween')).toHaveLength(1);
	});
});

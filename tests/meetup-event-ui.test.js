// @vitest-environment jsdom
//
// Meetup event layer DOM contract: what /play actually paints during a live
// community event. The schedule math is covered in meetup-schedule.test.js;
// these tests lock the view: when the chip mounts (and when it must NOT), the
// agenda drawer's active/done marking, the one-shot go-live moment (including
// the join-mid-event case that must never replay it), the fireworks handoff,
// and full teardown.
//
// The frame loop is driven by hand: requestAnimationFrame is stubbed to a no-op
// so nothing runs behind the test's back, and each test steps `_loop` itself.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MeetupEvent } from '../src/game/meetup-event.js';
import { parseEvent, PRESHOW_MS, SOON_MS, PHOTO_GATHER_MS } from '../src/game/meetup-schedule.js';

// Mirrors MAX_LIVE_BURSTS in src/game/meetup-event.js: the ceiling a single
// frame may ever launch, which is what the backlog clamp has to respect.
const MAX_LIVE_BURSTS = 14;

const HOME = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const OTHER = 'THREEsynthetic1111111111111111111111111111111';
const START = Date.parse('2026-08-07T17:00:00Z');

const EVENT = parseEvent({
	id: 'three-first-meetup',
	name: '$THREE First Holders Meetup',
	tagline: 'The first live gathering',
	startsAt: '2026-08-07T17:00:00Z',
	endsAt: '2026-08-07T19:00:00Z',
	agenda: [
		{ atMin: 0, title: 'Doors open', detail: 'Say hi', icon: '👋' },
		{ atMin: 20, title: 'Totem showdown', detail: 'Hold the ring', icon: '👑' },
		{ atMin: 105, title: 'Fireworks finale', detail: 'Look up', icon: '🎆' },
	],
});

// A Fireworks stand-in: records launches without touching WebGL.
class FakeFireworks {
	constructor({ scene }) { this.scene = scene; this.launches = []; this.ticks = 0; this.disposed = false; }
	launch(x, z, opts) { this.launches.push({ x, z, ...opts }); return true; }
	get liveCount() { return this.launches.length; }
	tick() { this.ticks++; }
	dispose() { this.disposed = true; }
}

function fakeCc({ mint = HOME, phase = 'world' } = {}) {
	return {
		phase,
		coin: { mint },
		scene: { name: 'scene' },
		ui: { toast: vi.fn() },
		env: { flashRing: vi.fn() },
		_openBuy: vi.fn(),
		_emote: vi.fn(),
		_openPhotoMode: vi.fn(),
	};
}

let raf;
function mount(cc = fakeCc(), event = EVENT) {
	return new MeetupEvent({ event, cc, Fireworks: FakeFireworks });
}

// Step the hand-driven loop. `at` is wall-clock ms; frame timestamps only need
// to advance monotonically for dt.
let frameT = 0;
function step(m, at, frames = 1) {
	vi.setSystemTime(at);
	for (let i = 0; i < frames; i++) { frameT += 600; m._loop(frameT); }
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(START - 60_000);
	frameT = 0;
	raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
	vi.spyOn(window, 'cancelAnimationFrame').mockReturnValue(undefined);
	document.body.className = '';
	document.body.innerHTML = '';
});

afterEach(() => {
	raf.mockRestore();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('mounting rules', () => {
	it('mounts the chip in the home town during the pre-show', () => {
		const m = mount();
		step(m, START - PRESHOW_MS + 1000);
		const chip = document.getElementById('cc-meetup-chip');
		expect(chip).toBeTruthy();
		expect(chip.textContent).toContain('Starts in');
		expect(document.body.classList.contains('cc-meetup-ui')).toBe(true);
		m.destroy();
	});

	it('never mounts in another coin world', () => {
		const m = mount(fakeCc({ mint: OTHER }));
		step(m, START + 60_000);
		expect(document.getElementById('cc-meetup-chip')).toBeNull();
		m.destroy();
	});

	it('never mounts from the lobby', () => {
		const m = mount(fakeCc({ phase: 'lobby' }));
		step(m, START + 60_000);
		expect(document.getElementById('cc-meetup-chip')).toBeNull();
		m.destroy();
	});

	it('stays hidden while the event is more than a day out', () => {
		const m = mount();
		step(m, START - SOON_MS - 60_000);
		expect(document.getElementById('cc-meetup-chip')).toBeNull();
		m.destroy();
	});

	it('unmounts when the player leaves the world', () => {
		const cc = fakeCc();
		const m = mount(cc);
		step(m, START + 60_000);
		expect(document.getElementById('cc-meetup-chip')).toBeTruthy();
		cc.phase = 'lobby';
		step(m, START + 61_000);
		expect(document.getElementById('cc-meetup-chip')).toBeNull();
		expect(document.body.classList.contains('cc-meetup-ui')).toBe(false);
		m.destroy();
	});

	it('tears itself down once the event is fully over', () => {
		const m = mount();
		step(m, START + 60_000);
		expect(document.getElementById('cc-meetup-chip')).toBeTruthy();
		step(m, EVENT.endsAt + 60 * 60 * 1000);
		expect(document.getElementById('cc-meetup-chip')).toBeNull();
		m.destroy();
	});
});

describe('the live chip', () => {
	it('marks itself live and names the next segment', () => {
		const m = mount();
		step(m, START + 60_000);
		const chip = document.getElementById('cc-meetup-chip');
		expect(chip.classList.contains('cc-meetup-islive')).toBe(true);
		expect(chip.querySelector('.cc-meetup-live-dot')).toBeTruthy();
		expect(chip.textContent).toContain('LIVE');
		expect(chip.textContent).toContain('next');
		m.destroy();
	});

	it('invites a photo during the afterglow', () => {
		const m = mount();
		step(m, EVENT.endsAt + 60_000);
		expect(document.getElementById('cc-meetup-chip').textContent).toContain('photo');
		m.destroy();
	});
});

describe('the agenda drawer', () => {
	it('opens from the chip and renders every segment', () => {
		const m = mount();
		step(m, START + 60_000);
		document.getElementById('cc-meetup-chip').click();
		const panel = document.getElementById('cc-meetup-panel');
		expect(panel.classList.contains('cc-meetup-panel--open')).toBe(true);
		expect(panel.querySelectorAll('.cc-meetup-seg')).toHaveLength(3);
		expect(document.getElementById('cc-meetup-chip').getAttribute('aria-expanded')).toBe('true');
		m.destroy();
	});

	it('marks the running segment active and past ones done', () => {
		const m = mount();
		step(m, START + 25 * 60_000); // inside the 20-minute segment
		document.getElementById('cc-meetup-chip').click();
		const segs = [...document.querySelectorAll('.cc-meetup-seg')];
		expect(segs[0].classList.contains('cc-meetup-seg--done')).toBe(true);
		expect(segs[1].classList.contains('cc-meetup-seg--active')).toBe(true);
		expect(segs[2].classList.contains('cc-meetup-seg--active')).toBe(false);
		m.destroy();
	});

	it('closes on Escape', () => {
		const m = mount();
		step(m, START + 60_000);
		document.getElementById('cc-meetup-chip').click();
		window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
		expect(document.getElementById('cc-meetup-panel').classList.contains('cc-meetup-panel--open')).toBe(false);
		m.destroy();
	});

	it('routes Buy $THREE into the app trade widget', () => {
		const cc = fakeCc();
		const m = mount(cc);
		step(m, START + 60_000);
		document.getElementById('cc-meetup-chip').click();
		document.querySelector('.cc-meetup-buy-btn').click();
		expect(cc._openBuy).toHaveBeenCalled();
		m.destroy();
	});
});

describe('moments', () => {
	it('fires the go-live banner when the event starts under the player', () => {
		const cc = fakeCc();
		const m = mount(cc);
		step(m, START - 10_000);           // pre-show: seeds the phase
		expect(document.getElementById('cc-meetup-banner')).toBeNull();
		step(m, START + 1000);             // crosses into live
		const banner = document.getElementById('cc-meetup-banner');
		expect(banner).toBeTruthy();
		expect(banner.textContent).toContain(EVENT.title);
		expect(banner.classList.contains('cc-meetup-banner--show')).toBe(true);
		expect(cc.env.flashRing).toHaveBeenCalled();
		m.destroy();
	});

	it('never replays the go-live moment for someone joining mid-event', () => {
		const m = mount();
		step(m, START + 30 * 60_000, 3);
		expect(document.getElementById('cc-meetup-banner')).toBeNull();
		m.destroy();
	});

	it('announces each new agenda segment exactly once', () => {
		const m = mount();
		step(m, START + 60_000);                 // segment 1 (seeded, no banner)
		expect(document.getElementById('cc-meetup-banner')).toBeNull();
		step(m, START + 21 * 60_000);            // segment 2 starts
		const banner = document.getElementById('cc-meetup-banner');
		expect(banner.textContent).toContain('Totem showdown');
		banner.classList.remove('cc-meetup-banner--show');
		step(m, START + 22 * 60_000);            // still segment 2: no repeat
		expect(banner.classList.contains('cc-meetup-banner--show')).toBe(false);
		m.destroy();
	});
});

describe('fireworks', () => {
	it('launches a synchronized show while live and disposes it on teardown', () => {
		const m = mount();
		step(m, START + 60_000);
		step(m, START + 64_000);
		step(m, START + 68_000);
		expect(m.fireworks).toBeTruthy();
		expect(m.fireworks.launches.length).toBeGreaterThan(0);
		const fw = m.fireworks;
		m.destroy();
		expect(fw.disposed).toBe(true);
	});

	it('keeps every burst inside the plaza ring', () => {
		const m = mount();
		step(m, START + 1000);
		for (let t = 4000; t < 120_000; t += 4000) step(m, START + t);
		expect(m.fireworks.launches.length).toBeGreaterThan(0);
		for (const l of m.fireworks.launches) {
			expect(Math.hypot(l.x, l.z)).toBeLessThanOrEqual(38);
		}
		m.destroy();
	});

	it('stays quiet before the event starts', () => {
		const m = mount();
		step(m, START - 20 * 60_000, 4);
		expect(m.fireworks).toBeNull();
		m.destroy();
	});

	// requestAnimationFrame is paused while a tab is hidden. Without a clamp, the
	// first frame back would detonate every bucket missed while away.
	it('does not replay a backlog after the tab was hidden', () => {
		const m = mount();
		step(m, START + 60_000);   // first live frame only anchors the show clock
		step(m, START + 68_000);   // ...the next one actually launches
		const beforeGap = m.fireworks.launches.length;
		step(m, START + 68_000 + 10 * 60_000); // ten minutes of missed frames
		const burst = m.fireworks.launches.length - beforeGap;
		expect(burst).toBeLessThanOrEqual(MAX_LIVE_BURSTS);
		m.destroy();
	});
});

describe('group photo', () => {
	const PHOTO_EVENT = parseEvent({
		id: 'three-meetup-photo',
		name: 'Meetup with a group photo',
		startsAt: '2026-08-07T17:00:00Z',
		endsAt: '2026-08-07T18:00:00Z',
		agenda: [{ atMin: 0, title: 'Doors open' }],
		groupPhoto: { atMin: 58, emote: 'av-celebrating' },
	});
	const SHUTTER = START + 58 * 60_000;

	it('warns a minute out, counts down, poses, then fires the photo once', () => {
		const cc = fakeCc();
		const m = mount(cc, PHOTO_EVENT);
		step(m, SHUTTER - PHOTO_GATHER_MS - 5000);
		expect(document.getElementById('cc-meetup-banner')).toBeNull();

		step(m, SHUTTER - PHOTO_GATHER_MS + 1000);
		expect(document.getElementById('cc-meetup-banner').textContent).toContain('Group photo in 1 minute');

		step(m, SHUTTER - 7200);
		const overlay = document.getElementById('cc-meetup-shutter');
		expect(overlay.querySelector('.cc-meetup-shutter-num').textContent).toBe('8');
		expect(cc._emote).not.toHaveBeenCalled();

		step(m, SHUTTER - 2500);
		expect(overlay.querySelector('.cc-meetup-shutter-num').textContent).toBe('3');
		expect(cc._emote).toHaveBeenCalledWith('av-celebrating');
		step(m, SHUTTER - 1500);
		expect(cc._emote).toHaveBeenCalledTimes(1);
		expect(cc._openPhotoMode).not.toHaveBeenCalled();

		step(m, SHUTTER + 100);
		expect(document.getElementById('cc-meetup-shutter')).toBeNull();
		expect(cc._openPhotoMode).toHaveBeenCalledTimes(1);
		step(m, SHUTTER + 900, 3);
		expect(cc._openPhotoMode).toHaveBeenCalledTimes(1);
		m.destroy();
	});

	it('takes no photo for a tab that was away through the shared instant', () => {
		const cc = fakeCc();
		const m = mount(cc, PHOTO_EVENT);
		step(m, SHUTTER - 5000);
		step(m, SHUTTER + 60_000);
		expect(cc._openPhotoMode).not.toHaveBeenCalled();
		expect(document.getElementById('cc-meetup-shutter')).toBeNull();
		m.destroy();
	});

	it('still fires for a client that watched the countdown but stalled through the instant', () => {
		// A GLB load, a GC pause or a throttled laptop can hold the next frame for
		// seconds. The player was watching the countdown, so the shot still lands
		// on the first frame back instead of being silently skipped.
		const cc = fakeCc();
		const m = mount(cc, PHOTO_EVENT);
		step(m, SHUTTER - 2500);
		expect(cc._emote).toHaveBeenCalledTimes(1);
		step(m, SHUTTER + 6000);
		expect(cc._openPhotoMode).toHaveBeenCalledTimes(1);
		expect(document.getElementById('cc-meetup-shutter')).toBeNull();
		step(m, SHUTTER + 7000, 3);
		expect(cc._openPhotoMode).toHaveBeenCalledTimes(1);
		m.destroy();
	});

	it('takes no photo when the tab was hidden during the countdown', () => {
		const cc = fakeCc();
		const m = mount(cc, PHOTO_EVENT);
		step(m, SHUTTER - 5000);
		const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
		document.dispatchEvent(new Event('visibilitychange'));
		hidden.mockReturnValue(false);
		document.dispatchEvent(new Event('visibilitychange'));
		step(m, SHUTTER + 1500);
		expect(cc._openPhotoMode).not.toHaveBeenCalled();
		hidden.mockRestore();
		m.destroy();
	});

	it('takes no photo for a client that only arrives after the instant', () => {
		const cc = fakeCc();
		const m = mount(cc, PHOTO_EVENT);
		step(m, SHUTTER + 500);
		expect(cc._openPhotoMode).not.toHaveBeenCalled();
		expect(cc._emote).not.toHaveBeenCalled();
		m.destroy();
	});

	it('runs nothing when the event has no group photo', () => {
		const cc = fakeCc();
		const m = mount(cc);
		step(m, START + 58 * 60_000 - 3000);
		step(m, START + 58 * 60_000 + 100);
		expect(document.getElementById('cc-meetup-shutter')).toBeNull();
		expect(cc._openPhotoMode).not.toHaveBeenCalled();
		m.destroy();
	});
});

describe('live headcount', () => {
	it('shows the measured count for this world and hides it until one arrives', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true, json: async () => ({ ok: true, coin: HOME, players: 1204 }),
		});
		const m = mount();
		step(m, START + 60_000);
		expect(document.getElementById('cc-meetup-chip').textContent).not.toContain('here');
		expect(fetchSpy.mock.calls[0][0]).toBe(`/api/play/population?coin=${HOME}`);
		await vi.waitFor(() => expect(m._here).toBe(1204));
		step(m, START + 61_000);
		expect(document.getElementById('cc-meetup-chip').textContent).toContain(`${(1204).toLocaleString()} here`);
		m.destroy();
	});

	it('keeps the number hidden when the multiplayer server does not answer', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true, json: async () => ({ ok: false, reason: 'unavailable' }),
		});
		const m = mount();
		step(m, START + 60_000);
		await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
		await Promise.resolve();
		step(m, START + 61_000);
		expect(m._here).toBeNull();
		expect(document.getElementById('cc-meetup-chip').textContent).not.toContain('here');
		m.destroy();
	});
});

describe('teardown', () => {
	it('leaves no DOM, class, or listener behind', () => {
		const m = mount();
		step(m, START + 60_000);
		document.getElementById('cc-meetup-chip').click();
		m.destroy();
		expect(document.getElementById('cc-meetup-chip')).toBeNull();
		expect(document.getElementById('cc-meetup-panel')).toBeNull();
		expect(document.body.classList.contains('cc-meetup-ui')).toBe(false);
		// A stray Escape after teardown must not throw.
		expect(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
	});
});

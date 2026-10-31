// @vitest-environment jsdom
//
// Third-party Halloween effects (halloween.js, canvas-confetti): they switch on
// only inside the pinned drop window, respect the opt-out, and a failed load
// never breaks the page.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const confettiSpy = vi.fn();
vi.mock('canvas-confetti', () => ({ default: confettiSpy }));
vi.mock('halloween.js', () => ({ default: () => {} }));

const fx = await import('../src/shared/halloween-fx.js');
const { HALLOWEEN_2026, LOOK_OFF_FLAG } = await import('../src/shared/seasonal-drops.js');

const during = Date.parse(HALLOWEEN_2026.startsAt) + 3600_000;
const before = Date.parse(HALLOWEEN_2026.startsAt) - 1;
const after = Date.parse(HALLOWEEN_2026.endsAt);

beforeEach(() => {
	document.body.className = '';
	document.body.removeAttribute('data-halloween-start');
	document.body.removeAttribute('data-halloween-end');
	localStorage.clear();
	confettiSpy.mockClear();
});

describe('startHalloweenPageFx', () => {
	it('adds the library classes and a season gate matching the drop inside the window', async () => {
		expect(await fx.startHalloweenPageFx(during)).toBe(true);
		for (const c of fx.FX_CLASSES) expect(document.body.classList.contains(c)).toBe(true);
		expect(document.body.dataset.halloweenStart).toBe('30-10');
		expect(document.body.dataset.halloweenEnd).toBe('02-11');
	});

	it('does nothing before the window opens or after it closes', async () => {
		expect(await fx.startHalloweenPageFx(before)).toBe(false);
		expect(await fx.startHalloweenPageFx(after)).toBe(false);
		expect(document.body.classList.contains('halloween')).toBe(false);
	});

	it('honors the Halloween look opt-out', async () => {
		localStorage.setItem(LOOK_OFF_FLAG, '1');
		expect(await fx.startHalloweenPageFx(during)).toBe(false);
		expect(document.body.classList.contains('halloween')).toBe(false);
	});

	it('is idempotent', async () => {
		expect(await fx.startHalloweenPageFx(during)).toBe(true);
		expect(await fx.startHalloweenPageFx(during)).toBe(false);
	});
});

describe('celebrateWithConfetti', () => {
	it('fires two bursts in the Halloween palette, skipped under reduced motion by the library', async () => {
		expect(await fx.celebrateWithConfetti({ x: 0.4, y: 0.5 })).toBe(true);
		expect(confettiSpy).toHaveBeenCalledTimes(2);
		const opts = confettiSpy.mock.calls[0][0];
		expect(opts.colors).toEqual([...fx.PALETTE]);
		expect(opts.disableForReducedMotion).toBe(true);
		expect(opts.origin).toEqual({ x: 0.4, y: 0.5 });
	});
});

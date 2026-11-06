// @vitest-environment jsdom
//
// The event countdown reads localStorage to remember a dismissed reminder. In
// Safari private mode and hardened browsers every storage access throws; the
// constructor must survive that, or the lobby banner is mounted with no ticking
// clock and the page logs an unhandled rejection.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const EVENT = {
	name: '$THREE Community Meetup #3',
	startsAt: new Date(Date.now() + 3600_000).toISOString(),
	endsAt: new Date(Date.now() + 7200_000).toISOString(),
	link: '/play',
};

describe('event countdown with storage blocked', () => {
	beforeEach(() => {
		vi.resetModules();
		document.body.innerHTML = '<div id="cc-lobby"><div class="cc-lobby-inner"><div class="cc-lobby-head"></div></div></div>';
		const boom = () => { throw new DOMException('denied', 'SecurityError'); };
		vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => EVENT })));
	});

	it('still ticks the banner clock and shows the pill', async () => {
		const unhandled = [];
		const onRej = (r) => unhandled.push(r);
		process.on('unhandledRejection', onRej);
		await import('../src/game/event-countdown.js');
		await new Promise((r) => setTimeout(r, 50));
		process.off('unhandledRejection', onRej);
		expect(unhandled).toEqual([]);
		const clock = document.querySelector('.cc-event-clock');
		expect(clock).toBeTruthy();
		expect(clock.textContent.length).toBeGreaterThan(0);
		expect(document.querySelector('.cc-event-pill')).toBeTruthy();
	});
});

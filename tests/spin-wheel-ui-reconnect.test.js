// @vitest-environment jsdom
//
// Paid Wheel of Fortune spins after the money has moved. Meetup #3 client
// audit (failure states): the settle message went out through a socket that
// may be down, its `false` was ignored, and the modal sat on "Verifying payment
// & rolling…" forever with the receipt link overwritten. The server accepts the
// same quote + signature until the quote expires, so the client must resend on
// reconnect and say plainly what is happening in the meantime.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SIG = '5TxSynthetic2222222222222222222222222222222222222222222222222222222222222222222222';

function makeNet() {
	const handlers = new Map();
	return {
		live: true,
		settles: 0,
		frees: 0,
		profileReqs: 0,
		on(event, fn) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event).add(fn);
			return () => handlers.get(event)?.delete(fn);
		},
		emit(event, ...args) { for (const fn of [...(handlers.get(event) || [])]) fn(...args); },
		isLive() { return this.live; },
		spinInfo() { return this.live; },
		spinFree() { if (!this.live) return false; this.frees++; return true; },
		spinPaidSettle() { if (!this.live) return false; this.settles++; return true; },
		requestProfile() { this.profileReqs++; return this.live; },
	};
}

// jsdom has no 2D canvas; the wheel only draws, so a context that accepts and
// ignores every call is enough to construct it.
function stubCanvas() {
	const noop = () => {};
	const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 0 }) : noop), set: () => true });
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
}

const statusText = () => document.querySelector('.kg-spin-status')?.textContent || '';

stubCanvas();

let mod;
beforeEach(async () => {
	document.body.innerHTML = '';
	vi.resetModules();
	mod = await import('../src/game/spin-wheel-ui.js');
});
// The canvas stub stays for the whole file: a queued animation frame can draw
// after a test ends, and it must not hit jsdom's null context.
afterEach(() => { vi.useRealTimers(); });

function settlingWheel(net) {
	const w = mod.openSpinWheel({ net });
	w.phase = 'spinning';
	w.busy = true;
	w._prep = { quote: { token: 'q' } };
	w._sig = SIG;
	w._paymentLive = true;
	return w;
}

describe('paid spin settle survives a dropped socket', () => {
	it('says the payment is safe and resends the settle once the world is back', () => {
		const net = makeNet();
		const w = settlingWheel(net);
		net.live = false;
		w._settle();
		expect(net.settles).toBe(0);
		expect(statusText()).toMatch(/Reconnecting/i);
		expect(document.querySelector('.kg-spin-status a')?.getAttribute('href')).toContain(SIG);

		net.live = true;
		net.emit('status', { status: 'online' });
		expect(net.settles).toBe(1);
		w._teardown();
	});

	it('resends when the settle got no answer (it went to a replaced session)', () => {
		vi.useFakeTimers();
		const net = makeNet();
		const w = settlingWheel(net);
		w._settle();
		expect(net.settles).toBe(1);
		vi.advanceTimersByTime(25_001);
		expect(net.settles).toBe(2);
		w._teardown();
	});

	it('reads already_settled after a resend as a spin rolled during the reconnect', () => {
		vi.useFakeTimers();
		const net = makeNet();
		const w = settlingWheel(net);
		w._settle();
		vi.advanceTimersByTime(25_001);
		net.emit('spinDenied', { mode: 'paid', reason: 'already_settled' });
		expect(statusText()).toMatch(/rolled while you were reconnecting/i);
		expect(statusText()).not.toMatch(/already used/i);
		expect(net.profileReqs).toBeGreaterThan(0);
		w._teardown();
	});

	it('a free spin with the socket down says nothing was spent instead of spinning forever', () => {
		const net = makeNet();
		const w = mod.openSpinWheel({ net });
		net.emit('spinInfo', { segments: [], now: 1000, nextFreeSpinAt: 0, avgLevel: 10, minLevel: 1, eligible: true, paidAvailable: true });
		net.live = false;
		w._free();
		expect(net.frees).toBe(0);
		expect(w.busy).toBe(false);
		expect(statusText()).toMatch(/Nothing was spent/i);
		w._teardown();
	});
});

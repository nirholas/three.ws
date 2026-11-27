// src/shared/resilient-poll.js: the poll primitives every long-running
// generation on the site is built on (src/forge.js, src/home-forge.js).
//
// These are the failure modes of a phone, not of a server, so they are tested
// against a fake document/window rather than a browser: a tab that goes hidden
// must not burn the run budget, a radio that comes back must not leave the user
// waiting out a 20 s backoff, and a dropped socket must be distinguishable from
// a dead job.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module reads `document` and `window` at call time, so a minimal stub is
// enough and keeps the test honest about exactly which events it relies on.
function installDom(visibility = 'visible') {
	const listeners = { document: new Map(), window: new Map() };
	const make = (bag) => ({
		addEventListener: (type, fn) => {
			if (!bag.has(type)) bag.set(type, new Set());
			bag.get(type).add(fn);
		},
		removeEventListener: (type, fn) => bag.get(type)?.delete(fn),
		emit: (type) => [...(bag.get(type) || [])].forEach((fn) => fn()),
		count: (type) => bag.get(type)?.size ?? 0,
	});
	const doc = make(listeners.document);
	const win = make(listeners.window);
	globalThis.document = Object.assign(doc, { visibilityState: visibility });
	globalThis.window = win;
	return { doc, win };
}

let dom;
beforeEach(() => {
	dom = installDom();
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	delete globalThis.document;
	delete globalThis.window;
});

describe('sleepUntilVisibleOrElapsed', () => {
	it('resolves early when the device comes back online', async () => {
		const { sleepUntilVisibleOrElapsed } = await import('../src/shared/resilient-poll.js');
		let done = false;
		const p = sleepUntilVisibleOrElapsed(20_000).then(() => {
			done = true;
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(done).toBe(false);
		dom.win.emit('online');
		await p;
		expect(done).toBe(true);
	});

	it('resolves early when the tab returns to the foreground', async () => {
		const { sleepUntilVisibleOrElapsed } = await import('../src/shared/resilient-poll.js');
		const p = sleepUntilVisibleOrElapsed(20_000);
		globalThis.document.visibilityState = 'visible';
		dom.doc.emit('visibilitychange');
		await expect(p).resolves.toBeUndefined();
	});

	it('detaches both listeners once it settles, however it settled', async () => {
		// The poll loop calls this once per iteration for minutes on end, so a
		// listener left attached is an unbounded leak on the exact devices this
		// module exists for.
		const { sleepUntilVisibleOrElapsed } = await import('../src/shared/resilient-poll.js');
		const p = sleepUntilVisibleOrElapsed(1000);
		expect(dom.win.count('online')).toBe(1);
		await vi.advanceTimersByTimeAsync(1000);
		await p;
		expect(dom.win.count('online')).toBe(0);
		expect(dom.doc.count('visibilitychange')).toBe(0);
	});

	it('resolves once even if both wake sources fire', async () => {
		const { sleepUntilVisibleOrElapsed } = await import('../src/shared/resilient-poll.js');
		const fn = vi.fn();
		const p = sleepUntilVisibleOrElapsed(5000).then(fn);
		dom.win.emit('online');
		dom.doc.emit('visibilitychange');
		await vi.advanceTimersByTimeAsync(5000);
		await p;
		expect(fn).toHaveBeenCalledTimes(1);
	});
});

describe('createHiddenClock', () => {
	it('does not count foreground time', async () => {
		const { createHiddenClock } = await import('../src/shared/resilient-poll.js');
		const clock = createHiddenClock();
		expect(clock.hiddenMs()).toBe(0);
		clock.stop();
	});

	it('counts the time a backgrounded tab spends hidden', async () => {
		const { createHiddenClock } = await import('../src/shared/resilient-poll.js');
		const clock = createHiddenClock();
		const start = performance.now();
		globalThis.document.visibilityState = 'hidden';
		dom.doc.emit('visibilitychange');
		// performance.now() is real here; the assertion only needs the clock to
		// have started accruing, not a precise duration.
		expect(clock.hiddenMs()).toBeGreaterThanOrEqual(0);
		globalThis.document.visibilityState = 'visible';
		dom.doc.emit('visibilitychange');
		const accrued = clock.hiddenMs();
		expect(accrued).toBeGreaterThanOrEqual(0);
		expect(accrued).toBeLessThan(performance.now() - start + 50);
		clock.stop();
		expect(dom.doc.count('visibilitychange')).toBe(0);
	});
});

describe('createHiddenClock hiddenStreakMs', () => {
	// The Forge poll stops asking the server once a tab has been in the
	// background for a long stretch, so it needs the CURRENT hidden streak, not
	// the lifetime total that hiddenMs() reports.
	it('reports how long the tab has been hidden right now, and 0 once it is back', async () => {
		const { createHiddenClock } = await import('../src/shared/resilient-poll.js');
		let t = 1_000;
		const clock = createHiddenClock({ now: () => t });
		expect(clock.hiddenStreakMs()).toBe(0);
		globalThis.document.visibilityState = 'hidden';
		dom.doc.emit('visibilitychange');
		t += 90_000;
		expect(clock.hiddenStreakMs()).toBe(90_000);
		expect(clock.hiddenMs()).toBe(90_000);
		globalThis.document.visibilityState = 'visible';
		dom.doc.emit('visibilitychange');
		expect(clock.hiddenStreakMs()).toBe(0);
		expect(clock.hiddenMs()).toBe(90_000);
		// A second, shorter streak is measured on its own.
		globalThis.document.visibilityState = 'hidden';
		dom.doc.emit('visibilitychange');
		t += 5_000;
		expect(clock.hiddenStreakMs()).toBe(5_000);
		expect(clock.hiddenMs()).toBe(95_000);
		clock.stop();
	});

	it('counts a tab that was already hidden when the clock started', async () => {
		dom = installDom('hidden');
		const { createHiddenClock } = await import('../src/shared/resilient-poll.js');
		let t = 0;
		const clock = createHiddenClock({ now: () => t });
		t = 70_000;
		expect(clock.hiddenStreakMs()).toBe(70_000);
		clock.stop();
	});
});

describe('waitUntilVisible', () => {
	it('resolves at once when the tab is already in the foreground', async () => {
		const { waitUntilVisible } = await import('../src/shared/resilient-poll.js');
		await expect(waitUntilVisible()).resolves.toBeUndefined();
		expect(dom.doc.count('visibilitychange')).toBe(0);
	});

	it('holds a hidden tab, with no timer, until it is shown, then detaches', async () => {
		dom = installDom('hidden');
		const { waitUntilVisible } = await import('../src/shared/resilient-poll.js');
		let done = false;
		const p = waitUntilVisible().then(() => {
			done = true;
		});
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(done).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
		// A visibilitychange that leaves it hidden (prerender, another tab) is not a wake.
		dom.doc.emit('visibilitychange');
		await vi.advanceTimersByTimeAsync(0);
		expect(done).toBe(false);
		globalThis.document.visibilityState = 'visible';
		dom.doc.emit('visibilitychange');
		await p;
		expect(done).toBe(true);
		expect(dom.doc.count('visibilitychange')).toBe(0);
	});
});

describe('fetchJobStatus', () => {
	it('marks a dropped socket as transport so the caller can retry it', async () => {
		const { fetchJobStatus } = await import('../src/shared/resilient-poll.js');
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(fetchJobStatus('/api/forge?job=x')).rejects.toMatchObject({ kind: 'transport' });
	});

	it('marks a 5xx and a 429 as transport, but not a 400', async () => {
		const { fetchJobStatus } = await import('../src/shared/resilient-poll.js');
		for (const status of [500, 502, 429]) {
			globalThis.fetch = vi.fn().mockResolvedValue({ status, json: async () => ({}) });
			await expect(fetchJobStatus('/u')).rejects.toMatchObject({ kind: 'transport' });
		}
		globalThis.fetch = vi.fn().mockResolvedValue({ status: 400, json: async () => ({ error: 'bad' }) });
		await expect(fetchJobStatus('/u')).resolves.toEqual({ error: 'bad' });
	});

	it('reads an unparseable body as "no status yet" rather than a failure', async () => {
		const { fetchJobStatus } = await import('../src/shared/resilient-poll.js');
		globalThis.fetch = vi.fn().mockResolvedValue({
			status: 200,
			json: async () => {
				throw new SyntaxError('Unexpected token <');
			},
		});
		await expect(fetchJobStatus('/u')).resolves.toEqual({});
	});
});

describe('nextBackoff', () => {
	it('grows and then holds at the ceiling, jittered', async () => {
		const { nextBackoff } = await import('../src/shared/resilient-poll.js');
		const grown = nextBackoff(2500, 20_000);
		expect(grown).toBeGreaterThan(2500);
		// Jitter is +/-15% around the doubled value, so the ceiling is approached,
		// never exceeded by more than that band.
		const capped = nextBackoff(20_000, 20_000);
		expect(capped).toBeLessThanOrEqual(20_000 * 1.15);
		expect(capped).toBeGreaterThanOrEqual(20_000 * 0.85);
	});
});

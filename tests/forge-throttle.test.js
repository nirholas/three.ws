// @vitest-environment jsdom
// Forge throttle honesty (src/forge-throttle.js): the classifier that tells a
// provider throttle from the user's own limit and the daily cap, the copy each
// gets, and the panel's single automatic retry.
//
// Regression: on 2026-11-26 the reference-image rung throttled Forge and both
// pages titled it "Generation limit reached", as if users had spent their own
// allowance. The page-source block at the bottom pins that neither page keeps a
// catch-all 429 branch of its own.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AUTO_RETRY_MAX_SECONDS,
	THROTTLE,
	classifyThrottle,
	countdownText,
	createThrottlePanel,
	describeThrottle,
	formatCountdown,
	nextUtcMidnight,
	retryAfterSeconds,
} from '../src/forge-throttle.js';

const NOW = Date.UTC(2026, 10, 26, 20, 50, 0); // 2026-11-26 20:50:00 UTC

// The three real 429 bodies api/forge.js sends, as the page receives them.
const providerThrottle = (extra = {}) => ({
	status: 429,
	headers: new Headers({ 'retry-after': '45' }),
	body: {
		error: 'rate_limited',
		queued: true,
		message: 'Your generation is queued behind a few others: retry in ~45s to pick it up.',
		retry_after: 45,
		...extra,
	},
	now: NOW,
});
const userLimit = () => ({
	status: 429,
	headers: new Headers({
		'ratelimit-limit': '6',
		'ratelimit-remaining': '0',
		'ratelimit-reset': '1800',
		'retry-after': '1800',
	}),
	body: { error: 'rate_limited', message: 'Generation limit reached. Try again shortly.', retry_after: 1800 },
	now: NOW,
});
const dailyCap = () => ({
	status: 429,
	headers: new Headers(),
	body: { error: 'daily_limit_reached', message: 'You’ve reached today’s limit for paid generations.' },
	now: NOW,
});

describe('classifyThrottle', () => {
	it('reads the provider throttle as provider_busy on the image step, with the stated wait and an automatic retry', () => {
		const c = classifyThrottle(providerThrottle());
		expect(c).toMatchObject({ kind: THROTTLE.PROVIDER_BUSY, source: 'image', waitSeconds: 45, autoRetry: true, stated: true });
		expect(c.resetAt).toBe(NOW + 45_000);
	});

	it('reads an upstream engine 429 (queued: false) as provider_busy on the engine', () => {
		const c = classifyThrottle(providerThrottle({ queued: false, retry_after: 10 }));
		expect(c).toMatchObject({ kind: THROTTLE.PROVIDER_BUSY, source: 'engine', waitSeconds: 10, autoRetry: true });
	});

	it('reads the account limiter (ratelimit-* headers) as the user rate limit, never retried automatically', () => {
		const c = classifyThrottle(userLimit());
		expect(c).toMatchObject({ kind: THROTTLE.USER_RATE_LIMIT, source: 'account', waitSeconds: 1800, autoRetry: false });
		expect(c.resetAt).toBe(NOW + 1_800_000);
	});

	it('takes the reset from the headers when the body states no wait', () => {
		const c = classifyThrottle({
			status: 429,
			headers: { 'RateLimit-Reset': '75', 'ratelimit-limit': '6' },
			body: { error: 'rate_limited', message: 'Generation limit reached. Try again shortly.' },
			now: NOW,
		});
		expect(c).toMatchObject({ kind: THROTTLE.USER_RATE_LIMIT, waitSeconds: 75, stated: true });
	});

	it('reads the daily cap with a reset at the next midnight UTC', () => {
		const c = classifyThrottle(dailyCap());
		const midnight = Date.UTC(2026, 10, 27, 0, 0, 0);
		expect(c).toMatchObject({ kind: THROTTLE.DAILY_CAP, autoRetry: false, resetAt: midnight });
		expect(c.waitSeconds).toBe((midnight - NOW) / 1000);
		expect(nextUtcMidnight(NOW)).toBe(midnight);
	});

	it('does not call a failing-closed limiter the user’s limit', () => {
		const c = classifyThrottle({
			status: 429,
			headers: new Headers({ 'ratelimit-reset': '60' }),
			body: { error: 'rate_limited', reason: 'rate_limiter_unavailable', retry_after: 60 },
			now: NOW,
		});
		expect(c).toMatchObject({ kind: THROTTLE.PROVIDER_BUSY, source: 'limiter', waitSeconds: 60 });
	});

	it('handles a 429 whose body was not JSON', () => {
		// The page passes {} when res.json() fails.
		expect(classifyThrottle({ status: 429, body: {}, headers: new Headers({ 'retry-after': '20' }), now: NOW })).toMatchObject({
			kind: THROTTLE.UNKNOWN,
			waitSeconds: 20,
			stated: true,
			autoRetry: false,
		});
		expect(classifyThrottle({ status: 429, body: null, headers: null, now: NOW })).toMatchObject({
			kind: THROTTLE.UNKNOWN,
			waitSeconds: 30,
			stated: false,
		});
	});

	it('falls back to a floor when the provider states no wait', () => {
		const { retry_after, ...noWait } = providerThrottle().body;
		const c = classifyThrottle({ status: 429, body: noWait, headers: new Headers(), now: NOW });
		expect(c).toMatchObject({ kind: THROTTLE.PROVIDER_BUSY, waitSeconds: 15, stated: false, autoRetry: true });
	});

	it('treats a wait of zero as unstated, so it never fires an instant retry', () => {
		const c = classifyThrottle({
			status: 429,
			body: { ...providerThrottle().body, retry_after: 0 },
			headers: new Headers({ 'retry-after': '0' }),
			now: NOW,
		});
		expect(c.waitSeconds).toBe(15);
		expect(c.stated).toBe(false);
		// A zero in the body yields to a real number in the headers.
		const u = classifyThrottle({
			status: 429,
			body: { error: 'rate_limited', retry_after: 0 },
			headers: new Headers({ 'ratelimit-reset': '12' }),
			now: NOW,
		});
		expect(u).toMatchObject({ kind: THROTTLE.USER_RATE_LIMIT, waitSeconds: 12 });
	});

	it('reads an HTTP-date Retry-After', () => {
		expect(retryAfterSeconds(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90);
		expect(retryAfterSeconds(new Date(NOW - 5_000).toUTCString(), NOW)).toBeNull();
		expect(retryAfterSeconds('soon', NOW)).toBeNull();
	});

	it('does not retry automatically past the cap', () => {
		const c = classifyThrottle(providerThrottle({ retry_after: AUTO_RETRY_MAX_SECONDS + 1 }));
		expect(c.autoRetry).toBe(false);
	});

	it('covers the 503 capacity shapes and leaves designed non-throttle states alone', () => {
		expect(classifyThrottle({ status: 503, body: { error: 'provider_busy', retry_after: 20 }, now: NOW })).toMatchObject({
			kind: THROTTLE.PROVIDER_BUSY,
			source: 'free_engines',
			waitSeconds: 20,
		});
		expect(classifyThrottle({ status: 503, body: { error: 'generation_unavailable' }, now: NOW })).toMatchObject({
			kind: THROTTLE.PROVIDER_BUSY,
			source: 'unavailable',
		});
		expect(classifyThrottle({ status: 503, body: { error: 'storage_unavailable' }, now: NOW })).toBeNull();
		expect(classifyThrottle({ status: 503, body: { error: 'unconfigured' }, now: NOW })).toBeNull();
		expect(classifyThrottle({ status: 400, body: { error: 'invalid_prompt' }, now: NOW })).toBeNull();
		expect(classifyThrottle({ status: 200, body: { job_id: 'x' }, now: NOW })).toBeNull();
	});

	it('tells world capacity from the player’s own cooldown', () => {
		expect(classifyThrottle({ status: 429, body: { error: 'rate_limited', scope: 'world' }, now: NOW }).kind).toBe(
			THROTTLE.PROVIDER_BUSY,
		);
		expect(classifyThrottle({ status: 429, body: { error: 'rate_limited', scope: 'player' }, now: NOW }).kind).toBe(
			THROTTLE.USER_RATE_LIMIT,
		);
	});
});

describe('describeThrottle', () => {
	const ctx = { locale: 'en-US', timeZone: 'UTC', now: NOW };

	it('never tells a provider throttle it is the user’s limit', () => {
		const d = describeThrottle(classifyThrottle(providerThrottle()), { ...ctx, canUsePhoto: true });
		expect(d.title).toBe('Our image step is busy');
		expect(d.title).not.toMatch(/limit/i);
		expect(d.lead).toMatch(/not a limit on your account/);
		expect(d.actions).toEqual(['photo']);
	});

	it('says when the user’s own limit resets', () => {
		const d = describeThrottle(classifyThrottle(userLimit()), ctx);
		expect(d.title).toBe('You have used your generations for now');
		expect(d.lead).toContain('9:20 PM');
		expect(d.lead).toContain('in about 30 minutes');
		expect(d.actions).toEqual([]);
		expect(describeThrottle(classifyThrottle(userLimit()), { ...ctx, signedIn: false }).actions).toEqual(['signin']);
	});

	it('says the daily cap is for paid engines, when it resets, and that free engines stay open', () => {
		const d = describeThrottle(classifyThrottle(dailyCap()), { ...ctx, canChooseFreeEngine: true });
		expect(d.title).toMatch(/paid generations/);
		expect(d.lead).toContain('12:00 AM');
		expect(d.lead).toContain('free engines stay open');
		expect(d.actions).toEqual(['free_engine']);
	});

	it('formats countdowns compactly', () => {
		expect(formatCountdown(45)).toBe('45s');
		expect(formatCountdown(1799)).toBe('29:59');
		expect(formatCountdown(4 * 3600 + 12 * 60)).toBe('4 h 12 min');
		const c = classifyThrottle(providerThrottle());
		expect(countdownText(c, 45, { auto: true })).toBe('Retrying automatically in 45s.');
		expect(countdownText(c, 0, { auto: false })).toBe('You can try again now.');
	});
});

describe('createThrottlePanel', () => {
	let els;
	let onRetry;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		document.body.innerHTML = `
			<div class="panel notice error" id="state-error">
				<span class="glyph" aria-hidden="true">⚠</span>
				<h3 id="error-title">Generation failed</h3>
				<p id="error-message">Something went wrong.</p>
				<div class="actions is-hidden" id="error-lanes" role="group" aria-label="Retry on another engine"></div>
				<div class="actions">
					<button type="button" id="retry">Try again</button>
					<button type="button" class="is-hidden" id="refine-locally">Refine current model instead</button>
				</div>
			</div>`;
		const $ = (id) => document.getElementById(id);
		els = {
			panel: $('state-error'),
			title: $('error-title'),
			message: $('error-message'),
			retry: $('retry'),
			lanes: $('error-lanes'),
			refineLocally: $('refine-locally'),
		};
		onRetry = vi.fn();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const line = () => document.querySelector('.forge-throttle__line')?.textContent;
	const announcer = () => document.querySelector('.forge-throttle__sr');

	it('retries automatically exactly once at the end of the stated wait, and never again without a click', () => {
		const panel = createThrottlePanel({ els, onRetry });
		panel.show(classifyThrottle(providerThrottle()));

		expect(els.title.textContent).toBe('Our image step is busy');
		expect(line()).toBe('Retrying automatically in 45s.');
		expect(els.retry.disabled).toBe(true);
		expect(document.querySelector('.forge-throttle-cancel')).not.toBeNull();

		vi.advanceTimersByTime(44_000);
		expect(onRetry).not.toHaveBeenCalled();
		expect(line()).toBe('Retrying automatically in 1s.');
		vi.advanceTimersByTime(1_000);
		expect(onRetry).toHaveBeenCalledTimes(1);

		// The retry was refused again: the page shows the panel a second time
		// without resetting the budget. It must count down to a manual retry.
		panel.stop();
		panel.show(classifyThrottle(providerThrottle({ retry_after: 30 })));
		expect(els.message.textContent).toMatch(/^Still busy after the automatic retry\./);
		expect(line()).toBe('You can try again in 30s.');
		expect(document.querySelector('.forge-throttle-cancel')).toBeNull();
		vi.advanceTimersByTime(10 * 60_000);
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(els.retry.disabled).toBe(false);
		expect(line()).toBe('You can try again now.');

		// A user click resets the budget; the next refusal may retry once again.
		panel.resetAutoRetry();
		panel.show(classifyThrottle(providerThrottle()));
		vi.advanceTimersByTime(45_000);
		expect(onRetry).toHaveBeenCalledTimes(2);
	});

	it('lets the user cancel the automatic retry', () => {
		const panel = createThrottlePanel({ els, onRetry });
		panel.show(classifyThrottle(providerThrottle()));
		document.querySelector('.forge-throttle-cancel').click();
		expect(document.querySelector('.forge-throttle-cancel')).toBeNull();
		expect(line()).toBe('You can try again in 45s.');
		vi.advanceTimersByTime(60_000);
		expect(onRetry).not.toHaveBeenCalled();
		expect(els.retry.disabled).toBe(false);
	});

	it('stops cleanly when the page leaves the state', () => {
		const panel = createThrottlePanel({ els, onRetry });
		panel.show(classifyThrottle(providerThrottle()));
		expect(els.lanes.getAttribute('aria-label')).toBe('What you can do now');
		panel.stop();
		expect(els.lanes.getAttribute('aria-label')).toBe('Retry on another engine');
		vi.advanceTimersByTime(60_000);
		expect(onRetry).not.toHaveBeenCalled();
		expect(document.querySelector('.forge-throttle')).toBeNull();
		expect(els.panel.dataset.throttle).toBeUndefined();
		expect(els.panel.querySelector('.glyph').textContent).toBe('⚠');
		expect(els.title.dataset.defaultText).toBe('Generation failed');
	});

	it('announces at the start and the end only, not every second', () => {
		const panel = createThrottlePanel({ els, onRetry });
		panel.show(classifyThrottle(providerThrottle({ retry_after: 5, queued: false })));
		expect(document.querySelector('.forge-throttle').getAttribute('aria-live')).toBe('off');
		expect(announcer().getAttribute('role')).toBe('status');
		vi.advanceTimersByTime(100);
		const start = announcer().textContent;
		expect(start).toBe('The 3D engine is busy. Retrying automatically in 5s.');
		vi.advanceTimersByTime(3_000);
		expect(announcer().textContent).toBe(start);
		vi.advanceTimersByTime(2_000);
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it('shows the user’s own limit without an automatic retry and with its reset', () => {
		const panel = createThrottlePanel({ els, onRetry, signInUrl: '/login?next=%2Fforge' });
		panel.show(classifyThrottle(userLimit()), { signedIn: false, canRefineLocally: true });
		expect(els.title.textContent).toBe('You have used your generations for now');
		expect(line()).toBe('You can generate again in 30:00.');
		expect(document.querySelector('.forge-throttle-cancel')).toBeNull();
		expect(els.lanes.querySelector('a').getAttribute('href')).toBe('/login?next=%2Fforge');
		expect(els.refineLocally.classList.contains('is-hidden')).toBe(false);
		vi.advanceTimersByTime(1_800_000);
		expect(onRetry).not.toHaveBeenCalled();
		expect(els.retry.disabled).toBe(false);
	});

	it('wires the photo and free-engine actions to the page', () => {
		const photo = vi.fn();
		const freeEngine = vi.fn();
		const panel = createThrottlePanel({ els, onRetry, actions: { photo, free_engine: freeEngine } });
		panel.show(classifyThrottle(providerThrottle()));
		const photoBtn = [...els.lanes.querySelectorAll('button')].find((b) => b.textContent === 'Use a photo instead');
		photoBtn.click();
		expect(photo).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(60_000);
		expect(onRetry).not.toHaveBeenCalled();

		panel.show(classifyThrottle(dailyCap()));
		const freeBtn = [...els.lanes.querySelectorAll('button')].find((b) => b.textContent === 'Choose a free engine');
		freeBtn.click();
		expect(freeEngine).toHaveBeenCalledTimes(1);
	});
});

describe('both Forge pages use the shared classifier', () => {
	const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

	for (const page of ['../src/forge.js', '../src/forge-studio/forge.js']) {
		it(`${page} routes refusals through classifyThrottle with no 429 branch of its own`, () => {
			const src = read(page);
			expect(src).toMatch(/classifyThrottle\(/);
			expect(src).not.toMatch(/Generation limit reached/);
			expect(src).not.toMatch(/res\.status === 429/);
			expect(src).not.toMatch(/function showRateLimited/);
		});
	}
});

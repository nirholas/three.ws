// The free NIM lane's cooldown is duration-tuned by failure mode (TASK-5). The
// cooldown exists to avoid re-paying the expensive submit-timeout HANG — so a fast
// gateway 5xx (a 504/503 the gateway returned promptly) must earn only a SHORT
// window, otherwise one transient 504 sidelines the free lane for two minutes and
// dumps every text prompt onto the (often dry) paid lane. A genuine socket
// timeout / unreachable host (no HTTP status came back) still earns the full
// window, and a 429 backs off for its Retry-After within bounds.

import { describe, it, expect } from 'vitest';
import { nimCooldownSeconds } from '../../api/forge.js';

const FULL = 120;
const SHORT = 30;
const MAX_STATED = 900;

describe('nimCooldownSeconds — failure-mode-tuned cooldown', () => {
	it('gives a fast gateway 5xx (a 504 that came back) only the short window', () => {
		expect(nimCooldownSeconds({ code: 'provider_error', providerStatus: 504 })).toBe(SHORT);
		expect(nimCooldownSeconds({ code: 'provider_error', providerStatus: 503 })).toBe(SHORT);
		expect(nimCooldownSeconds({ code: 'provider_error', providerStatus: 500 })).toBe(SHORT);
	});

	it('gives a socket timeout / unreachable host (no HTTP status) the full window', () => {
		// The expensive hang the cooldown was designed for — our own AbortSignal fired
		// with no response, so providerStatus is absent.
		expect(nimCooldownSeconds({ code: 'provider_unreachable', status: 502 })).toBe(FULL);
		expect(nimCooldownSeconds({ message: 'nvidia unreachable: fetch failed' })).toBe(FULL);
	});

	it('honours a 429 Retry-After, floored at the short window and capped at the stated-wait maximum', () => {
		expect(nimCooldownSeconds({ providerStatus: 429, retryAfter: 60 })).toBe(60);
		// Below the short floor: floored; above the stated-wait cap: capped.
		expect(nimCooldownSeconds({ providerStatus: 429, retryAfter: 5 })).toBe(SHORT);
		expect(nimCooldownSeconds({ providerStatus: 429, retryAfter: 9999 })).toBe(MAX_STATED);
	});

	it('a fast gateway window is meaningfully shorter than the hang window', () => {
		expect(nimCooldownSeconds({ providerStatus: 504 })).toBeLessThan(
			nimCooldownSeconds({ code: 'provider_unreachable' }),
		);
	});
});

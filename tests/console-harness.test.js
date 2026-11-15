import { describe, it, expect } from 'vitest';
import { isBrowserGone, HARNESS_DOWN } from '../scripts/lib/console-harness.mjs';

describe('console sweep harness classification', () => {
	it('treats a closed or disconnected browser as the machine, not the page', () => {
		expect(isBrowserGone(new Error('browserContext.newPage: Target page, context or browser has been closed'))).toBe(true);
		expect(isBrowserGone(new Error('Browser closed.'))).toBe(true);
	});

	// 2026-11-15: at load 500+ with 6 GB free, Chromium died mid-sweep and
	// `browserContext.newPage: Target crashed` aborted the whole 1,068-route run
	// at route 626 instead of relaunching the browser and re-reading the route.
	it('treats a crashed target as the machine, so the sweep relaunches instead of aborting', () => {
		expect(isBrowserGone(new Error('browserContext.newPage: Target crashed '))).toBe(true);
	});

	it('does not excuse a page-level error', () => {
		expect(isBrowserGone(new Error("TypeError: Cannot read properties of null (reading 'x')"))).toBe(false);
		expect(isBrowserGone(undefined)).toBe(false);
	});

	it('reads a refused connection or crashed tab as the dev server being down', () => {
		expect(HARNESS_DOWN.test('navigation failed: net::ERR_CONNECTION_REFUSED')).toBe(true);
		expect(HARNESS_DOWN.test('navigation failed: Page crashed')).toBe(true);
		expect(HARNESS_DOWN.test('HTTP 404 script /src/x.js')).toBe(false);
	});
});

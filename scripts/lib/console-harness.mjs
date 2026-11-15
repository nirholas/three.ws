/**
 * Harness-failure classification for the console sweep (scripts/audit-console.mjs).
 *
 * These decide when an error describes the MACHINE (a headless browser the box
 * killed, a dev server that went away) rather than the page under test. The
 * sweep relaunches the browser or waits for the server and re-reads the route;
 * a real page defect still fails on that re-read, so nothing is excused.
 */

// The headless browser, or the renderer behind it, is gone. Relaunch and re-read.
// `Target crashed` is what Playwright throws from newPage() when the box kills
// Chromium under memory pressure; left out, it aborted a whole sweep.
export const BROWSER_GONE =
	/has been closed|Target closed|Target crashed|browser has (been )?disconnected|Browser closed/i;

// The dev server went away, or the tab died taking the page with it.
export const HARNESS_DOWN = /ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET|Page crashed/i;

export function isBrowserGone(error) {
	return BROWSER_GONE.test(error?.message || String(error || ''));
}

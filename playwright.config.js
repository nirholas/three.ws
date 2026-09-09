import { defineConfig } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright config for the /club smoke. Drives a real Chromium against the
// Vite dev server. Kept separate from Vitest (which only globs *.test.js) by
// using the `.spec.js` suffix in `tests/e2e/`.
//
// Cold-start budget: a fresh Vite dev server needs ~30s to come up and the
// first /club hit then transforms the full three.js module graph (~30–60s
// on a CI box). The first test sets a 180s test timeout; we mirror that on
// the webServer health check so playwright doesn't kill the server before
// the cold transform finishes and bring down the next two tests with it.
const E2E_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tests', 'e2e');

/**
 * The live home specs, read from the specs themselves rather than listed here.
 *
 * The rule above is exact: importing ./home-support.js is what makes a spec need
 * the real stack. A hand-kept list is the same rule written a second time, and
 * it drifted twice. home-lifecycle and home-plan landed as live journeys, were
 * never added, and ran under this config with no house to reach: journey 1 died
 * on "Could not reach http://127.0.0.1:39611" and the plan page found none of
 * its quota rows. Three failures that read like product bugs, in a stage that
 * therefore could not pass for anyone.
 */
function liveHomeSpecs() {
	return readdirSync(E2E_DIR)
		.filter((f) => f.endsWith('.spec.js'))
		.filter((f) => /from '\.\/home-support/.test(readFileSync(path.join(E2E_DIR, f), 'utf8')))
		.map((f) => `**/${f}`)
		.sort();
}

export default defineConfig({
	testDir: 'tests/e2e',
	// The home lane's live journeys (the specs that import ./home-support.js)
	// drive a real Home Assistant and two provisioned accounts, which only
	// playwright.home.config.js sets up (`npm run test:home:e2e`). Under this
	// config they have no stack to read and die on the first sign-in, so they
	// stay out of the general run. The stub-driven home specs (home-connect,
	// home-whose-fault) need no stack and still run here.
	testIgnore: liveHomeSpecs(),
	// 300s, not 120s: the a11y floor spec runs axe over every top-30 page, and
	// axe's colour-contrast pass is O(rendered nodes). /marketplace renders a
	// ~77-card grid and legitimately takes ~4.3 min against the dev server
	// (on-demand module transforms), so 120s timed it out as a phantom failure.
	timeout: 300_000,
	retries: 1,
	fullyParallel: false,
	use: {
		baseURL: 'http://localhost:3000',
		headless: true,
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'retain-on-failure',
	},
	webServer: {
		command: 'npm run dev',
		url: 'http://localhost:3000',
		timeout: 180_000,
		reuseExistingServer: !process.env.CI,
		stdout: 'pipe',
		stderr: 'pipe',
	},
});

import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The home lane's own Playwright config.
 *
 * It is separate from playwright.config.js on purpose. The lane's journeys need
 * a real API process and a real Home Assistant behind the dev server, and the
 * rest of the e2e suite must not pay for that: a spec about /club has no
 * business booting a house.
 *
 *   npm run test:home:e2e
 *
 * Secrets below are generated per run and are LOCAL ONLY. They encrypt rows
 * this run creates in the database it is pointed at and are thrown away with
 * the process, so nothing here can decrypt a production credential and nothing
 * production wrote can be read by this run.
 */
// The database, in THIS process and not only in the API child process.
//
// The API server below is started with `node --env-file=.env.local`, so it has
// always had DATABASE_URL. The Playwright process did not: the global setup
// provisions QA accounts and the specs read and write home rows directly, and
// both of those run here. Without this the whole run dies before the first
// browser opens with "Missing required env var: DATABASE_URL" thrown from
// api/_lib/env.js, which reads as a product bug and is a missing variable.
//
// Same precedence as scripts/apply-migrations.mjs: a value already in the
// environment wins, then .env.local, then .env. So `DATABASE_URL=... npx
// playwright test` still points the run wherever the caller aimed it.
const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
for (const envFile of ['.env.local', '.env']) {
	try {
		for (const line of readFileSync(path.resolve(CONFIG_DIR, envFile), 'utf8').split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (!m || process.env[m[1]]) continue;
			const val = m[2].trim();
			const quoted = (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"));
			process.env[m[1]] = quoted ? val.slice(1, -1) : val;
		}
	} catch { /* not present: an exported DATABASE_URL is a valid way to run this */ }
}

// Dedicated ports, and no server reuse. Other agents run their own `npm run
// dev` on :3000 in this worktree, and reusing one is not a smaller version of
// this stack: its /api proxy points at PRODUCTION, so the run silently tests
// the wrong API and reports "No API route matches /api/home" as if the handler
// were missing. Own the ports or fail loudly.
const API_PORT = Number(process.env.HOME_E2E_API_PORT) || 8099;
const WEB_PORT = Number(process.env.HOME_E2E_WEB_PORT) || 3020;
const APP_ORIGIN = `http://localhost:${WEB_PORT}`;

const localSecrets = {
	JWT_SECRET: process.env.HOME_E2E_JWT_SECRET || randomBytes(32).toString('hex'),
	WALLET_ENCRYPTION_KEY: process.env.HOME_E2E_ENC_KEY || randomBytes(32).toString('hex'),
	APP_ORIGIN,
	ISSUER: APP_ORIGIN,
	MCP_RESOURCE: `${APP_ORIGIN}/api/mcp`,
	JWT_KID: 'home-e2e',
	NODE_ENV: 'development',
	// The house this lane drives is a container on loopback, and the URL guard
	// refuses private addresses unless a non-production process opts in. Without
	// this every journey fails at connect with "127.0.0.1 is a private address",
	// which reads as a product bug and is a missing flag.
	HOME_ALLOW_LOCAL_INSTANCE: '1',
};

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: /home-.*\.spec\.js$/,
	globalSetup: './tests/e2e/home-global-setup.js',
	// A journey that drives a real house through a real API is not fast, and a
	// tight timeout here would produce exactly the phantom failures this lane
	// cannot afford. Every wait inside a spec is still a wait on a condition.
	timeout: 240_000,
	// Retries train people to ignore a suite that guards a door: a journey that
	// only passes on the second attempt has told us something, and hiding it is
	// how the finding gets lost.
	retries: 0,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: APP_ORIGIN,
		headless: true,
		// Evidence mode. Several of this lane's requirements are answered with a
		// picture rather than an assertion (the four breakpoints, an RTL locale,
		// a user's device name unchanged in two languages, a Fahrenheit house in
		// a Celsius browser), and a reviewer asking for those should not have to
		// break a passing test to get them. `HOME_E2E_SCREENSHOTS=1` captures one
		// per test into the output directory; the default stays failure-only, so
		// an ordinary run writes nothing it does not need to.
		screenshot: process.env.HOME_E2E_SCREENSHOTS ? 'on' : 'only-on-failure',
		video: 'retain-on-failure',
		trace: 'retain-on-failure',
	},
	webServer: [
		{
			// The same handlers Cloud Run runs, against the same database.
			command: `node --env-file=.env.local server/index.mjs`,
			// /api/version, not /api/home: the home endpoint answers an anonymous GET
			// with 401, and Playwright waits out the whole timeout rather than
			// treating that as ready. /api/version returns 200 and proves the same
			// thing, that the route table is loaded and handlers are mounted.
			url: `http://127.0.0.1:${API_PORT}/api/version`,
			timeout: 180_000,
			reuseExistingServer: false,
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...localSecrets, PORT: String(API_PORT) },
		},
		{
			command: `npx vite --port ${WEB_PORT} --strictPort`,
			url: APP_ORIGIN,
			timeout: 240_000,
			reuseExistingServer: false,
			stdout: 'pipe',
			stderr: 'pipe',
			env: {
				DEV_API_PROXY: `http://127.0.0.1:${API_PORT}`,
				// No hot reload, for two independent reasons.
				//
				// The noisy one: vite.config.js points the HMR client at
				// `<codespace>-<port>.app.github.dev` whenever it sees
				// CODESPACE_NAME, which is right for a developer opening a
				// forwarded port and wrong here, where the browser is headless,
				// reaches vite on localhost, and the lane's port is not
				// forwarded. The handshake 404s and every page collects three
				// console errors and a pageerror it did not cause, which a
				// journey asserting a clean console then fails on.
				//
				// The damaging one, and the reason this is off rather than
				// merely repointed: concurrent agents edit src/ in this shared
				// worktree while a journey is running, and a connected HMR
				// client reloads the page on each of their saves. Journey 9e
				// died exactly that way, on a navigation that arrived between
				// naming a room and clicking File.
				//
				// Deliberately not solved by widening a spec's console-noise
				// filter: that would hide the errors and keep the reloads, and
				// the home lane has real websockets of its own to assert on.
				VITE_NO_HMR: '1',
			},
		},
	],
});

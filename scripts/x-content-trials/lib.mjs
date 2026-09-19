// Shared harness for X content feature trials (data/x-content/trials/<id>.json).
//
// A trial's `command` step runs one of the scripts in this directory, which
// drives a real production journey against https://three.ws and exits 0 only
// when the reader-visible outcome happened. Each script takes the name of one
// check, so every promise in a post maps to its own step in the trial record.
//
// Host pages: a widget promise ("add the tag to your site") is proven on a site
// that is not three.ws. `hostPage` serves a small third-party page from a
// reserved .example origin through Playwright routing, so the real embed script,
// frame, API and models all load from production exactly as they would on a
// customer's site. Nothing here is mocked: only the host HTML is synthetic.

import { chromium } from 'playwright';

export const BASE = process.env.TRIAL_BASE_URL || 'https://three.ws';
export const HOST_ORIGIN = 'https://acme-trial.example';

export function log(message) {
	process.stdout.write(`${message}\n`);
}

export function fail(message) {
	process.stderr.write(`FAIL: ${message}\n`);
	process.exit(1);
}

export async function launch() {
	return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
}

// A page on a third-party origin whose HTML is `html`. Every other request
// (the three.ws embed, its frame, the API, the GLBs) goes to the network.
export async function hostPage(browser, html) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
	await context.route(`${HOST_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (err) => errors.push(err.message));
	await page.goto(`${HOST_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	return { context, page, errors };
}

// Poll `probe` until it returns a truthy value or the deadline passes.
export async function waitFor(probe, { timeoutMs = 60_000, intervalMs = 500, what = 'condition' } = {}) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		last = await probe();
		if (last) return last;
		await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
	}
	throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}`);
}

// Sign in as the production QA account (AUDIT_EMAIL / AUDIT_PASSWORD, loaded
// from .env by the x:content CLI) and return a Cookie header value. The
// credentials never leave this process.
export async function qaSessionCookie() {
	const email = process.env.AUDIT_EMAIL;
	const password = process.env.AUDIT_PASSWORD;
	if (!email || !password) fail('AUDIT_EMAIL and AUDIT_PASSWORD are not set; run `npm run audit:web:provision` (docs/ops/page-audit.md)');
	const res = await fetch(`${BASE}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	if (!res.ok) fail(`QA sign-in answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const jar = (res.headers.getSetCookie?.() || []).map((cookie) => cookie.split(';')[0]).join('; ');
	if (!jar) fail('QA sign-in set no session cookie');
	return jar;
}

// Run `checks[name]`, print its evidence line, and exit with its verdict.
export async function runCheck(checks, name) {
	const check = checks[name];
	if (!check) fail(`unknown check "${name}"; one of: ${Object.keys(checks).join(', ')}`);
	try {
		const evidence = await check();
		log(`ok: ${evidence}`);
		process.exit(0);
	} catch (err) {
		fail(err?.message || String(err));
	}
}

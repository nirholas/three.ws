/**
 * Every screen of the /smart-home connect flow, at both ends of the viewport
 * range, photographed and measured.
 *
 * The flow has fifteen states and the failure mode this guards is not a broken
 * one: it is a state that was never opened. A screen only somebody's happy path
 * reaches gets designed once and then drifts, and the first person to see it
 * again is a stranger whose token was rejected at 320px.
 *
 * So this walks all fifteen in one run, writes a PNG of each at 1440px and at
 * 320px into test-results/home-connect-states/, and asserts the thing a
 * screenshot cannot: that no state overflows a 320px viewport sideways. The
 * images are evidence for a human; the overflow measurement is the test.
 *
 * The API is stubbed (see home-connect-stubs.js) because a photograph of state
 * 12 must not depend on a real plan ceiling being hit. Everything above the API
 * boundary is the shipped page.
 */

import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { CSRF, HOME, json, LIST, PAGE, SLOW, stub } from './home-connect-stubs.js';

// Not test-results/: Playwright wipes its output directory at the start of
// every run, so evidence written there is destroyed by the next lane to run.
// reports/ is the repo's home for generated evidence, and it is gitignored.
const OUT = path.join('reports', 'home-connect-states');
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 320, height: 720 };

const root = (page) => page.locator('#hm-root');

fs.mkdirSync(OUT, { recursive: true });

/**
 * One screen, reached the way a person reaches it, then photographed at both
 * widths and measured at the narrow one.
 *
 * @param {string} name the file stem, prefixed with the state's number
 * @param {(page: import('@playwright/test').Page) => Promise<void>} reach
 * @param {string} expected the `data-state` the page must be in when it lands
 */
function screen(name, expected, reach) {
	test(`${name} renders, fits a 320px screen and logs nothing`, async ({ page }) => {
		// Console noise is per-state too, and it is only ever found by opening the
		// state. A warning that fires once, on the plan ceiling, is exactly the
		// kind nobody sees until a paying customer hits it.
		const noise = [];
		page.on('console', (msg) => {
			if (msg.type() !== 'error' && msg.type() !== 'warning') return;
			const text = msg.text();
			// The dev server's own HMR socket cannot reach this Codespace, and a
			// route the spec deliberately fulfils with a 401 is answered, not
			// broken. Neither is page code.
			if (/\[vite\]|websocket|HMR|Failed to load resource: the server responded with a status of 401/i.test(text)) return;
			noise.push(`${msg.type()}: ${text}`);
		});

		await page.setViewportSize(DESKTOP);
		await reach(page);
		await expect(root(page)).toHaveAttribute('data-state', expected, { timeout: SLOW });
		await page.screenshot({ path: path.join(OUT, `${name}-1440.png`), fullPage: true });

		await page.setViewportSize(MOBILE);
		// The reflow is a layout pass, not an animation: waiting on the measured
		// width rather than a timeout keeps this honest on a slow machine.
		await expect
			.poll(() => page.evaluate(() => document.documentElement.clientWidth), { timeout: 10_000 })
			.toBe(MOBILE.width);
		await page.screenshot({ path: path.join(OUT, `${name}-320.png`), fullPage: true });

		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(overflow, `${name} pushes the page sideways at 320px`).toBeLessThanOrEqual(0);
		expect(noise, `${name} wrote to the console`).toEqual([]);
	});
}

/** A house whose label is longer than any column, to prove truncation. */
const LONG = {
	...HOME,
	id: '7d1e2f30-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
	label: 'The house at the end of the very long road that somebody typed the whole name of',
	base_url: 'https://a-very-long-subdomain-somebody-actually-uses.duckdns.example.com',
};

test.describe('/smart-home, every state', () => {
	screen('01-signed-out', 'signed_out', async (page) => {
		await page.route(LIST, (route) => route.fulfill(json({ error: 'unauthorized' }, 401)));
		await page.goto(PAGE);
	});

	screen('02-empty', 'empty', async (page) => {
		await stub(page);
		await page.goto(PAGE);
	});

	screen('03-validating', 'validating', async (page) => {
		await stub(page);
		await page.goto(PAGE);
		await expect(page.locator('#hm-url')).toBeVisible({ timeout: SLOW });
		await page.locator('#hm-url').fill('http://homeassistant.local:8123');
		await page.locator('#hm-url').blur();
	});

	screen('04-private-host', 'private_host', async (page) => {
		await stub(page);
		await page.goto(PAGE);
		await expect(page.locator('#hm-url')).toBeVisible({ timeout: SLOW });
		await page.fill('#hm-label', 'Home');
		await page.fill('#hm-url', 'http://192.168.1.10:8123');
		await page.fill('#hm-token', 'never-sent');
		await page.click('button[type="submit"]');
	});

	screen('05-verifying', 'verifying', async (page) => {
		// A connect that never answers: this is the state as a person on a slow
		// house actually sees it, held still long enough to be photographed.
		await stub(page, { onConnect: () => new Promise(() => {}) });
		await page.goto(PAGE);
		await expect(page.locator('#hm-url')).toBeVisible({ timeout: SLOW });
		await page.fill('#hm-label', 'Home');
		await page.fill('#hm-url', 'https://home.example.com');
		await page.fill('#hm-token', 'a-token');
		await page.click('button[type="submit"]');
	});

	screen('06-connected', 'connected', async (page) => {
		await stub(page, { homes: [HOME] });
		await page.goto(PAGE);
	});

	screen('07-auth-failed', 'auth_failed', async (page) => {
		await stub(page, { onConnect: () => json({ code: 'auth', message: 'Home Assistant rejected that token.' }, 401) });
		await page.goto(PAGE);
		await expect(page.locator('#hm-url')).toBeVisible({ timeout: SLOW });
		await page.fill('#hm-label', 'Home');
		await page.fill('#hm-url', 'https://home.example.com');
		await page.fill('#hm-token', 'a-stale-token');
		await page.click('button[type="submit"]');
	});

	screen('08-unreachable', 'unreachable', async (page) => {
		await stub(page, { onConnect: () => json({ code: 'unreachable', message: 'home.example.com did not answer.' }, 502) });
		await page.goto(PAGE);
		await expect(page.locator('#hm-url')).toBeVisible({ timeout: SLOW });
		await page.fill('#hm-label', 'Home');
		await page.fill('#hm-url', 'https://home.example.com');
		await page.fill('#hm-token', 'a-token');
		await page.click('button[type="submit"]');
	});

	screen('09-degraded', 'degraded', async (page) => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		await stub(page, { homes: [{ ...HOME, last_ok_at: twoHoursAgo }] });
		await page.goto(PAGE);
	});

	screen('10-revoked', 'revoked', async (page) => {
		let disconnected = false;
		await page.route(CSRF, (route) => route.fulfill(json({ token: 'csrf-test-token' })));
		await page.route(LIST, (route) => route.fulfill(json({ homes: disconnected ? [] : [HOME] })));
		await page.route(`**/api/home/${HOME.id}`, (route) => {
			disconnected = true;
			return route.fulfill(json({ ok: true }));
		});
		await page.goto(PAGE);
		await expect(root(page)).toHaveAttribute('data-state', 'connected', { timeout: SLOW });
		await page.getByRole('button', { name: /disconnect/i }).first().click();
		await page.getByRole('button', { name: /disconnect .* erase/i }).click();
	});

	screen('11-many-homes', 'many', async (page) => {
		await stub(page, {
			homes: [
				HOME,
				LONG,
				{ ...HOME, id: '3c4d5e6f-7a8b-49cd-8e0f-1a2b3c4d5e6f', label: 'The office', status: 'unreachable', status_detail: 'Not answering right now.' },
				{ ...HOME, id: '4d5e6f70-8b9c-4ade-9f01-2b3c4d5e6f70', label: 'The cabin', status: 'auth_failed', status_detail: 'Home Assistant rejected the stored token.' },
			],
		});
		await page.goto(PAGE);
	});

	screen('12-quota-reached', 'quota_reached', async (page) => {
		await stub(page, {
			homes: [HOME],
			onConnect: () => json({ code: 'quota', message: 'Your plan covers one home.', quota: { limit: 1, used: 1, tier: 'free', upgrade: '/pricing' } }, 402),
		});
		await page.goto(PAGE);
		await expect(root(page)).toHaveAttribute('data-state', 'connected', { timeout: SLOW });
		await page.getByRole('button', { name: 'Connect another' }).click();
		await page.fill('#hm-label', 'The cabin');
		await page.fill('#hm-url', 'https://cabin.example.com');
		await page.fill('#hm-token', 'a-token');
		await page.click('button[type="submit"]');
	});

	screen('13-pairing', 'pairing', async (page) => {
		await stub(page);
		await page.goto(PAGE);
		await expect(page.locator('#hm-url')).toBeVisible({ timeout: SLOW });
		await page.fill('#hm-label', 'Home');
		await page.fill('#hm-url', 'http://192.168.1.10:8123');
		await page.fill('#hm-token', 'never-sent');
		await page.click('button[type="submit"]');
		await page.getByRole('button', { name: /only on my network/i }).click();
	});

	screen('14-one-home', 'one_home', async (page) => {
		await stub(page, { homes: [HOME, LONG] });
		await page.goto(`/smart-home/${HOME.id}/settings`);
	});

	screen('15-not-found', 'not_found', async (page) => {
		await stub(page, { homes: [HOME] });
		await page.goto('/smart-home/00000000-0000-4000-8000-000000000000/settings');
	});
});

/**
 * The connect flow against a REAL Home Assistant, with nothing stubbed.
 *
 * home-connect.spec.js asserts the flow's twelve screens at the API boundary,
 * which is the right place for "what does state 12 look like". It cannot answer
 * the three questions this file exists for, because all three are about the
 * wire:
 *
 *   1. Does a real house actually connect, and is the summary on the card the
 *      house's own numbers rather than something we assumed? A stub returns
 *      whatever we wrote in it, so a capabilities block that was quietly a
 *      guess would pass every test in that file. (It was: `haVersion` used to
 *      be scraped off an `update.*` entity and reported 1.0.0.)
 *   2. Does the access token really go nowhere? Asserting it against a stub
 *      proves the page did not leak a string we invented. Asserting it against
 *      a real long-lived token, after a real POST that really stored it
 *      encrypted, is the actual promise.
 *   3. What happens when the house stops answering? Not "what does the page
 *      render for a row with an old timestamp", which is what a stub can say,
 *      but what a person sees when the power goes out: the container is really
 *      stopped, and the room list has to still be there.
 *
 * Runs under playwright.home.config.js (`npm run test:home:e2e`), which brings
 * up the house, the API and the frontend. It is serial on purpose: each test
 * builds on the connection the one before it made, exactly as a person does.
 */

import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { startHomeInstance, stopHomeInstance } from '../_helpers/home-instance.js';
import { homeInstance, laneName, resetHomes, signIn } from './home-support.js';

// Not test-results/: Playwright wipes its output directory at the start of
// every run, so evidence written there is destroyed by the next lane to run.
// reports/ is the repo's home for generated evidence, and it is gitignored.
const OUT = path.join('reports', 'home-connect-live');
const LABEL = 'The live house';

test.describe.configure({ mode: 'serial' });

fs.mkdirSync(OUT, { recursive: true });

/** The house's own id on the platform, carried between the serial tests. */
let homeId = null;

/**
 * Open the connect card, whatever this account already holds.
 *
 * The QA account is shared with every other home lane running on this machine,
 * and `resetHomes` deliberately only clears the houses on THIS lane's Home
 * Assistant: deleting a peer's home mid-journey is how two runs both fail
 * reporting product bugs neither of them has. So the page may legitimately open
 * on the manage view rather than the empty state, and the way a person reaches
 * the form from there is the button that says so.
 */
async function openConnectCard(page) {
	await page.goto('/smart-home', { waitUntil: 'domcontentloaded' });
	// Either screen is a correct landing: the form when the account is empty,
	// the list when it is not. Waiting for whichever arrived beats waiting for
	// one of them and calling the other a failure.
	await page.waitForSelector('#hm-url, .hm-card', { timeout: 120_000 });
	if (await page.locator('#hm-url').count()) return;
	await page.getByRole('button', { name: 'Connect another' }).click();
	await expect(page.locator('#hm-url')).toBeVisible({ timeout: 60_000 });
}

/** How many houses this account can see, peers' lanes included. */
async function homeCount(page) {
	const res = await page.request.get('/api/home', { timeout: 60_000 });
	const body = await res.json().catch(() => null);
	return (Array.isArray(body?.homes) ? body.homes : []).length;
}

/**
 * This lane's house, as its own row on the page.
 *
 * The row, not `.hm-card`: the card is the header (label, address, status,
 * buttons) and the measured summary, health, household, grants and log are its
 * siblings inside the same list item. Scoping to `.hm-card` finds the label and
 * then cannot see the numbers underneath it.
 */
function card(page) {
	return page.locator('.hm-list > li').filter({ hasText: LABEL });
}

test.describe('/smart-home against a real Home Assistant', () => {
	test('a real house connects, and the summary is the house\'s own numbers', async ({ page }) => {
		const house = homeInstance();
		await signIn(page, 'owner');
		await resetHomes(page);

		// Everything that crosses the network, recorded, so the transcript in the
		// report is the run's own evidence and not a retelling of it.
		const transcript = [];
		page.on('request', (req) => {
			if (req.url().includes('/api/')) transcript.push({ at: new Date().toISOString(), method: req.method(), url: req.url() });
		});
		const consoleLines = [];
		page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
		const connectResponse = page.waitForResponse((res) => res.request().method() === 'POST' && /\/api\/home$/.test(new URL(res.url()).pathname), { timeout: 180_000 });

		await openConnectCard(page);

		await page.fill('#hm-label', LABEL);
		await page.fill('#hm-url', house.baseUrl);
		await page.fill('#hm-token', house.token);
		await page.getByRole('button', { name: 'Connect this home' }).click();

		const res = await connectResponse;
		expect(res.status(), 'a real house that answers is a 201').toBe(201);
		const bodyText = await res.text();
		const body = JSON.parse(bodyText);

		// The house is on the page under its own label. The root state is asserted
		// against `connected` only when this house is the only one on the account,
		// because a peer lane's home makes the list legitimately `many`.
		await expect(card(page)).toHaveCount(1, { timeout: 180_000 });
		homeId = body.home.id;
		if ((await homeCount(page)) === 1) {
			await expect(page.locator('#hm-root')).toHaveAttribute('data-state', 'connected');
		}

		// The house's own numbers, checked against the house rather than against
		// the card. `/api/config` is where the version really lives.
		const config = await fetch(`${house.baseUrl}/api/config`, { headers: { authorization: `Bearer ${house.token}` } }).then((r) => r.json());
		const caps = body.capabilities || body.home.capabilities;
		expect(caps.haVersion, 'the version has to be the house\'s, not a guess off an entity').toBe(config.version);
		expect(caps.entityCount).toBeGreaterThan(0);
		expect(caps.areaCount).toBeGreaterThan(0);

		// And the card is showing those numbers, not different ones.
		await expect(card(page).locator('.hm-stats').first()).toContainText(String(caps.entityCount));
		await expect(card(page).locator('.hm-stats').first()).toContainText(caps.haVersion);

		// The token: absent from the response, from every URL, from the console,
		// from both storages and from the cookie jar.
		expect(bodyText, 'the API must never echo the token').not.toContain(house.token);
		for (const entry of transcript) expect(entry.url).not.toContain(house.token);
		for (const line of consoleLines) expect(line).not.toContain(house.token);
		const leaks = await page.evaluate((token) => {
			const dump = (store) => {
				try {
					return Object.keys(store).map((k) => `${k}=${store.getItem(k)}`).join('\n');
				} catch {
					return '';
				}
			};
			return {
				local: dump(window.localStorage).includes(token),
				session: dump(window.sessionStorage).includes(token),
				cookie: document.cookie.includes(token),
				url: window.location.href.includes(token),
				localKeys: Object.keys(window.localStorage).length,
			};
		}, house.token);
		expect(leaks.local, 'the token reached localStorage').toBe(false);
		expect(leaks.session, 'the token reached sessionStorage').toBe(false);
		expect(leaks.cookie, 'the token reached a cookie').toBe(false);
		expect(leaks.url, 'the token reached the URL').toBe(false);

		// And the page said nothing to the console on the way through. Two things
		// here are Chromium talking to itself rather than the page talking: the
		// dev server's HMR socket, which cannot reach this Codespace, and the GPU
		// process reporting a stall in its own software rasteriser under headless
		// (`GL Driver Message`, a string no page code can emit). Everything else
		// is the page and fails.
		const noise = consoleLines.filter((line) => !/\[vite\]|websocket|GL Driver Message/i.test(line));
		expect(noise, 'the connect flow wrote to the console').toEqual([]);

		// The field is cleared the moment the connect lands, so a shoulder over
		// the screen and a back button both find nothing.
		await expect(page.locator('#hm-token')).toHaveCount(0);

		fs.writeFileSync(
			path.join(OUT, 'connect-transcript.json'),
			`${JSON.stringify({
				houseVersion: config.version,
				status: res.status(),
				capabilities: caps,
				requests: transcript,
				console: consoleLines,
			}, null, '\t')}\n`,
		);
		await page.screenshot({ path: path.join(OUT, 'connected-live.png'), fullPage: true });
	});

	test('stopping the house puts it into state 9 with the room list still on screen', async ({ page }) => {
		expect(homeId, 'the connect test has to have run first').toBeTruthy();
		await signIn(page, 'owner');

		// What the card said while the house was up, so the comparison after is
		// against a measurement and not against a memory.
		await page.goto('/smart-home', { waitUntil: 'domcontentloaded' });
		await expect(card(page)).toHaveCount(1, { timeout: 120_000 });
		// The measured summary as the house is right now: rooms, devices, scenes
		// and version. This is what has to survive the house going away.
		const summaryBefore = await card(page).locator('.hm-stat').allTextContents();
		expect(summaryBefore.length, 'a connected house shows its measured summary').toBeGreaterThan(0);
		const alone = (await homeCount(page)) === 1;

		await stopHomeInstance({ name: laneName() });
		try {
			// A dial the product itself makes. Reading the macros is a plain read,
			// and it is what turns "the container is stopped" into "three.ws knows
			// this house is not answering".
			//
			// One read is not always enough, and assuming it was made this test
			// pass or fail on whether an earlier spec happened to leave a warm
			// socket in the pool. A cold pool re-handshakes and fails instantly; a
			// warm one answers this read off the bridge it already holds and only
			// learns the house is gone when its liveness ping goes unanswered.
			// That is the product's real, documented bound (see #startLiveness in
			// packages/home-bridge/src/bridge.js: a 10 s ping with a 5 s deadline,
			// so 15 s worst case), so poll to it rather than asserting a 5 s bound
			// the platform never promised. The invariant under test is unchanged
			// and still strict: a stopped house must stop reading Live.
			await expect
				.poll(
					async () => {
						await page.request.get(`/api/home/${homeId}/macros`, { timeout: 120_000 }).catch(() => null);
						const res = await page.request.get('/api/home', { timeout: 60_000 });
						const body = await res.json().catch(() => null);
						const mine = (body?.homes || []).find((h) => h.id === homeId);
						// The same judgement the card makes (isDegraded in
						// src/home/manage.js): the house is refusing us, its token
						// is being rejected, or it is connected on paper but has
						// not answered inside the stale window.
						if (!mine) return false;
						if (mine.status !== 'connected') return true;
						const lastOk = Date.parse(mine.last_ok_at || '');
						const lastErr = Date.parse(mine.last_error_at || '');
						return Number.isFinite(lastErr) && (!Number.isFinite(lastOk) || lastErr > lastOk);
					},
					{
						message: 'a house whose container was stopped must stop reading connected inside the liveness window',
						timeout: 60_000,
						intervals: [1_000, 2_000, 3_000, 5_000],
					},
				)
				.toBe(true);

			await page.goto('/smart-home', { waitUntil: 'domcontentloaded' });
			await expect(card(page)).toHaveCount(1, { timeout: 120_000 });

			// The whole point of state 9: the last known house stays on screen.
			// Emptying the card because the socket dropped would read as the home
			// having been deleted, which is the one thing it must never look like.
			const summaryAfter = await card(page).locator('.hm-stat').allTextContents();
			expect(summaryAfter, 'a house that stopped answering must keep its last known summary').toEqual(summaryBefore);
			await expect(card(page).locator('.hm-status')).toContainText(/not answering|last answered/i);
			// And the page names the state, when this house is the only one on the
			// account. With a peer lane's home alongside it the list is `many`,
			// which is equally correct and is asserted in home-connect.spec.js.
			if (alone) await expect(page.locator('#hm-root')).toHaveAttribute('data-state', 'degraded');
			await page.screenshot({ path: path.join(OUT, 'degraded-live.png'), fullPage: true });
		} finally {
			await startHomeInstance({ name: laneName() });
		}

		// And it comes back on its own once the house does, with no reconnect and
		// no new token.
		await expect
			.poll(async () => {
				await page.request.get(`/api/home/${homeId}/macros`, { timeout: 120_000 }).catch(() => null);
				const res = await page.request.get('/api/home', { timeout: 60_000 });
				const body = await res.json().catch(() => null);
				return (body?.homes || []).find((h) => h.id === homeId)?.status;
			}, { timeout: 180_000, intervals: [5_000] })
			.toBe('connected');
	});

	test('the whole connect is completable from the keyboard, against a real house', async ({ page }) => {
		const house = homeInstance();
		await signIn(page, 'owner');
		await resetHomes(page);

		await openConnectCard(page);

		// Tab from the top of the document until the label field has focus, then
		// walk the form. Counting the stops rather than clicking is the test: a
		// control that cannot be reached by Tab is invisible to a keyboard user
		// however good it looks.
		const stops = [];
		for (let i = 0; i < 40; i += 1) {
			await page.keyboard.press('Tab');
			const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim().slice(0, 24) || document.activeElement?.tagName);
			stops.push(id);
			if (id === 'hm-label') break;
		}
		expect(stops.at(-1), 'the label field has to be reachable by Tab').toBe('hm-label');

		await page.keyboard.type('Keyboard house');
		await page.keyboard.press('Tab');
		await expect(page.locator('#hm-url')).toBeFocused();
		await page.keyboard.type(house.baseUrl);
		await page.keyboard.press('Tab');
		await expect(page.locator('#hm-token')).toBeFocused();
		await page.keyboard.type(house.token);

		// Enter inside the form submits it, so nobody has to Tab past the reveal
		// toggle to find the button.
		await page.keyboard.press('Enter');
		await expect(page.locator('.hm-list > li').filter({ hasText: 'Keyboard house' })).toHaveCount(1, { timeout: 180_000 });

		fs.writeFileSync(path.join(OUT, 'keyboard-walkthrough.json'), `${JSON.stringify({ tabStops: stops }, null, '\t')}\n`);
	});

	test('a token a real house rejects lands on state 7, not on a generic failure', async ({ page }) => {
		const house = homeInstance();
		await signIn(page, 'owner');
		await resetHomes(page);

		// A stub can prove the page maps code `auth` onto state 7. It cannot prove
		// the thing in front of it: that a real Home Assistant answering a real
		// bad token with 401 is classified as `auth` at all rather than falling
		// into the generic branch. That classification lives on the server, on the
		// wire, and it is the difference between "create a new token" and "that
		// did not work", which is the difference between a user recovering and a
		// user giving up on an address that was never wrong.
		await openConnectCard(page);
		await page.fill('#hm-label', 'Rejected token');
		await page.fill('#hm-url', house.baseUrl);
		await page.fill('#hm-token', 'not-a-real-long-lived-access-token');

		const rejected = page.waitForResponse(
			(res) => res.request().method() === 'POST' && /\/api\/home$/.test(new URL(res.url()).pathname),
			{ timeout: 180_000 },
		);
		await page.getByRole('button', { name: 'Connect this home' }).click();
		const res = await rejected;
		const body = await res.json().catch(() => null);
		expect(res.status(), 'a house that refuses the token is a 4xx, never a 5xx').toBeLessThan(500);
		expect(body?.code, 'the wire code the page branches on').toBe('auth');

		await expect(page.locator('#hm-root')).toHaveAttribute('data-state', 'auth_failed', { timeout: 60_000 });
		// Refocused on the field that has to change. Sending a keyboard user back
		// to the top of the form to walk it again is the dead end this replaces.
		await expect(page.locator('#hm-token')).toBeFocused();
		// And it says which thing is wrong, with the path to a fresh one.
		await expect(page.locator('.hm-notice')).toContainText(/rejected that token/i);
		await expect(page.locator('.hm-notice')).toContainText(/Long-lived access tokens/i);
		// The address the user typed survives, because it was never the problem.
		await expect(page.locator('#hm-url')).toHaveValue(house.baseUrl);
		// Nothing was stored: a refused token must not leave a half-home behind.
		const after = await page.request.get('/api/home', { timeout: 60_000 }).then((r) => r.json());
		expect((after.homes || []).some((h) => h.label === 'Rejected token')).toBe(false);

		await page.screenshot({ path: path.join(OUT, 'auth-failed-live.png'), fullPage: true });
	});
});

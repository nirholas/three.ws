/**
 * /smart-home, the connect flow, driven in a real browser.
 *
 * This page has no single "content" state. It resolves who is asking, what they
 * have already connected, and what the house said, then renders exactly one of
 * twelve screens. Every defect asserted below is invisible to a unit test,
 * because it only exists once the browser has run the flow:
 *
 *   - The private-host refusal has to cost ZERO network calls. It is the whole
 *     reason the reachability rules are duplicated into the browser: a
 *     192.168.x.x address is unreachable by definition, and waiting fifteen
 *     seconds to say so is a worse version of a sentence we could say on the
 *     keystroke. A unit test can assert the predicate; only a browser can prove
 *     nothing was sent.
 *   - A rejected token must return focus to the token field. Sending a keyboard
 *     user back to the top of the form to walk it again is the difference
 *     between a designed failure and a dead end, and focus is not observable
 *     without a real document.
 *   - The access token must not survive anywhere in the browser. Asserting
 *     "we never call localStorage.setItem" is a proxy; asserting the token is
 *     absent from localStorage, sessionStorage, the URL and every response body
 *     after a real submit is the actual promise.
 *   - Every string that came from a house is rendered as text. A label
 *     containing markup has to appear as characters, not as elements.
 *
 * The session and the API are fulfilled at the Playwright route layer, the way
 * the other flow specs in this directory do it, so the run needs no account and
 * no Home Assistant. Everything between the response and the assertion is the
 * shipped client code in src/home/.
 */

import { expect, test } from '@playwright/test';

import { CSRF, HOME, json, LIST, PAGE, SLOW, stub } from './home-connect-stubs.js';

const state = (page) => page.locator('#hm-root');

test.describe('/smart-home connect flow', () => {
	test('signed out offers a way in rather than a dead form', async ({ page }) => {
		await page.route(LIST, (route) => route.fulfill(json({ error: 'unauthorized' }, 401)));
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'signed_out', { timeout: SLOW });

		// A disabled form would look broken and explain nothing.
		await expect(page.locator('#hm-url')).toHaveCount(0);
		await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
	});

	test('the empty state carries the connect card and where to mint a token', async ({ page }) => {
		await stub(page);
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		await expect(page.locator('#hm-url')).toBeVisible();
		// The token instructions are inline, one disclosure away: nobody should
		// have to leave the page to find out where Home Assistant hides them.
		const help = page.getByRole('group').filter({ hasText: /where do i get an access token/i });
		await expect(help).toBeVisible();
		await help.getByText(/where do i get an access token/i).click();
		await expect(help.getByText(/scroll to long-lived access tokens/i)).toBeVisible();
	});

	test('a private address is refused with no network call at all', async ({ page }) => {
		await stub(page);
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		const sent = [];
		page.on('request', (r) => { if (r.url().includes('/api/')) sent.push(`${r.method()} ${r.url()}`); });

		await page.fill('#hm-label', 'Home');
		await page.fill('#hm-url', 'http://192.168.1.10:8123');
		await page.fill('#hm-token', 'a-token-that-must-never-be-sent');
		await page.click('button[type="submit"]');

		await expect(state(page)).toHaveAttribute('data-state', 'private_host');
		expect(sent, 'a LAN address must be refused before the network, not after a timeout').toEqual([]);

		// And it must name the two real ways round it, not just say no: the remote
		// https URL that works today, and letting the house dial out to us.
		await expect(page.getByRole('listitem').filter({ hasText: /remote https address/i })).toBeVisible();
		await expect(page.getByRole('listitem').filter({ hasText: /dial out to three\.ws/i })).toBeVisible();
	});

	test('typing a LAN address names the state and says so under the field', async ({ page }) => {
		// State 3 is the one that is easiest to leave implicit: an inline message
		// with the page still calling itself `empty`. Naming it is what makes it
		// assertable from outside, and the caret has to survive it, because a
		// validation that re-rendered the card would eject the person mid-word.
		await stub(page);
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		const sent = [];
		page.on('request', (r) => { if (r.url().includes('/api/')) sent.push(r.url()); });

		const url = page.locator('#hm-url');
		await url.click();
		await page.keyboard.type('http://192.168.1.10:8123');

		await expect(state(page)).toHaveAttribute('data-state', 'validating');
		await expect(url).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#hm-url-hint')).toContainText(/only on your home network/i);
		await expect(page.locator('#hm-url-hint')).toHaveAttribute('data-error', 'true');
		// The caret is still where they were typing, so the next keystroke lands.
		await expect(url).toBeFocused();
		expect(sent, 'validating as they type must cost nothing on the network').toEqual([]);

		// And it lets go again the moment the address becomes usable.
		await url.fill('https://home.example.com');
		await expect(state(page)).toHaveAttribute('data-state', 'empty');
		await expect(url).toHaveAttribute('aria-invalid', 'false');
		await expect(page.locator('#hm-url-hint')).not.toHaveAttribute('data-error', 'true');
	});

	test('a rejected token says so and puts focus back in the token field', async ({ page }) => {
		await stub(page, {
			onConnect: () => json({ error: 'auth', code: 'auth', message: 'Home Assistant rejected that access token.' }, 400),
		});
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		await page.fill('#hm-url', 'https://home.example.com');
		await page.fill('#hm-token', 'wrong');
		await page.click('button[type="submit"]');

		await expect(state(page)).toHaveAttribute('data-state', 'auth_failed');
		// The URL was fine, so the user must not be sent back to re-check it.
		await expect(page.locator('#hm-token')).toBeFocused();
		await expect(page.locator('#hm-url')).toHaveValue('https://home.example.com');
	});

	test('an unreachable house distinguishes itself from a wrong address', async ({ page }) => {
		await stub(page, {
			onConnect: () => json({ error: 'unreachable', code: 'unreachable', message: 'Could not reach https://home.example.com.' }, 502),
		});
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		await page.fill('#hm-url', 'https://home.example.com');
		await page.fill('#hm-token', 'a-plausible-token');
		await page.click('button[type="submit"]');

		await expect(state(page)).toHaveAttribute('data-state', 'unreachable');
		await expect(page.getByText(/check the house is online/i)).toBeVisible();
	});

	test('the plan ceiling offers the upgrade, not a form that would fail again', async ({ page }) => {
		await stub(page, {
			onConnect: () => json({
				error: 'quota_exceeded',
				code: 'quota_exceeded',
				message: 'Your plan covers 1 home.',
				quota: { dimension: 'homes', limit: 1, used: 1, tier: 'free', upgrade: '/pricing' },
			}, 402),
		});
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		await page.fill('#hm-url', 'https://home.example.com');
		await page.fill('#hm-token', 'a-plausible-token');
		await page.click('button[type="submit"]');

		await expect(state(page)).toHaveAttribute('data-state', 'quota_reached');
		// Re-submitting the same house would hit the same wall, so there is no form.
		await expect(page.locator('#hm-url')).toHaveCount(0);
		await expect(page.getByRole('link', { name: /see the plans/i })).toHaveAttribute('href', '/pricing');
	});

	test('a successful connect shows the measured house and drops the token', async ({ page }) => {
		let listed = [];
		await page.route(CSRF, (route) => route.fulfill(json({ token: 'csrf-test-token' })));
		await page.route(LIST, async (route) => {
			if (route.request().method() === 'POST') {
				listed = [HOME];
				return route.fulfill(json({ home: HOME, capabilities: HOME.capabilities }, 201));
			}
			return route.fulfill(json({ homes: listed }));
		});
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		await page.fill('#hm-url', 'https://home.example.com');
		await page.fill('#hm-token', 'a-real-looking-token');
		await page.click('button[type="submit"]');

		await expect(state(page)).toHaveAttribute('data-state', 'connected');
		// Measured, not assumed: the numbers came back from the house.
		await expect(page.getByText('120')).toBeVisible();
		await expect(page.getByText('2026.9.0')).toBeVisible();
		// The form is gone, and with it the field that held the credential.
		await expect(page.locator('#hm-token')).toHaveCount(0);
	});

	test('the token reaches no browser storage, no URL and no response body', async ({ page }) => {
		const CANARY = 'CANARY-TOKEN-do-not-store-me';
		const bodies = [];
		await stub(page, {
			onConnect: () => json({ error: 'unreachable', code: 'unreachable', message: 'Could not reach it.' }, 502),
		});
		page.on('response', async (r) => {
			if (!r.url().includes('/api/')) return;
			bodies.push(await r.text().catch(() => ''));
		});

		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });
		await page.fill('#hm-url', 'https://home.example.com');
		await page.fill('#hm-token', CANARY);
		await page.click('button[type="submit"]');
		await expect(state(page)).toHaveAttribute('data-state', 'unreachable');

		const found = await page.evaluate((canary) => {
			const dump = (s) => Array.from({ length: s.length }, (_, i) => s.getItem(s.key(i)) || '').join('\n');
			return {
				local: dump(localStorage).includes(canary),
				session: dump(sessionStorage).includes(canary),
				url: location.href.includes(canary),
			};
		}, CANARY);

		expect(found.local, 'the token must never be written to localStorage').toBe(false);
		expect(found.session, 'the token must never be written to sessionStorage').toBe(false);
		expect(found.url, 'the token must never appear in a URL').toBe(false);
		expect(bodies.some((b) => b.includes(CANARY)), 'the API must never echo the token back').toBe(false);
	});

	test('a label from a house is rendered as text, never as markup', async ({ page }) => {
		const hostile = '<img src=x onerror="window.__xss=1">Kitchen';
		await stub(page, { homes: [{ ...HOME, label: hostile }] });
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'connected', { timeout: SLOW });

		// The characters are on the page; the element is not, and nothing ran.
		await expect(page.locator('.hm-card-label')).toHaveText(hostile);
		await expect(page.locator('.hm-card-label img')).toHaveCount(0);
		expect(await page.evaluate(() => window.__xss)).toBeUndefined();
	});

	test('a house that stopped answering goes stale, and keeps its card', async ({ page }) => {
		// The distinction this asserts is the whole difference between a product
		// and a demo: when a house stops answering, the last known state stays on
		// screen marked stale with its age. Emptying the list because the socket
		// dropped would make a user think their home had been deleted.
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		await stub(page, { homes: [{ ...HOME, last_ok_at: twoHoursAgo }] });
		await page.goto(PAGE);
		// The page names it degraded rather than connected. A card that reads
		// "not answering" under `data-state="connected"` is the page disagreeing
		// with itself, and it is what made state 9 unassertable from outside.
		await expect(state(page)).toHaveAttribute('data-state', 'degraded', { timeout: SLOW });

		// The card is still there, and it says how long ago the house last spoke.
		await expect(page.locator('.hm-card')).toHaveCount(1);
		await expect(page.locator('.hm-status')).toContainText(/last answered 2 hours ago/i);
		await expect(page.locator('.hm-status')).toContainText(/showing the last state we saw/i);
		await expect(page.locator('.hm-dot-stale')).toBeVisible();
		// The measured summary survives too: a stale house is not an empty one.
		await expect(page.getByText('120')).toBeVisible();
	});

	test('a house that stopped answering is never told its address is wrong', async ({ page }) => {
		// The connect-time diagnosis and the ongoing status are different
		// sentences, and reusing the first as the second is worse than saying
		// nothing: this house answered ten minutes ago, so "if it is only on your
		// home network, use your remote https URL" would send somebody to
		// reconfigure a reverse proxy over what is actually a tripped breaker.
		// Found by stopping a real container in home-connect-live.spec.js.
		const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		await stub(page, {
			homes: [{
				...HOME,
				status: 'unreachable',
				status_detail: 'Could not reach https://home.example.com. If it is only on your home network, three.ws cannot route to it: use your remote https URL.',
				last_ok_at: tenMinutesAgo,
			}],
		});
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'degraded', { timeout: SLOW });

		const status = page.locator('.hm-status');
		await expect(status).toContainText(/not answering right now/i);
		await expect(status).toContainText(/last answered 10 minutes ago/i);
		await expect(status).not.toContainText(/remote https url/i);
		await expect(status).not.toContainText(/home network/i);
		// And the way back is still offered, because the house may simply need
		// turning on again.
		await expect(page.getByRole('button', { name: /try connecting again/i })).toBeVisible();
	});

	test('a house that never connected keeps the diagnosis that explains why', async ({ page }) => {
		// The mirror image: with no successful handshake behind it, the address
		// really may be the problem, and the sentence that says so is the useful
		// one. Losing it would leave a first-time connector with "not answering"
		// and nothing to act on.
		await stub(page, {
			homes: [{
				...HOME,
				status: 'unreachable',
				status_detail: 'Could not reach https://home.example.com. If it is only on your home network, three.ws cannot route to it: use your remote https URL.',
				last_ok_at: null,
			}],
		});
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'degraded', { timeout: SLOW });
		await expect(page.locator('.hm-status')).toContainText(/remote https url/i);
	});

	test('a house answering right now reads as live, not stale', async ({ page }) => {
		await stub(page, { homes: [{ ...HOME, last_ok_at: new Date().toISOString() }] });
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'connected', { timeout: SLOW });

		await expect(page.locator('.hm-status')).toContainText(/live/i);
		await expect(page.locator('.hm-dot-connected')).toBeVisible();
		await expect(page.locator('.hm-dot-stale')).toHaveCount(0);
	});

	test('a rejected stored token explains itself in the list', async ({ page }) => {
		await stub(page, { homes: [{ ...HOME, status: 'auth_failed', status_detail: 'Home Assistant rejected the stored token.', last_ok_at: null }] });
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'degraded', { timeout: SLOW });

		await expect(page.locator('.hm-status')).toContainText(/rejected the stored token/i);
		await expect(page.locator('.hm-dot-auth_failed')).toBeVisible();
	});

	test('a deep link opens that one home, not the whole list again', async ({ page }) => {
		// The route existed before the state did, which made "Open" on a card a
		// link back to the page it was already on. A button that goes nowhere is
		// the defect this asserts against.
		const other = { ...HOME, id: '9c8b7a65-4321-4dcb-a987-0123456789ab', label: 'The office' };
		await stub(page, { homes: [HOME, other] });
		// `/smart-home/<id>` is the 3D house now; the one-home settings card that
		// this flow is about lives at `/smart-home/<id>/settings`.
		await page.goto(`/smart-home/${HOME.id}/settings`);
		await expect(state(page)).toHaveAttribute('data-state', 'one_home', { timeout: SLOW });

		await expect(page.locator('.hm-card')).toHaveCount(1);
		await expect(page.locator('.hm-panel-title').first()).toHaveText(HOME.label);
		await expect(page.getByText('The office')).toHaveCount(0);
		// And it offers the way back up, because a deep link is often the first
		// page somebody lands on.
		await expect(page.getByRole('link', { name: /all your homes/i })).toHaveAttribute('href', '/smart-home');
		// "Open" leads into the house itself, never back to the card we are on.
		await expect(page.getByRole('link', { name: /^open/i })).toHaveAttribute('href', `/smart-home/${HOME.id}`);
	});

	test('a deep link to a home that is not yours reveals nothing', async ({ page }) => {
		await stub(page, { homes: [HOME] });
		await page.goto('/smart-home/11111111-2222-4333-8444-555555555555/settings');
		await expect(state(page)).toHaveAttribute('data-state', 'not_found', { timeout: SLOW });

		await expect(page.getByText(/not on this account/i)).toBeVisible();
		// Nothing that would confirm the id exists somewhere else.
		await expect(page.getByText(/forbidden|belongs to user|exists/i)).toHaveCount(0);
	});

	test('a house whose token was rejected offers a prefilled reconnect', async ({ page }) => {
		await stub(page, { homes: [{ ...HOME, status: 'auth_failed', status_detail: 'Home Assistant rejected the stored token.' }] });
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'degraded', { timeout: SLOW });

		// Stating a problem and offering only "disconnect" is a dead end.
		await page.getByRole('button', { name: /reconnect with a new token/i }).click();
		await expect(state(page)).toHaveAttribute('data-state', 'empty');

		// The address it already knows is carried across; the token never is.
		await expect(page.locator('#hm-url')).toHaveValue(HOME.base_url);
		await expect(page.locator('#hm-label')).toHaveValue(HOME.label);
		await expect(page.locator('#hm-token')).toHaveValue('');
		await expect(page.locator('#hm-token')).toBeFocused();
	});

	test('the token field is a password field with a working reveal toggle', async ({ page }) => {
		await stub(page);
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		const field = page.locator('#hm-token');
		await expect(field).toHaveAttribute('type', 'password');
		await expect(field).toHaveAttribute('autocomplete', 'off');

		await page.getByRole('button', { name: 'Show' }).click();
		await expect(field).toHaveAttribute('type', 'text');
		await page.getByRole('button', { name: 'Hide' }).click();
		await expect(field).toHaveAttribute('type', 'password');
	});

	test('the whole connect is completable from the keyboard alone', async ({ page }) => {
		await stub(page, {
			onConnect: () => json({ error: 'unreachable', code: 'unreachable', message: 'Could not reach it.' }, 502),
		});
		await page.goto(PAGE);
		await expect(state(page)).toHaveAttribute('data-state', 'empty', { timeout: SLOW });

		await page.locator('#hm-label').focus();
		await page.keyboard.type('Home');
		await page.keyboard.press('Tab');
		await expect(page.locator('#hm-url')).toBeFocused();
		await page.keyboard.type('https://home.example.com');
		await page.keyboard.press('Tab');
		await expect(page.locator('#hm-token')).toBeFocused();
		await page.keyboard.type('a-token');
		// Tab reaches the reveal toggle, then the submit button.
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Show' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: /connect this home/i })).toBeFocused();
		await page.keyboard.press('Enter');

		await expect(state(page)).toHaveAttribute('data-state', 'unreachable');
	});
});

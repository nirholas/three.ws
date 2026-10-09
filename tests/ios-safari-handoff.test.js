// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://three.ws/create" }
/**
 * The iOS app's Safari handoff (ios/src/native-bridge.js).
 *
 * In the app, paying, launching a coin, trading and buying credits open in
 * Safari instead of the WebView, because App Review does not allow them inside
 * an iOS app outside In-App Purchase. Two halves have to agree for that to hold:
 * the bridge decides which pages and which agreements-gate contexts leave the
 * app, and the money flows ask it before they start. A regression in either
 * shows up for the first time as a rejection email, so both are pinned here.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeCapacitor() {
	const calls = [];
	return {
		calls,
		isNativePlatform: () => true,
		getPlatform: () => 'ios',
		Plugins: {
			Browser: { open: (opts) => (calls.push(['Browser.open', opts]), Promise.resolve()) },
			ThreeWsApp: {
				setBadge: () => Promise.resolve(),
				openInSafari: (opts) => (calls.push(['ThreeWsApp.openInSafari', opts]), Promise.resolve()),
			},
			App: { addListener: () => Promise.resolve({ remove() {} }) },
			PushNotifications: { addListener: () => Promise.resolve({ remove() {} }) },
		},
	};
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const sheet = () => document.querySelector('.tw-handoff');

describe('Safari handoff inside the iOS app', () => {
	let cap;
	let mod;
	const realFetch = globalThis.fetch;

	beforeAll(async () => {
		cap = fakeCapacitor();
		globalThis.Capacitor = cap;
		globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
		mod = await import('../ios/src/native-bridge.js');
		mod.bootNativeIOS();
	});

	afterAll(() => {
		delete globalThis.Capacitor;
		delete globalThis.threeWsNative;
		globalThis.fetch = realFetch;
	});

	beforeEach(() => {
		cap.calls.length = 0;
		document.querySelectorAll('.tw-handoff').forEach((el) => el.remove());
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		document.body.innerHTML = '';
	});

	describe('handoffPathFor', () => {
		it.each([
			['/launch', '/launch'],
			['/launch/paired?ref=x', '/launch/paired?ref=x'],
			['/launch/robinhood', '/launch/robinhood'],
			['/credits.html', '/credits.html'],
			['/pay/', '/pay/'],
			['https://www.three.ws/three-launchpad', '/three-launchpad'],
			['/markets/robinhood/desk', '/markets/robinhood/desk'],
		])('sends %s to Safari', (href, expected) => {
			expect(mod.handoffPathFor(href)).toBe(expected);
		});

		it.each([
			['/launches', 'the directory of launches, which only shows them'],
			['/pay/simulator', 'a policy simulator that spends nothing'],
			['/wallet', 'wallets stay in the app'],
			['/create', 'everything else stays in the app'],
			['https://example.com/launch', 'another site'],
		])('keeps %s in the app (%s)', (href) => {
			expect(mod.handoffPathFor(href)).toBeNull();
		});
	});

	it('exposes the hook money flows call', () => {
		expect(typeof globalThis.threeWsNative?.requireSafari).toBe('function');
	});

	it('keeps wallet steps in the app and sends spending steps to Safari', () => {
		for (const context of ['withdraw', 'deposit', 'claim', 'fund-agent', 'master-send', 'agreements-page']) {
			expect(mod.requireSafari(undefined, { context })).toBe(false);
		}
		expect(sheet()).toBeNull();
		for (const context of ['trade', 'launch', 'swap', 'x402-pay', 'onramp', 'give', 'a-context-added-later']) {
			expect(mod.requireSafari(undefined, { context })).toBe(true);
		}
		expect(sheet()).not.toBeNull();
	});

	it('the agreements gate declines and shows the sheet for a trade, in the app', async () => {
		const { ensureRiskAck } = await import('../public/risk-ack.js');
		await expect(ensureRiskAck({ context: 'trade' })).resolves.toBe(false);
		expect(sheet()).not.toBeNull();
	});

	it('leaveAppForPayment takes over in the app', async () => {
		const { leaveAppForPayment } = await import('../src/shared/native-handoff.js');
		expect(leaveAppForPayment('/credits')).toBe(true);
		expect(sheet()).not.toBeNull();
	});

	it('a link to a payment page opens the sheet instead of navigating', () => {
		document.body.innerHTML = '<a href="/launch?mint=abc" id="go">Launch</a>';
		const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		document.getElementById('go').dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
		const dialog = sheet();
		expect(dialog.getAttribute('role')).toBe('dialog');
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(document.activeElement?.hasAttribute('data-handoff-open')).toBe(true);
	});

	it('Open in Safari mints a code for this session and hands the URL to Safari', async () => {
		const minted = 'https://three.ws/api/auth/handoff?code=abc&next=%2Flaunch';
		globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ url: minted }) }));
		mod.requireSafari('/launch');
		sheet().querySelector('[data-handoff-open]').click();
		await flush();
		await flush();
		const [url, init] = globalThis.fetch.mock.calls[0];
		expect(url).toBe('/api/auth/handoff');
		expect(init.method).toBe('POST');
		expect(init.credentials).toBe('include');
		expect(JSON.parse(init.body)).toEqual({ next: '/launch' });
		expect(cap.calls).toContainEqual(['ThreeWsApp.openInSafari', { url: minted }]);
	});

	it('signed out, Safari still goes through the handoff URL so universal links cannot reclaim it', async () => {
		globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
		await mod.openInSafari('/launch?mint=abc');
		expect(cap.calls).toContainEqual([
			'ThreeWsApp.openInSafari',
			{ url: 'https://three.ws/api/auth/handoff?next=%2Flaunch%3Fmint%3Dabc' },
		]);
	});

	it('Not now closes the sheet and leaves the page alone', () => {
		mod.requireSafari('/launch');
		const dismiss = sheet().querySelector('[data-handoff-dismiss]');
		expect(dismiss.textContent).toBe('Not now');
		dismiss.click();
		expect(sheet().hasAttribute('data-open')).toBe(false);
		expect(location.pathname).toBe('/create');
	});
});

/**
 * The fixtures behind the /smart-home connect flow's browser specs.
 *
 * Shared by two specs that need the same twelve screens for different reasons:
 * home-connect.spec.js asserts behaviour on them, home-connect-gallery.spec.js
 * photographs them at 1440px and 320px. Keeping one copy of the stub means a
 * screen can never be asserted in one shape and captured in another.
 *
 * Everything stubbed here is the API boundary and nothing below it: the page,
 * the controller, the manage view and the reachability rules are all the
 * shipped code. The live counterpart, which stubs nothing at all and drives a
 * real Home Assistant, is home-connect-live.spec.js.
 */

export const PAGE = '/smart-home';
export const LIST = '**/api/home';
export const CSRF = '**/api/csrf-token';
export const STATUS = '**/api/status';

/** First hit transforms this page's module graph through the dev server. */
export const SLOW = 60_000;

/**
 * A house as the API returns it, measured against a real instance.
 *
 * The three timestamps are GETTERS, and that is the whole point of them. A
 * connected home whose last handshake has aged past 90 seconds is state 9, not
 * state 6, and the manage view is right to say so. Stamping `last_ok_at` once
 * when this module is imported therefore built a fixture with a 90-second fuse
 * in it: the first specs in a run saw a live house and every spec after the
 * ninety-second mark saw the same fixture as stale, so `connected` assertions
 * went red purely as a function of how long the run had been going and which
 * order the files happened to execute in. The suite is eight minutes long, so
 * most of it was on the wrong side of that line.
 *
 * Reading them per access makes the fixture mean what it says at the moment it
 * is used. Every `{ ...HOME }` spread and every `stub(page, { homes: [HOME] })`
 * gets a house that answered just now, and a spec that wants a stale one still
 * says so explicitly by overriding `last_ok_at`, which is how state 9 is
 * reached on purpose rather than by the clock.
 */
export const HOME = {
	id: '2b0d4c7e-1f8a-4c3d-9e11-7a6b5c4d3e2f',
	label: 'Home',
	base_url: 'https://home.example.com',
	transport: 'direct',
	relay_id: null,
	status: 'connected',
	status_detail: null,
	capabilities: { websocket: true, entityCount: 120, areaCount: 3, floorCount: 1, macroCount: 2, haVersion: '2026.9.0', mcp: false, mcpToolCount: 0 },
	get last_ok_at() { return new Date().toISOString(); },
	last_error_at: null,
	get created_at() { return new Date().toISOString(); },
	get updated_at() { return new Date().toISOString(); },
	revoked_at: null,
};

export function json(body, status = 200) {
	return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/** Everything the page reads, with the home list under the caller's control. */
export async function stub(page, { homes = [], onConnect } = {}) {
	await page.route(CSRF, (route) => route.fulfill(json({ token: 'csrf-test-token', data: { token: 'csrf-test-token' } })));
	await page.route(LIST, async (route) => {
		if (route.request().method() === 'POST') {
			const body = JSON.parse(route.request().postData() || '{}');
			return route.fulfill(onConnect ? onConnect(body) : json({ home: HOME, capabilities: HOME.capabilities }, 201));
		}
		return route.fulfill(json({ homes }));
	});
}

import { test, expect } from '@playwright/test';

/**
 * pages/ar.html (/avatars/:id/ar, /agents/:id/ar): the dedicated AR
 * experience page. Work order 073 retired its third-party model-viewer CDN
 * dependency in favor of <agent-3d ar>; this proves that end to end against
 * a real Chromium: no request ever reaches the CDN, the element mounts a
 * real canvas, and the existing "Place in your space" button wiring
 * (canActivateAR / activateAR(), unchanged in src/ar-page.js) still arms
 * once <agent-3d>'s own agent:ar-ready event fires.
 *
 * Avatar auth/DB state is stubbed exactly as tests/e2e/avatar-edit.spec.js
 * does (same real public GLB), because a durable avatar record is
 * per-deployment DB state, not something a test box has.
 */

const AVATAR_FIXTURE = {
	avatar: {
		id: 'test-avatar',
		owner_id: 'test-owner',
		name: 'Test Avatar',
		model_url: '/avatars/default.glb',
	},
};

const THIRD_PARTY_VIEWER_HOSTS = [/cdn\.jsdelivr\.net/, /unpkg\.com/, /cdnjs\.cloudflare\.com/];

test('the AR page never requests a third-party viewer CDN and mounts <agent-3d>', async ({ page }) => {
	await page.route('**/api/avatars/test-avatar', (route) => route.fulfill({ json: AVATAR_FIXTURE }));

	// pages/ar.html loads <agent-3d> from the published
	// https://three.ws/agent-3d/latest/agent-3d.js CDN bundle, same as every
	// real page: that bundle only reflects today's source after a deploy.
	// Redirect it to this run's own /src/element.js so the test proves the
	// actual wiring just shipped, not whatever is currently in production.
	await page.route('**/agent-3d/latest/agent-3d.js', (route) =>
		route.fulfill({ status: 302, headers: { location: new URL('/src/element.js', process.env.E2E_ORIGIN).toString() } }),
	);

	const thirdPartyRequests = [];
	page.on('request', (req) => {
		const url = req.url();
		if (THIRD_PARTY_VIEWER_HOSTS.some((re) => re.test(url))) thirdPartyRequests.push(url);
	});
	const errors = [];
	page.on('pageerror', (err) => errors.push(String(err?.message || err)));

	await page.goto('/avatars/test-avatar/ar', { waitUntil: 'domcontentloaded' });

	// The element that replaced <model-viewer>, not the CDN component.
	await expect(page.locator('agent-3d#ar-viewer')).toBeAttached();
	await expect(page.locator('model-viewer')).toHaveCount(0);

	// It really boots: a WebGL canvas renders inside the element's shadow DOM.
	await expect
		.poll(() => page.evaluate(() => document.getElementById('ar-viewer')?.shadowRoot?.querySelector('canvas')))
		.toBeTruthy();

	// The existing launch button wiring (src/ar-page.js, unchanged) still arms
	// once <agent-3d>'s own agent:ar-ready event fires.
	await expect(page.locator('#ar-launch-btn')).toBeEnabled({ timeout: 60_000 });

	expect(thirdPartyRequests, `unexpected third-party requests: ${thirdPartyRequests.join(', ')}`).toEqual([]);
	expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});

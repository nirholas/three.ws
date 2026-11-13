// /glass on a 600x600 viewport against the real IRL rail. Before the run, real
// pins are placed through POST /api/irl/pins at the test fixes; after it they are
// removed with the same device token. Every lens request (fix token, nearby,
// agent card, interactions, chat, handoff) goes to the real API through the dev
// server's /api proxy, and the page is driven only by the arrow keys, Enter and
// Escape, the five inputs the Neural Band produces.

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Open desert in central Nevada, far from any placed agent. Each fix is about
// 1.1 km from the next, well outside the 60 m nearby radius, so the flows never
// see each other's pins.
const BASE = { latitude: 39.4321, longitude: -116.1234 };
const FIX_WALK = BASE;
const FIX_ARRIVE = { latitude: BASE.latitude + 0.01, longitude: BASE.longitude };
const FIX_EMPTY = { latitude: BASE.latitude + 0.02, longitude: BASE.longitude };
const METRE_LAT = 1 / 111_320;

const deviceToken = `glass-e2e-${randomUUID()}`;
const placed = [];

async function placePin(request, fix, northM, avatarName, caption) {
	const res = await request.post('/api/irl/pins', {
		headers: { 'x-irl-device': deviceToken },
		// Public on purpose: production defaults new placements to private
		// (IRL_DEFAULT_PRIVATE), and a private pin never reaches another reader's
		// nearby feed, which is the feed the lens reads.
		data: { lat: fix.latitude + northM * METRE_LAT, lng: fix.longitude, heading: 0, avatarName, caption, visibility: 'public' },
	});
	expect(res.status(), await res.text()).toBeLessThan(300);
	const body = await res.json();
	const id = body.pin?.id ?? body.id;
	expect(id).toBeTruthy();
	placed.push(id);
	return id;
}

async function focusedText(page) {
	return page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
}

// Arrow through the focus ring until the wearer is on `label`, as a thumb swipe would.
async function swipeTo(page, label, max = 8) {
	for (let i = 0; i < max; i++) {
		if ((await focusedText(page)) === label) return;
		await page.keyboard.press('ArrowRight');
	}
	expect(await focusedText(page)).toBe(label);
}

function watchApi(page) {
	const seen = [];
	page.on('response', (r) => {
		const url = new URL(r.url());
		if (url.pathname.startsWith('/api/')) seen.push({ path: url.pathname, status: r.status(), method: r.request().method(), body: r.request().postDataJSON?.() ?? null });
	});
	return seen;
}

let walkPin;
let arrivePin;

test.use({ viewport: { width: 600, height: 600 }, permissions: ['geolocation'] });
// Serial: a failure skips the rest instead of restarting the worker, which would
// re-run beforeAll and place a second set of pins under a new device token.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
	walkPin = await placePin(request, FIX_WALK, 30, 'Glass Walker', 'Placed by the three.ws Glass e2e run');
	arrivePin = await placePin(request, FIX_ARRIVE, 4, 'Glass Greeter', 'Placed by the three.ws Glass e2e run');
});

// One device-scoped purge removes every pin this run placed, even one whose id
// never made it back to `placed`.
test.afterAll(async ({ request }) => {
	const res = await request.delete('/api/irl/pins?all=1', { headers: { 'x-irl-device': deviceToken } });
	expect(res.status(), await res.text()).toBe(200);
	expect((await res.json()).deleted).toBeGreaterThanOrEqual(placed.length);
});

test('scanning to nearby to agent to talk to handoff, keys only', async ({ page, context, request }) => {
	await context.setGeolocation(FIX_WALK);
	const api = watchApi(page);
	const errors = [];
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

	await page.goto('/glass');
	await expect(page.locator('h1')).toHaveText('three.ws Glass');
	await page.keyboard.press('Enter');

	await expect(page.getByText('1 nearby')).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.g-item')).toContainText('Glass Walker');
	await expect(page.locator('.g-dist')).toHaveText(/^\d+ ?m$/);
	await expect(page.locator('.g-status')).toContainText('Fix');

	await page.keyboard.press('Enter');
	await expect(page.locator('h1')).toHaveText('Glass Walker');
	await expect(page.locator('.g-sub').first()).toContainText('Glass e2e run');
	await expect.poll(() => api.some((r) => r.path === '/api/irl/interactions' && r.body?.type === 'view' && r.body?.pinId === walkPin && r.status < 300)).toBe(true);

	// Talk: pick a reply with the d-pad, the agent answers from the real chat API.
	await swipeTo(page, 'Talk');
	await page.keyboard.press('Enter');
	await expect(page.locator('.g-reply')).toHaveText('Pick a reply to start talking.');
	await swipeTo(page, 'Hi');
	await page.keyboard.press('Enter');
	await expect(page.locator('.g-reply')).not.toHaveText(/^(|Pick a reply to start talking\.)$/, { timeout: 60_000 });
	await expect(page.locator('.g-alert')).toHaveCount(0);
	await expect.poll(() => api.some((r) => r.path === '/api/chat' && r.status === 200)).toBe(true);
	expect(api.filter((r) => r.path === '/api/irl/interactions' && r.body?.type === 'talk')).toHaveLength(1);

	// Back to the card, then hand the agent off to the phone.
	await page.keyboard.press('Escape');
	await expect(page.locator('h1')).toHaveText('Glass Walker');
	await swipeTo(page, 'Open on phone');
	await page.keyboard.press('Enter');
	const code = (await page.locator('.g-code').textContent({ timeout: 30_000 })).trim();
	expect(code).toMatch(/^[A-Z0-9]{6}$/);
	const resolved = await request.get(`/api/glass/handoff?code=${code}`);
	expect(resolved.status()).toBe(200);
	expect(await resolved.json()).toMatchObject({ pinId: walkPin, location: `/irl?pin=${walkPin}&from=glass` });

	await page.keyboard.press('Escape');
	await expect(page.locator('h1')).toHaveText('Glass Walker');
	expect(api.filter((r) => r.status >= 500)).toEqual([]);
	expect(errors).toEqual([]);
});

test('arrival within the radius promotes the agent once and logs it', async ({ page, context }) => {
	await context.setGeolocation(FIX_ARRIVE);
	const api = watchApi(page);
	await page.goto('/glass');
	await page.keyboard.press('Enter');
	await expect(page.locator('h1')).toHaveText('Glass Greeter', { timeout: 30_000 });
	await expect.poll(() => api.filter((r) => r.path === '/api/irl/interactions' && r.body?.type === 'arrive' && r.body?.pinId === arrivePin && r.status < 300).length).toBe(1);
	expect(api.find((r) => r.body?.type === 'arrive').body).toMatchObject({ device_type: 'glasses' });
});

test('empty state shows the heading ring, fix age and a next step', async ({ page, context }) => {
	await context.setGeolocation(FIX_EMPTY);
	await page.goto('/glass');
	await page.keyboard.press('Enter');
	await expect(page.locator('h1')).toHaveText('Nobody here yet', { timeout: 30_000 });
	await expect(page.getByText('Walk toward a pin')).toBeVisible();
	await expect(page.locator('.g-status')).toContainText('Fix just now');
	await expect(page.locator('.g-ring')).toContainText('Compass');
});

test('denied state explains how to recover without location', async ({ page, context }) => {
	await context.clearPermissions();
	await page.goto('/glass');
	await page.keyboard.press('Enter');
	await expect(page.locator('h1')).toHaveText('Location needed');
	await expect(page.getByText('Enable it in the glasses settings')).toBeVisible();
	expect(await focusedText(page)).toBe('Try again');
});

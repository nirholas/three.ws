// /glass on a 600x600 viewport with a stubbed geolocation and stubbed IRL APIs:
// start -> nearby -> card -> talk -> handoff, driven only by Arrow/Enter/Escape.

import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 600, height: 600 }, geolocation: { latitude: 40.7123, longitude: -74.0057 }, permissions: ['geolocation'] });

test('glass flow with d-pad keys only', async ({ page }) => {
	const interactions = [];
	await page.route('**/api/irl/fix-token', (r) => r.fulfill({ json: { token: 'tok', expires_in: 180 } }));
	await page.route('**/api/irl/pins?**', (r) => r.fulfill({ json: { pins: [{ id: '11111111-1111-4111-8111-111111111111', agent_id: null, lat: 40.71235, lng: -74.0057, avatar_name: 'Sunny', caption: 'Say hi' }] } }));
	await page.route('**/api/irl/agent-card?**', (r) => r.fulfill({ json: { card: { agent: { name: 'Sunny', bio: 'Greeter' }, reputation: { available: false }, services: [] } } }));
	await page.route('**/api/irl/interactions', (r) => { interactions.push(r.request().postDataJSON()); r.fulfill({ json: { ok: true } }); });
	await page.route('**/api/glass/handoff', (r) => r.fulfill({ json: { code: 'AB3DEF', url: 'https://three.ws/g/AB3DEF', expires_in: 600 } }));

	await page.goto('/glass');
	await expect(page.locator('h1')).toHaveText('three.ws Glass');
	await page.keyboard.press('Enter');
	await expect(page.getByText('1 nearby')).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(page.locator('h1')).toHaveText('Sunny');
	expect(interactions[0]).toMatchObject({ type: 'view', device_type: 'glasses' });
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Enter');
	await expect(page.locator('.g-code')).toHaveText('AB3DEF');
	await page.keyboard.press('Escape');
	await expect(page.locator('h1')).toHaveText('Sunny');
});

test('glass shows the denied state without location', async ({ page, context }) => {
	await context.clearPermissions();
	await page.goto('/glass');
	await page.keyboard.press('Enter');
	await expect(page.locator('h1')).toHaveText('Location needed');
});

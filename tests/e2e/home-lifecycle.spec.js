/**
 * Journey 1: a home is connected, its real rooms appear, and disconnecting it
 * really removes it.
 *
 * Every other journey in this lane starts from a connected house, so the act of
 * connecting one was only ever exercised as setup and the act of disconnecting
 * one was not exercised at all. That left the lane's first and last steps as
 * the only two nobody asserted on.
 *
 * The rooms on screen are compared against the area registry Home Assistant
 * itself holds, read over the same WebSocket the product uses. Comparing the
 * page against a list the page also produced would pass on an empty house.
 */

import { expect, test } from '@playwright/test';

import { HomeBridge } from '../../packages/home-bridge/src/index.js';
import { connectHome, homeInstance, openScene, resetHomes, signIn } from './home-support.js';

test.describe.configure({ mode: 'serial' });

test('journey 1: a home is connected, its real rooms are on screen, and disconnecting removes it', async ({ page }) => {
	const instance = homeInstance();

	// Home Assistant's own answer about what rooms exist, before the browser is
	// involved at all.
	const bridge = new HomeBridge({ baseUrl: instance.baseUrl, token: instance.token });
	await bridge.connect();
	let rooms;
	try {
		rooms = bridge.graph.rooms.map((room) => room.name).filter(Boolean);
	} finally {
		bridge.close();
	}
	expect(rooms.length, 'the seeded house must have rooms for this journey to mean anything').toBeGreaterThan(0);

	await signIn(page, 'owner');
	await resetHomes(page);
	const label = await connectHome(page, { label: 'Journey one' });

	const homeId = await openScene(page);

	// Every room the house has, on screen, by the name the house gave it.
	const rail = page.locator('#hs-rooms');
	for (const room of rooms) {
		await expect(rail.getByText(room, { exact: false }).first(), `the room rail must show "${room}"`).toBeVisible({
			timeout: 60_000,
		});
	}

	// Disconnect through the real control a person uses, not through the API.
	await page.goto('/smart-home', { waitUntil: 'domcontentloaded' });
	const card = page.locator('.hm-card', { hasText: label }).first();
	await expect(card).toBeVisible({ timeout: 90_000 });
	await card.getByRole('button', { name: 'Disconnect', exact: true }).click();

	const confirm = page.getByRole('alertdialog', { name: `Disconnect ${label}` });
	await expect(confirm).toBeVisible({ timeout: 30_000 });
	await confirm.getByRole('button', { name: 'Disconnect and erase the token' }).click();

	// The card is gone from the page...
	await expect(page.locator('.hm-card', { hasText: label })).toHaveCount(0, { timeout: 60_000 });

	// ...and the house is really gone from the account, which is the assertion
	// that a re-render could not have faked.
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/home', { timeout: 60_000 });
				if (!res.ok()) return `http ${res.status()}`;
				const body = await res.json();
				return (Array.isArray(body?.homes) ? body.homes : []).map((home) => home.id);
			},
			{ timeout: 60_000, intervals: [1000] },
		)
		.not.toContain(homeId);
});

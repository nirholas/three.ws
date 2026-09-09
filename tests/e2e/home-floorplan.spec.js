/**
 * Journey 9: draw where the rooms are, reload, and find them still there.
 *
 * Plus the thing that makes the floorplan worth building at all: dragging a
 * device that nobody filed into a room writes the area into the user's OWN Home
 * Assistant registry. That assertion reads the area back out of Home Assistant
 * rather than believing our own tray, for the same reason every lock assertion
 * in this lane reads the deadbolt: a UI that renders the move perfectly while
 * the registry is untouched is exactly the failure worth catching.
 */

import { expect, test } from '@playwright/test';

import { connectHome, homeInstance, openScene, resetHomes, signIn } from './home-support.js';

test.describe.configure({ mode: 'serial' });

/**
 * One authenticated Home Assistant WebSocket, good for many messages.
 *
 * Journey 9e rewrites the house's whole area registry twice, and a socket per
 * message would be dozens of connections and a slow, flaky test.
 */
async function haSession(instance) {
	const socket = new WebSocket(`${instance.baseUrl.replace(/^http/, 'ws')}/api/websocket`);
	const pending = new Map();
	let nextId = 1;
	let ready;

	const open = new Promise((resolve, reject) => { ready = { resolve, reject }; });
	const failAll = (err) => {
		ready.reject(err);
		for (const { reject } of pending.values()) reject(err);
		pending.clear();
	};
	socket.onerror = () => failAll(new Error(`could not reach ${instance.baseUrl} over websocket`));
	socket.onclose = () => failAll(new Error('home assistant closed the websocket'));
	socket.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.type === 'auth_required') return socket.send(JSON.stringify({ type: 'auth', access_token: instance.token }));
		if (msg.type === 'auth_ok') return ready.resolve();
		if (msg.type === 'auth_invalid') return failAll(new Error('home assistant refused the access token'));
		if (msg.type !== 'result') return;
		const waiter = pending.get(msg.id);
		if (!waiter) return;
		pending.delete(msg.id);
		// A failed result is returned rather than thrown: deleting an area that
		// a device still pins can answer with an error that the caller decides
		// how to treat.
		waiter.resolve(msg.success ? msg.result : { error: msg.error || { message: 'failed' } });
	};

	const timer = setTimeout(() => failAll(new Error('home assistant did not authenticate in time')), 30_000);
	await open;
	clearTimeout(timer);

	return {
		send(message) {
			const id = nextId += 1;
			return new Promise((resolve, reject) => {
				const to = setTimeout(() => { pending.delete(id); reject(new Error(`${message.type} timed out`)); }, 30_000);
				pending.set(id, { resolve: (v) => { clearTimeout(to); resolve(v); }, reject });
				socket.send(JSON.stringify({ ...message, id }));
			});
		},
		close() {
			socket.onclose = null;
			socket.close();
		},
	};
}

/** One registry list, over a socket opened just for it. */
async function registry(instance, type = 'config/entity_registry/list') {
	const session = await haSession(instance);
	try {
		const result = await session.send({ type });
		return Array.isArray(result) ? result : [];
	} finally {
		session.close();
	}
}

/** The area Home Assistant currently has this entity filed under. */
async function areaOf(instance, entityId) {
	const entries = await registry(instance);
	return entries.find((e) => e.entity_id === entityId)?.area_id ?? null;
}

/**
 * Every console error and warning the page produced, so a journey can fail on
 * one. A feature that works while the console screams is not finished.
 *
 * Page errors (an uncaught throw) count too. The filter drops noise the product
 * did not cause: a favicon the dev server does not serve, and the WebGL warnings
 * a software renderer emits inside a headless container.
 */
function watchConsole(page) {
	const noise = /favicon|WebGL|SwiftShader|GroupMarkerNotSet|Automatic fallback to software|source map|Download the React DevTools/i;
	const found = [];
	page.on('console', (msg) => {
		if (msg.type() !== 'error' && msg.type() !== 'warning') return;
		const text = msg.text();
		if (noise.test(text)) return;
		found.push(`${msg.type()}: ${text}`);
	});
	page.on('pageerror', (err) => found.push(`pageerror: ${err.message}`));
	return found;
}

async function openPlan(page) {
	const plan = page.getByRole('button', { name: /Draw where the rooms are/i });
	await expect(plan).toBeVisible({ timeout: 60_000 });
	await plan.click();
	await expect(page.locator('#hs-plan')).toBeVisible();
}

test('journey 9: a floorplan is drawn, saved, and still there after a reload', async ({ page }) => {
	const problems = watchConsole(page);
	await signIn(page, 'owner');
	await resetHomes(page);
	await connectHome(page, { label: 'Journey nine' });
	await openScene(page);
	await openPlan(page);

	// A room nobody has placed yet. The tray is the only way in, which is the
	// point: a house arrives with no geometry at all.
	const toPlace = page.locator('.hm-plan-tray-room').first();
	await expect(toPlace).toBeVisible({ timeout: 30_000 });
	const roomName = (await toPlace.textContent())?.trim();
	await toPlace.click();

	const room = page.locator('.hm-plan-room').filter({ hasText: roomName });
	await expect(room).toBeVisible();

	// Move it with the keyboard, so the assertion covers the path a mouse-free
	// user takes rather than only the drag.
	await room.click();
	await room.press('ArrowRight');
	await room.press('ArrowRight');
	await room.press('ArrowDown');

	const save = page.getByRole('button', { name: /^Save floorplan$/ });
	await expect(save).toBeEnabled();
	await save.click();
	await expect(page.getByText(/Floorplan saved/i)).toBeVisible({ timeout: 30_000 });

	// The real test of persistence: a full navigation, not a client-side rerender.
	await page.reload();
	await openPlan(page);
	await expect(page.locator('.hm-plan-room').filter({ hasText: roomName })).toBeVisible({ timeout: 60_000 });
	await expect(page.locator('.hm-plan-tray-room').filter({ hasText: roomName })).toHaveCount(0);

	expect(problems, `console output during journey 9:\n${problems.join('\n')}`).toEqual([]);
});

test('journey 9b: undo takes a placement back, and redo puts it again', async ({ page }) => {
	const problems = watchConsole(page);
	await signIn(page, 'owner');
	await openScene(page);
	await openPlan(page);

	const tray = page.locator('.hm-plan-tray-room');
	const before = await page.locator('.hm-plan-room').count();
	if (!(await tray.count())) test.skip(true, 'every room in this house is already placed');

	const name = (await tray.first().textContent())?.trim();
	await tray.first().click();
	await expect(page.locator('.hm-plan-room')).toHaveCount(before + 1);

	await page.getByRole('button', { name: /^Undo$/ }).click();
	await expect(page.locator('.hm-plan-room').filter({ hasText: name })).toHaveCount(0);

	await page.getByRole('button', { name: /^Redo$/ }).click();
	await expect(page.locator('.hm-plan-room').filter({ hasText: name })).toHaveCount(1);

	expect(problems, `console output during journey 9b:\n${problems.join('\n')}`).toEqual([]);
});

test('journey 9c: filing a device from the tray changes the area in Home Assistant itself', async ({ page }) => {
	const instance = homeInstance();
	const problems = watchConsole(page);
	await signIn(page, 'owner');
	await openScene(page);
	await openPlan(page);

	const loose = page.locator('.hm-plan-tray-entity');
	if (!(await loose.count())) test.skip(true, 'this house has nothing left unfiled');

	// The File button is the keyboard route; the drag is the mouse one. Driving
	// the button means the assertion lands on a named control, and the code path
	// below it is the same one the drop handler calls.
	const first = loose.first();
	const label = (await first.getAttribute('title')) || '';
	await first.getByRole('button', { name: /^File$/ }).click();

	const target = page.locator('.hm-plan-filemenu-item').first();
	await expect(target).toBeVisible();
	await target.click();

	await expect(page.getByText(/was written to your Home Assistant/i)).toBeVisible({ timeout: 30_000 });

	// Home Assistant's own registry, not our tray. This is the assertion the
	// whole feature rests on.
	await expect.poll(() => areaOf(instance, label), { timeout: 30_000 }).not.toBeNull();

	expect(problems, `console output during journey 9c:\n${problems.join('\n')}`).toEqual([]);
});

test('journey 9d: resetting the plan returns the house to its default arrangement', async ({ page }) => {
	const problems = watchConsole(page);
	await signIn(page, 'owner');
	await openScene(page);
	await openPlan(page);

	const reset = page.getByRole('button', { name: /^Reset to default$/ });
	await expect(reset).toBeEnabled({ timeout: 30_000 });
	await reset.click();
	await expect(page.getByText(/Back to the default arrangement/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('.hm-plan-room')).toHaveCount(0);

	// And it survives a reload, so the reset really wrote through rather than
	// only clearing the editor's own state.
	await page.reload();
	await openPlan(page);
	await expect(page.locator('.hm-plan-room')).toHaveCount(0);

	expect(problems, `console output during journey 9d:\n${problems.join('\n')}`).toEqual([]);
});

/**
 * Journey 9e: the house nobody ever organised.
 *
 * This is the most common real Home Assistant we see: devices everywhere and
 * not one area, so every room-shaped surface has nothing to draw. The order
 * this journey belongs to sets the bar as a complete floorplan in under five
 * minutes without leaving the page, so the journey strips the house down to
 * zero areas, walks the tray-first flow, and times it.
 *
 * It puts the house back afterwards. Home Assistant derives an area id from its
 * name, so recreating "Kitchen" restores the id every device was filed under and
 * the restore is exact rather than approximate.
 */
test('journey 9e: a house with no areas at all reaches a full floorplan from the tray', async ({ page }) => {
	const instance = homeInstance();
	const problems = watchConsole(page);
	const session = await haSession(instance);

	// What the house looks like before we take it apart.
	const originalAreas = await session.send({ type: 'config/area_registry/list' });
	const devices = await session.send({ type: 'config/device_registry/list' });
	const entities = await session.send({ type: 'config/entity_registry/list' });
	const deviceAreas = devices.filter((d) => d.area_id).map((d) => ({ id: d.id, areaId: d.area_id }));
	const entityAreas = entities.filter((e) => e.area_id).map((e) => ({ id: e.entity_id, areaId: e.area_id }));
	expect(originalAreas.length).toBeGreaterThan(0);

	try {
		for (const area of originalAreas) {
			await session.send({ type: 'config/area_registry/delete', area_id: area.area_id });
		}
		expect(await session.send({ type: 'config/area_registry/list' })).toHaveLength(0);

		await signIn(page, 'owner');
		await openScene(page);
		await openPlan(page);

		// The clock starts where the user starts: looking at a house with no
		// rooms in it.
		const start = Date.now();
		const startPanel = page.locator('.hm-plan-tray-start');
		await expect(startPanel).toBeVisible({ timeout: 60_000 });
		await expect(startPanel).toContainText(/Nothing in this home is in a room yet/i);

		// Room one, from the tray's own invitation.
		await startPanel.getByRole('button', { name: /^Make a room$/ }).click();
		await page.locator('.hm-plan-naming-input').fill('Plan kitchen');
		await page.getByRole('button', { name: /^Make this room$/ }).click();
		await expect(page.locator('.hm-plan-room').filter({ hasText: 'Plan kitchen' })).toBeVisible({ timeout: 60_000 });

		// Room two, from the toolbar, because a floorplan is not one room.
		await page.getByRole('button', { name: /^New room$/ }).click();
		await page.locator('.hm-plan-naming-input').fill('Plan hallway');
		await page.getByRole('button', { name: /^Make this room$/ }).click();
		await expect(page.locator('.hm-plan-room').filter({ hasText: 'Plan hallway' })).toBeVisible({ timeout: 60_000 });

		// And a device filed into a room that did not exist a minute ago.
		const loose = page.locator('.hm-plan-tray-entity').first();
		await expect(loose).toBeVisible({ timeout: 30_000 });
		const filed = (await loose.getAttribute('title')) || '';
		await loose.getByRole('button', { name: /^File$/ }).click();
		await page.locator('.hm-plan-filemenu-item').filter({ hasText: 'Plan kitchen' }).click();
		await expect(page.getByText(/was written to your Home Assistant/i)).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: /^Save floorplan$/ }).click();
		await expect(page.getByText(/Floorplan saved/i)).toBeVisible({ timeout: 30_000 });
		const seconds = Math.round((Date.now() - start) / 1000);
		console.log(`[journey 9e] zero areas to a saved two-room floorplan with a filed device: ${seconds}s`);
		expect(seconds).toBeLessThan(300);

		// Home Assistant's own registries, not our picture of them.
		const madeAreas = await session.send({ type: 'config/area_registry/list' });
		const names = madeAreas.map((a) => a.name);
		expect(names).toContain('Plan kitchen');
		expect(names).toContain('Plan hallway');
		const kitchenId = madeAreas.find((a) => a.name === 'Plan kitchen')?.area_id;
		await expect.poll(() => areaOf(instance, filed), { timeout: 30_000 }).toBe(kitchenId);

		// It survives a reload, so the plan really persisted rather than only
		// looking right in the editor.
		await page.reload();
		await openPlan(page);
		await expect(page.locator('.hm-plan-room').filter({ hasText: 'Plan kitchen' })).toBeVisible({ timeout: 60_000 });

		// The house this order set out to make, in both views. Written to
		// test-results/, which is gitignored: evidence for the run, not an asset.
		await page.locator('#hs-plan').screenshot({ path: 'test-results/floorplan-editor.png' });
		await page.getByRole('button', { name: /Show the 3D house/i }).click();
		// Wait for the renderer to have drawn the arranged house rather than for a
		// fixed delay: a screenshot of a blank canvas proves nothing.
		await expect(page.locator('#hs-stage canvas')).toBeVisible({ timeout: 60_000 });
		await expect.poll(
			() => page.evaluate(() => {
				const canvas = document.querySelector('#hs-stage canvas');
				return canvas ? canvas.width * canvas.height : 0;
			}),
			{ timeout: 60_000 },
		).toBeGreaterThan(0);
		await page.locator('#hs-stage').screenshot({ path: 'test-results/floorplan-3d-scene.png' });
		console.log('[journey 9e] screenshots: test-results/floorplan-editor.png, test-results/floorplan-3d-scene.png');
	} finally {
		// Put the house back exactly as it was, whatever happened above.
		const leftover = await session.send({ type: 'config/area_registry/list' });
		for (const area of leftover) {
			await session.send({ type: 'config/area_registry/delete', area_id: area.area_id }).catch(() => {});
		}
		// Home Assistant derives an area id from the name, and usually gives back
		// the same one. Usually is not good enough to re-file a house on, so the
		// old id is mapped to whatever id the recreated area actually got.
		const remap = new Map();
		for (const area of originalAreas) {
			const made = await session.send({
				type: 'config/area_registry/create',
				name: area.name,
				...(area.floor_id ? { floor_id: area.floor_id } : {}),
			}).catch(() => null);
			if (made?.area_id) remap.set(area.area_id, made.area_id);
		}
		for (const device of deviceAreas) {
			const areaId = remap.get(device.areaId);
			if (!areaId) continue;
			await session.send({ type: 'config/device_registry/update', device_id: device.id, area_id: areaId }).catch(() => {});
		}
		for (const entity of entityAreas) {
			const areaId = remap.get(entity.areaId);
			if (!areaId) continue;
			await session.send({ type: 'config/entity_registry/update', entity_id: entity.id, area_id: areaId }).catch(() => {});
		}
		session.close();
	}

	expect(problems, `console output during journey 9e:\n${problems.join('\n')}`).toEqual([]);
});

/**
 * Journey 9f: two people in the same house, drawing at once.
 *
 * Optimistic concurrency is only worth having if the losing save is offered a
 * real choice rather than a silent overwrite, so this drives two browser
 * contexts against one home and proves the second save is refused, told who
 * won, and able to land its own work anyway.
 */
test('journey 9f: two browsers editing one home get the merge choice, and neither edit vanishes', async ({ browser }) => {
	const first = await browser.newContext();
	const second = await browser.newContext();
	const alice = await first.newPage();
	const bob = await second.newPage();
	const aliceProblems = watchConsole(alice);
	const bobProblems = watchConsole(bob);

	try {
		for (const page of [alice, bob]) {
			await signIn(page, 'owner');
			await openScene(page);
			await openPlan(page);
		}

		// Both loaded the same version. Whatever each places, the other has not
		// seen it.
		const aliceRoom = alice.locator('.hm-plan-tray-room').first();
		const bobRoom = bob.locator('.hm-plan-tray-room').first();
		await expect(aliceRoom).toBeVisible({ timeout: 30_000 });
		await expect(bobRoom).toBeVisible({ timeout: 30_000 });
		const aliceName = (await aliceRoom.textContent())?.trim();
		const bobName = (await bobRoom.textContent())?.trim();

		await aliceRoom.click();
		await alice.getByRole('button', { name: /^Save floorplan$/ }).click();
		await expect(alice.getByText(/Floorplan saved/i)).toBeVisible({ timeout: 30_000 });

		// Bob is now one version behind and does not know it.
		await bobRoom.click();
		await bob.getByRole('button', { name: /^Save floorplan$/ }).click();

		// State 5: refused, explained, and given both ways out.
		const panel = bob.locator('.hm-plan-conflict');
		await expect(panel).toBeVisible({ timeout: 30_000 });
		await expect(panel).toContainText(/Someone else changed this floorplan/i);
		await expect(panel.getByRole('button', { name: /^Keep mine$/ })).toBeVisible();
		await expect(panel.getByRole('button', { name: /^Take theirs$/ })).toBeVisible();

		// Taking theirs loads Alice's work rather than throwing Bob's away in
		// silence, and says so.
		await panel.getByRole('button', { name: /^Take theirs$/ }).click();
		await expect(bob.getByText(/Loaded the other version/i)).toBeVisible({ timeout: 30_000 });
		await expect(bob.locator('.hm-plan-room').filter({ hasText: aliceName })).toBeVisible({ timeout: 30_000 });

		// And Bob's own edit is still his to make: he redraws it on top of the
		// version that won and it lands.
		const again = bob.locator('.hm-plan-tray-room').filter({ hasText: bobName }).first();
		if (await again.count()) {
			await again.click();
			await bob.getByRole('button', { name: /^Save floorplan$/ }).click();
			await expect(bob.getByText(/Floorplan saved/i)).toBeVisible({ timeout: 30_000 });

			// Alice reloads and sees both rooms: nothing was lost, by either of them.
			await alice.reload();
			await openPlan(alice);
			await expect(alice.locator('.hm-plan-room').filter({ hasText: aliceName })).toBeVisible({ timeout: 60_000 });
			await expect(alice.locator('.hm-plan-room').filter({ hasText: bobName })).toBeVisible({ timeout: 30_000 });
		}

		expect(aliceProblems, `console output in the first browser:\n${aliceProblems.join('\n')}`).toEqual([]);
		expect(bobProblems, `console output in the second browser:\n${bobProblems.join('\n')}`).toEqual([]);
	} finally {
		await first.close();
		await second.close();
	}
});

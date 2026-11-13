import { test, expect } from '@playwright/test';
import { Document, NodeIO } from '@gltf-transform/core';

// Diorama microgame: a saved world with a `game` block opens into play mode,
// the walker collects its goal objects, and the win card appears.
//
// Fidelity: the page, renderer, play mode, game rules and walk avatar are the
// real modules running in a real Chromium against the dev server. Only the two
// per-deployment pieces are route-intercepted: the saved-world record (DB
// state a test box does not have) and the prop GLB bytes (a real glTF-Transform
// asset, so nothing is billed to the text-to-3D lane).

const WORLD_ID = '00000000-0000-4000-8000-0000000000aa';

async function propGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const positions = doc
		.createAccessor()
		.setType('VEC3')
		.setArray(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]))
		.setBuffer(buffer);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', positions)
		.setMaterial(doc.createMaterial('M').setBaseColorFactor([0.9, 0.6, 0.1, 1]));
	const mesh = doc.createMesh('m').addPrimitive(prim);
	doc.createScene('s').addChild(doc.createNode('n').setMesh(mesh));
	return Buffer.from(await new NodeIO().writeBinary(doc));
}

function world(ready = true, timeLimitSec = 60) {
	const obj = (id, x, z, label) => ({
		id,
		label,
		prompt: label,
		position: [x, 0, z],
		rotation: 0,
		scale: 1,
		status: ready ? 'ready' : 'forging',
		glbUrl: ready ? '/e2e-prop.glb' : null,
	});
	return {
		id: WORLD_ID,
		prompt: 'a meadow with two lanterns',
		title: 'Lantern meadow',
		mood: 'day',
		palette: { sky: ['#9ad0ff', '#e8f4ff'], ground: '#6fae5c', fog: '#cfe6ff', accent: '#ffcc66' },
		ground: 'grass',
		island: 'round',
		objects: [obj('obj-0', -3, 3.5, 'Lantern'), obj('obj-1', 3, 3.5, 'Lantern')],
		game: {
			goal: 'collect',
			targetIds: ['obj-0', 'obj-1'],
			count: 2,
			timeLimitSec,
			spawn: { x: 0, z: 4.5, heading: Math.PI },
		},
	};
}

async function mountWorld(page, doc) {
	const glb = await propGlb();
	await page.route('**/e2e-prop.glb', (route) =>
		route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: glb }),
	);
	await page.route('**/api/diorama?id=*', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ diorama: doc }) }),
	);
	await page.route('**/api/diorama*', (route) =>
		route.request().method() === 'GET' && !route.request().url().includes('id=')
			? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
			: route.fallback(),
	);
}

test.describe('diorama microgame', () => {
	test('a world with a goal can be played to a win', async ({ page }) => {
		await mountWorld(page, world());
		await page.goto(`/diorama?id=${WORLD_ID}&play=1`);

		const start = page.locator('.dio-play__cta', { hasText: 'Start' });
		await expect(start).toBeEnabled({ timeout: 90_000 });
		await expect(page.locator('.dio-play__body')).toContainText('Collect');
		await start.click();

		await expect(page.locator('.dio-play__objective')).toContainText('Collect');
		await expect(page.locator('.dio-play__progress')).toHaveText('0/2');

		// The camera looks toward -z from the spawn, so A is screen-left (-x).
		await page.keyboard.down('KeyA');
		await expect(page.locator('.dio-play__progress')).toHaveText('1/2', { timeout: 15_000 });
		await page.keyboard.up('KeyA');
		await page.keyboard.down('KeyD');
		await expect(page.locator('.dio-play__title')).toHaveText('You won', { timeout: 30_000 });
		await page.keyboard.up('KeyD');

		await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
	});

	test('start stays locked with a reason while goal objects are still forming', async ({ page }) => {
		await mountWorld(page, world(false));
		await page.goto(`/diorama?id=${WORLD_ID}`);
		const play = page.getByRole('button', { name: 'Play this world' });
		await expect(play).toBeDisabled({ timeout: 60_000 });
		await expect(play).toHaveAttribute('title', /Still forming|could not be forged/);
	});

	test('Escape exits play mode and returns to the orbit view', async ({ page }) => {
		await mountWorld(page, world());
		await page.goto(`/diorama?id=${WORLD_ID}&play=1`);
		await expect(page.locator('.dio-play__cta', { hasText: 'Start' })).toBeEnabled({ timeout: 90_000 });
		await page.keyboard.press('Escape');
		await expect(page.locator('.dio-play')).toBeHidden();
		await expect(page.getByRole('button', { name: 'Play this world' })).toBeEnabled();
	});

	test('a timed goal left undone ends in a loss, and Play again restarts the run', async ({ page }) => {
		// 10s is the schema floor (MIN_TIME_LIMIT_SEC), so this waits out a real clock.
		// The first read only checks the clock is live and counting down from 0:10:
		// a loaded test box can take seconds to get from the click to the read.
		await mountWorld(page, world(true, 10));
		await page.goto(`/diorama?id=${WORLD_ID}&play=1`);
		const start = page.locator('.dio-play__cta', { hasText: 'Start' });
		await expect(start).toBeEnabled({ timeout: 90_000 });
		await start.click();

		await expect(page.locator('.dio-play__clock')).toHaveText(/^0:(10|0[1-9])$/);
		await expect(page.locator('.dio-play__title')).toHaveText('Not this time', { timeout: 20_000 });
		await expect(page.locator('.dio-play__body')).toContainText('Time ran out.');
		await expect(page.locator('.dio-play__clock')).toHaveText('0:00');

		await page.getByRole('button', { name: 'Play again' }).click();
		await expect(page.locator('.dio-play__card')).toBeHidden();
		await expect(page.locator('.dio-play__progress')).toHaveText('0/2');
		await expect(page.locator('.dio-play__clock')).toHaveText(/^0:(10|0[1-9])$/);
	});
});

test.describe('diorama microgame on a phone (390x844, touch)', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	async function expectTapFloor(locator) {
		const box = await locator.boundingBox();
		expect(box, 'control is laid out').not.toBeNull();
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
	}

	async function openAndStart(page) {
		await mountWorld(page, world());
		await page.goto(`/diorama?id=${WORLD_ID}&play=1`);
		const start = page.locator('.dio-play__cta', { hasText: 'Start' });
		await expect(start).toBeEnabled({ timeout: 90_000 });
		await expectTapFloor(start);
		await expectTapFloor(page.locator('.dio-play__card .dio-play__alt'));
		await start.tap();
		await expect(page.locator('.dio-play__progress')).toHaveText('0/2');
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow, 'no horizontal scroll at phone width').toBeLessThanOrEqual(0);
		await expectTapFloor(page.locator('.dio-play__hud .dio-play__exit'));
		const stick = page.locator('.dio-play__stick');
		await expect(stick).toBeVisible();
		return stick;
	}

	test('the touch pad walks the avatar to a win', async ({ page }) => {
		const stick = await openAndStart(page);
		const box = await stick.boundingBox();
		const cx = box.x + box.width / 2;
		const cy = box.y + box.height / 2;
		const cdp = await page.context().newCDPSession(page);
		const touch = (type, x) =>
			cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: cy, id: 1 }] });

		// Thumb down on the pad, slide left: the walker heads screen-left (-x).
		await touch('touchStart', cx);
		await touch('touchMove', cx - 30);
		await touch('touchMove', cx - 60);
		await expect(page.locator('.dio-play__progress')).toHaveText('1/2', { timeout: 15_000 });
		await touch('touchMove', cx + 60);
		await expect(page.locator('.dio-play__title')).toHaveText('You won', { timeout: 30_000 });
		await touch('touchEnd');
		await expect(stick).toBeHidden();
		await expectTapFloor(page.getByRole('button', { name: 'Play again' }));
	});

	test('tapping the ground walks the avatar there', async ({ page }) => {
		const stick = await openAndStart(page);
		const canvas = await page.locator('.dio-play').boundingBox();
		const pad = await stick.boundingBox();
		// The chase camera has no roll, so a screen row is a line of constant z on
		// the ground. 60% down the stage is the row just in front of the walker's
		// feet, on the lanterns' side; tapping toward the left edge of that row
		// walks the walker left, and repeat taps carry it on, as a player would.
		const x = canvas.x + canvas.width * 0.12;
		const y = canvas.y + canvas.height * 0.6;
		expect(y, 'tap row clears the touch pad').toBeLessThan(pad.y);
		const progress = page.locator('.dio-play__progress');
		await expect
			.poll(
				async () => {
					const now = await progress.textContent();
					if (now !== '1/2') await page.touchscreen.tap(x, y);
					return now;
				},
				// Each interval is one walk leg: long enough to reach the tap point.
				{ timeout: 30_000, intervals: [900] },
			)
			.toBe('1/2');
	});
});

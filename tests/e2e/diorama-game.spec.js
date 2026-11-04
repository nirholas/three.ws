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

function world(ready = true) {
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
			timeLimitSec: 60,
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
});

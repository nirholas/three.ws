import { test, expect } from '@playwright/test';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsVariants } from '@gltf-transform/extensions';

// Work order 073: <agent-3d>'s model-viewer-compatible AR/variant/hotspot
// contract. Drives a real Chromium against the dev server's /src/element.js
// (not the published CDN bundle, which only reflects today's source after a
// deploy) using public/agent-3d-ar-harness.html.
//
// Fidelity: the GLB is a real glTF-Transform-built KHR_materials_variants
// asset, loaded over the real network by the real GLTFLoader and parsed a
// second time by the real khr-variants.js controller, exactly as production
// does. Only the GLB's own bytes are route-intercepted, because a durable
// avatar record is per-deployment DB state, not something a test box has
// (same rationale as tests/e2e/embodiment-embed.spec.js's persona stub).

const GLB_URL = '**/agent-3d-ar-harness-variants.glb';
const IOS_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function buildVariantGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();

	const positions = doc
		.createAccessor()
		.setType('VEC3')
		.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
		.setBuffer(buffer);
	const prim = doc.createPrimitive().setAttribute('POSITION', positions);

	const matRed = doc.createMaterial('Red').setBaseColorFactor([1, 0, 0, 1]);
	const matBlue = doc.createMaterial('Blue').setBaseColorFactor([0, 0, 1, 1]);
	prim.setMaterial(matRed);

	const variantExt = doc.createExtension(KHRMaterialsVariants);
	const varRed = variantExt.createVariant('Red');
	const varBlue = variantExt.createVariant('Blue');
	const mapRed = variantExt.createMapping().setMaterial(matRed).addVariant(varRed);
	const mapBlue = variantExt.createMapping().setMaterial(matBlue).addVariant(varBlue);
	const mappingList = variantExt.createMappingList().addMapping(mapRed).addMapping(mapBlue);
	prim.setExtension('KHR_materials_variants', mappingList);

	const mesh = doc.createMesh('VariantTestMesh').addPrimitive(prim);
	const node = doc.createNode().setMesh(mesh);
	const scene = doc.createScene().addChild(node);
	doc.getRoot().setDefaultScene(scene);

	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	return io.writeBinary(doc);
}

function watchErrors(page) {
	const errors = [];
	page.on('pageerror', (err) => errors.push(String(err?.message || err)));
	return errors;
}

test.describe('agent-3d AR/variant/hotspot contract', () => {
	test('variant switching works on a real KHR_materials_variants GLB', async ({ page }) => {
		const glbBytes = await buildVariantGlb();
		await page.route(GLB_URL, (route) =>
			route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.from(glbBytes) }),
		);
		const errors = watchErrors(page);

		await page.goto('/agent-3d-ar-harness.html', { waitUntil: 'domcontentloaded' });

		await expect
			.poll(() => page.evaluate(() => document.getElementById('a3d').availableVariants), {
				timeout: 60_000,
			})
			.toEqual(['Red', 'Blue']);

		const colorOf = () =>
			page.evaluate(() => {
				let mesh = null;
				document.getElementById('a3d')._viewer.scene.traverse((o) => {
					if (o.isMesh && o.name === 'VariantTestMesh') mesh = o;
				});
				return mesh.material.color.getHexString();
			});

		expect(await colorOf()).toBe('ff0000');

		const changed = page.evaluate(
			() =>
				new Promise((resolve) => {
					document.getElementById('a3d').addEventListener('agent:variant-changed', (e) => resolve(e.detail), {
						once: true,
					});
				}),
		);
		await page.evaluate(() => {
			document.getElementById('a3d').variantName = 'Blue';
		});
		expect(await changed).toEqual({ name: 'Blue', requested: 'Blue', ok: true });
		expect(await colorOf()).toBe('0000ff');

		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});

	test('ar + ios-src arms canActivateAR and launches Quick Look via the rel=ar anchor', async ({ browser }) => {
		const context = await browser.newContext({ userAgent: IOS_UA });
		const page = await context.newPage();
		try {
			const glbBytes = await buildVariantGlb();
			await page.route(GLB_URL, (route) =>
				route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.from(glbBytes) }),
			);
			// Quick Look is Safari-only behavior: real Safari intercepts the
			// rel="ar" anchor click and never navigates, but Chromium (even with
			// the iOS UA spoofed) treats it as a plain link and follows it. A
			// capturing document-level listener installed before the page's own
			// scripts run stops that follow-through so the test can observe the
			// real anchor the product code built without losing the page.
			await page.addInitScript(() => {
				document.addEventListener(
					'click',
					(e) => {
						if (e.target.closest?.('a[rel="ar"]')) e.preventDefault();
					},
					{ capture: true },
				);
			});
			const errors = watchErrors(page);

			await page.goto('/agent-3d-ar-harness.html', { waitUntil: 'domcontentloaded' });

			await expect
				.poll(() => page.evaluate(() => document.getElementById('a3d').canActivateAR), { timeout: 60_000 })
				.toBe(true);

			await page.evaluate(() => document.getElementById('a3d').activateAR());

			expect(await page.evaluate(() => document.querySelector('a[rel="ar"]')?.getAttribute('href'))).toBe(
				'/agent-3d-ar-harness-placeholder.usdz',
			);

			expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
		} finally {
			await context.close();
		}
	});

	test('clicking a hotspot flies the camera to its saved orbit', async ({ page }) => {
		const glbBytes = await buildVariantGlb();
		await page.route(GLB_URL, (route) =>
			route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.from(glbBytes) }),
		);
		const errors = watchErrors(page);

		await page.goto('/agent-3d-ar-harness.html', { waitUntil: 'domcontentloaded' });
		await expect
			.poll(() => page.evaluate(() => document.getElementById('a3d').availableVariants.length), {
				timeout: 60_000,
			})
			.toBeGreaterThan(0);

		// The hotspot layer only positions assigned elements once the viewer is
		// rendering frames; wait for a real projected position before clicking.
		await expect
			.poll(() => page.evaluate(() => document.getElementById('hs').style.transform))
			.toMatch(/translate/);

		const before = await page.evaluate(() => {
			const v = document.getElementById('a3d')._viewer;
			return { pos: v.activeCamera.position.toArray(), target: v.controls.target.toArray() };
		});

		// The hotspot's projected screen position depends on the default camera
		// framing, which can land outside Playwright's own viewport bounds even
		// though the element is correctly positioned over the canvas; dispatch a
		// real click directly rather than requiring on-screen pointer coordinates.
		await page.evaluate(() => document.getElementById('hs').click());
		await page.waitForTimeout(900);

		const after = await page.evaluate(() => {
			const v = document.getElementById('a3d')._viewer;
			return { pos: v.activeCamera.position.toArray(), target: v.controls.target.toArray() };
		});

		expect(after.pos).not.toEqual(before.pos);
		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});
});

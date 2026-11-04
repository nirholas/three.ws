// The house default avatar never stands in bind pose on a demo surface.
//
// A first-time visitor's first look at /playground, /avatar-sdk, /restyle and
// the /pocket screen (/walk-embed) is the default avatar. Each of those used to
// show it frozen in its bind pose (arms out in a T). This spec loads each page
// in a real browser, waits for the body to mount, and measures every bone's
// local rotation against the rest pose recorded in the skin itself
// (skeleton.boneInverses). A body in bind pose deviates by ~0 degrees; an idle
// with the arms down deviates by tens of degrees.
//
// The /walk-embed case also feeds it a skinned rig the clip library cannot
// drive (the default body with every joint renamed to an unmappable name, built
// here from the real asset) and asserts the embed swaps in the default body,
// says so over the typed bridge, and still idles, instead of walking a T-pose.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// Below this the body reads as the bind pose. The idle puts the upper arms
// roughly 60 to 80 degrees off a T, so a real idle clears it with room to spare.
const MIN_DEVIATION_DEG = 20;
const LOAD_TIMEOUT = 60_000;

// Runs in the page. Largest angle, in degrees, between any bone's current local
// rotation and its rest local rotation from the skin's inverse bind matrices.
// Local rotations are used so however the page frames or scales the root, the
// answer is the same.
function bindPoseDeviationInPage(root) {
	if (!root) return null;
	root.updateMatrixWorld(true);
	let max = 0;
	let bones = 0;
	const seen = new Set();
	root.traverse((mesh) => {
		if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
		const { bones: list, boneInverses } = mesh.skeleton;
		list.forEach((bone, i) => {
			if (seen.has(bone)) return;
			seen.add(bone);
			const pi = list.indexOf(bone.parent);
			if (pi < 0) return;
			const restWorld = boneInverses[i].clone().invert();
			const restLocal = boneInverses[pi].clone().multiply(restWorld);
			const q = bone.quaternion.clone();
			restLocal.decompose(bone.position.clone(), q, bone.scale.clone());
			const deg = (q.angleTo(bone.quaternion) * 180) / Math.PI;
			if (deg > max) max = deg;
			bones++;
		});
	});
	return bones ? max : null;
}

async function deviation(page, rootExpr) {
	return page.evaluate(
		({ fn, expr }) => {
			// eslint-disable-next-line no-new-func
			const measure = new Function(`return (${fn})`)();
			// eslint-disable-next-line no-new-func
			const root = new Function(`return (${expr})`)();
			return measure(root);
		},
		{ fn: bindPoseDeviationInPage.toString(), expr: rootExpr },
	);
}

// The idle has to have run for a moment before the pose is sampled.
async function settledDeviation(page, rootExpr) {
	await page.waitForFunction(`!!(${rootExpr})`, null, { timeout: LOAD_TIMEOUT });
	await page.waitForTimeout(800);
	return deviation(page, rootExpr);
}

test.describe('the default avatar is never in bind pose', () => {
	test.setTimeout(120_000);

	test('/playground (model-viewer)', async ({ page }) => {
		await page.goto('/playground');
		const mv = 'document.querySelector("model-viewer")';
		await page.waitForFunction(`${mv} && ${mv}.loaded`, null, { timeout: LOAD_TIMEOUT });
		expect(await page.evaluate(`${mv}.availableAnimations`)).toContain('idle');
		// model-viewer keeps its three.js scene behind a symbol; it is a THREE.Scene.
		const scene = `(() => { const el = ${mv}; const s = Object.getOwnPropertySymbols(el).find((k) => k.description === 'scene'); return s ? el[s] : null; })()`;
		const deg = await settledDeviation(page, scene);
		expect(deg).toBeGreaterThan(MIN_DEVIATION_DEG);
	});

	test('/avatar-sdk (three-ws-viewer)', async ({ page }) => {
		await page.goto('/avatar-sdk');
		const viewers = await page.locator('three-ws-viewer[src="/avatars/default-idle.glb"]').count();
		expect(viewers).toBeGreaterThan(0);
		const root = 'document.querySelector(\'three-ws-viewer[src="/avatars/default-idle.glb"]\')?._model';
		await page.locator('three-ws-viewer[src="/avatars/default-idle.glb"]').first().scrollIntoViewIfNeeded();
		const deg = await settledDeviation(page, root);
		expect(deg).toBeGreaterThan(MIN_DEVIATION_DEG);
		expect(await page.evaluate('document.querySelector(\'three-ws-viewer[src="/avatars/default-idle.glb"]\').availableAnimations')).toContain('idle');
	});

	test('/restyle', async ({ page }) => {
		await page.goto('/restyle?bench');
		const deg = await settledDeviation(page, 'window.__restyleBench?.root');
		expect(deg).toBeGreaterThan(MIN_DEVIATION_DEG);
	});

	test('/walk-embed (the /pocket screen), default body', async ({ page }) => {
		await page.goto('/walk-embed?controls=none&autoplay=false');
		await page.waitForFunction('window.__walkEmbed?.getReady()', null, { timeout: LOAD_TIMEOUT });
		const deg = await settledDeviation(page, 'window.__walkEmbed.getAvatar()');
		expect(deg).toBeGreaterThan(MIN_DEVIATION_DEG);
	});

	test('/walk-embed swaps a rig the clips cannot drive for the default body', async ({ page }) => {
		const glb = await undrivableRig();
		await page.route((url) => url.pathname === '/e2e-fixtures/undrivable-rig.glb', (route) =>
			route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.from(glb) }),
		);
		// The bridge only talks to a real parent frame, so host the embed the way
		// /pocket does: a same-origin page with the embed in an iframe.
		const embedUrl = '/walk-embed?controls=none&autoplay=false&avatar=/e2e-fixtures/undrivable-rig.glb';
		await page.route((url) => url.pathname === '/e2e-fixtures/walk-host.html', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: `<!doctype html><title>host</title><script>
					window.__walkMessages = [];
					addEventListener('message', (e) => { if (e.data && typeof e.data.type === 'string') window.__walkMessages.push(e.data); });
				</script><iframe id="walk" src="${embedUrl}" style="width:480px;height:640px;border:0"></iframe>`,
			}),
		);
		await page.goto('/e2e-fixtures/walk-host.html');
		await page.waitForFunction(() => window.__walkMessages.some((m) => m.type === 'walk:ready'), null, { timeout: LOAD_TIMEOUT });
		const embed = page.frames().find((f) => f.url().includes('/walk-embed'));
		expect(embed).toBeTruthy();

		const notice = await page.evaluate(() => window.__walkMessages.find((m) => m.type === 'walk:error'));
		expect(notice).toMatchObject({ code: 'avatar_not_animatable', fallback: true });

		// The body on stage is the default (its joints carry canonical names),
		// and it idles.
		const hasHips = await embed.evaluate(() => {
			let found = false;
			window.__walkEmbed.getAvatar().traverse((n) => { if (n.isBone && n.name === 'Hips') found = true; });
			return found;
		});
		expect(hasHips).toBe(true);
		const deg = await settledDeviation(embed, 'window.__walkEmbed.getAvatar()');
		expect(deg).toBeGreaterThan(MIN_DEVIATION_DEG);

		// A wave on the stand-in body really plays, and the echo says so.
		await embed.evaluate(() => window.__walkEmbed.gesture('wave'));
		await page.waitForFunction(() => window.__walkMessages.some((m) => m.type === 'walk:gesture'), null, { timeout: 5_000 });
		const echo = await page.evaluate(() => window.__walkMessages.filter((m) => m.type === 'walk:gesture').pop());
		expect(echo).toMatchObject({ gesture: 'wave', played: true });
	});
});

// The real default body with every joint renamed to something no rig table
// maps, so it is a skinned humanoid the clip library cannot bind.
async function undrivableRig() {
	await MeshoptDecoder.ready;
	await MeshoptEncoder.ready;
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
	const doc = await io.readBinary(new Uint8Array(readFileSync(new URL('../../public/avatars/default.glb', import.meta.url))));
	let n = 0;
	for (const skin of doc.getRoot().listSkins()) {
		for (const joint of skin.listJoints()) {
			if (!joint.getName().startsWith('zz')) joint.setName(`zz_joint_${n++}`);
		}
	}
	return io.writeBinary(doc);
}

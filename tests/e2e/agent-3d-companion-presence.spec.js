import { test, expect } from '@playwright/test';

// Work order 082: companion presence (mood, emoji-driven expression, the
// LLM-composable gesture tool, and active-listening idle reactions). Drives
// a real Chromium against the dev server's /src/element.js (not the
// published CDN bundle) using public/agent-3d-companion-harness.html, which
// loads a real production avatar GLB (public/avatars/default.glb) already
// checked into the repo. No GLB bytes are route-intercepted and no app
// logic is mocked: every assertion reads the real mesh's
// `morphTargetInfluences`, the real `AnimationManager`'s loaded clip, or the
// real `AgentAvatar` emotion state that drives them.

function watchErrors(page) {
	const errors = [];
	page.on('pageerror', (err) => errors.push(String(err?.message || err)));
	return errors;
}

async function ready(page) {
	await page.evaluate(() => document.getElementById('a3d')._waitForReady());
	// AgentAvatar resolves the GLB's morph targets synchronously at
	// construction time, but construction itself is queued behind model
	// load; wait for a non-empty resolution before reading morph weights.
	await expect
		.poll(() => page.evaluate(() => document.getElementById('a3d')._avatar?._morphResolved?.size ?? 0), {
			timeout: 60_000,
		})
		.toBeGreaterThan(0);
}

function mouthSmileWeight(page) {
	return page.evaluate(() => {
		const avatar = document.getElementById('a3d')._avatar;
		const slots = avatar._morphResolved.get('mouthSmileLeft') || avatar._morphResolved.get('mouthSmile');
		if (!slots?.length) return null;
		return slots[0].mesh.morphTargetInfluences[slots[0].index];
	});
}

function mouthFrownWeight(page) {
	return page.evaluate(() => {
		const avatar = document.getElementById('a3d')._avatar;
		const slots = avatar._morphResolved.get('mouthFrownLeft') || avatar._morphResolved.get('mouthFrown');
		if (!slots?.length) return null;
		return slots[0].mesh.morphTargetInfluences[slots[0].index];
	});
}

test.describe('agent-3d companion presence (mood, emoji, gesture, active listening)', () => {
	test('setMood drives a real smile onto the loaded avatar mesh', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/agent-3d-companion-harness.html', { waitUntil: 'domcontentloaded' });
		await ready(page);

		// The idle rig carries its own small baseline smile, so assert a real
		// increase from whatever baseline this GLB renders at rather than an
		// absolute near-zero floor.
		const baseline = await mouthSmileWeight(page);
		await page.evaluate(() => document.getElementById('a3d').setMood(0.9, 0.6));
		// The mood layer lerps in over ~1s (k = dt*1.2); give it real wall-clock time.
		await expect.poll(() => mouthSmileWeight(page), { timeout: 5_000 }).toBeGreaterThan(baseline + 0.2);

		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});

	test('an emoji-only reply with no English sentiment words still smiles the avatar', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/agent-3d-companion-harness.html', { waitUntil: 'domcontentloaded' });
		await ready(page);

		const baseline = await mouthSmileWeight(page);
		await page.evaluate(() =>
			document.getElementById('a3d')._avatar._onSpeak({ payload: { text: 'here you go 🎉' } }),
		);
		await expect.poll(() => mouthSmileWeight(page), { timeout: 5_000 }).toBeGreaterThan(baseline + 0.1);

		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});

	test('a sad emoji frowns the avatar instead', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/agent-3d-companion-harness.html', { waitUntil: 'domcontentloaded' });
		await ready(page);

		const baseline = await mouthFrownWeight(page);
		await page.evaluate(() =>
			document.getElementById('a3d')._avatar._onSpeak({ payload: { text: 'that did not work out 😢' } }),
		);
		await expect.poll(() => mouthFrownWeight(page), { timeout: 5_000 }).toBeGreaterThan(baseline + 0.1);

		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});

	test('the gesture tool plays a real retargeted baked clip by slot name', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/agent-3d-companion-harness.html', { waitUntil: 'domcontentloaded' });
		await ready(page);

		const resolved = await page.evaluate(() => document.getElementById('a3d')._scene.resolveAnimationSlot('wave'));
		expect(resolved).toBe('wave');

		await page.evaluate(() => document.getElementById('a3d')._scene.playClipByName('wave', { loop: false }));
		await expect
			.poll(() => page.evaluate(() => document.getElementById('a3d')._viewer?.animationManager?.currentName), {
				timeout: 15_000,
			})
			.toBe('wave');

		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});

	test('the avatar nods on a fixed cadence while the user speaks, and stops when they stop', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/agent-3d-companion-harness.html', { waitUntil: 'domcontentloaded' });
		await ready(page);

		await page.evaluate(() => document.getElementById('a3d')._avatar._onListenStart());
		// LISTENING_NOD_INTERVAL_S is 2.8s, plus the AnimationManager's own
		// lazy clip load over the dev server on first use; give both real time.
		await expect
			.poll(
				() => page.evaluate(() => document.getElementById('a3d')._viewer?.animationManager?.currentName),
				{ timeout: 20_000 },
			)
			.toBe('nod');

		await page.evaluate(() => document.getElementById('a3d')._avatar._onListenEnd());
		expect(await page.evaluate(() => document.getElementById('a3d')._avatar._userSpeaking)).toBe(false);

		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});
});

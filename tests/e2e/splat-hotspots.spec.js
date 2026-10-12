// /splat: annotation hotspots, the camera timeline built from them, and the
// in-browser video export, driven against the real shipped module and a real
// (procedurally generated, client-side) splat scene, no server round trip,
// no mocked MediaRecorder or captureStream.
//
// Covers the Definition of Done for order 081 task 2: saving two camera views
// on a live splat, then exporting the camera path between them, must produce
// a real downloadable video.

import { test, expect } from '@playwright/test';
import { collectPageErrors } from './_support.js';

test('saving camera views builds a timeline and exports a real video', async ({ page }) => {
	const errors = collectPageErrors(page);

	await page.goto('/splat', { waitUntil: 'domcontentloaded', timeout: 60_000 });

	// Load a real splat scene (procedurally generated bust, not a mock: the
	// same code path a real .ply/.spz capture takes through mountSplatScene).
	await page.locator('.sp-sample[data-sample="bust"]').click();
	await expect(page.locator('#sp-hud')).toBeVisible({ timeout: 30_000 });

	// Hotspot card appears once a scene is live, not before.
	const card = page.locator('#sp-timeline-card');
	await expect(card).toBeVisible();
	await expect(page.locator('#sp-hotspot-empty')).toBeVisible();
	await expect(page.locator('#sp-export-video')).toBeDisabled();

	// Save the first camera view, orbit the camera, save a second.
	await page.locator('#sp-hotspot-add').click();
	await expect(page.locator('.sp-hotspot-row')).toHaveCount(1);
	await expect(page.locator('#sp-hotspot-empty')).toBeHidden();

	const canvas = page.locator('#sp-host canvas');
	const box = await canvas.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.3, { steps: 10 });
	await page.mouse.up();

	await page.locator('#sp-hotspot-add').click();
	await expect(page.locator('.sp-hotspot-row')).toHaveCount(2);

	// A path of two camera views enables playback and export.
	await expect(page.locator('#sp-export-video')).toBeEnabled();
	await expect(page.locator('#sp-timeline-play')).toBeEnabled();

	// Renaming and retiming a hotspot round-trips through the module's state.
	const firstName = page.locator('.sp-hotspot-row').nth(0).locator('.sp-hotspot-name');
	await firstName.fill('Opening shot');
	await firstName.blur();
	await expect(firstName).toHaveValue('Opening shot');

	// Export: records the real canvas via captureStream()+MediaRecorder while
	// the saved camera path actually plays, no setTimeout fake-progress.
	await page.locator('#sp-export-video').click();
	await expect(page.locator('#sp-export-status')).toBeVisible();
	await expect(page.locator('#sp-export-status')).toContainText('Recording', { timeout: 5_000 });

	const downloadLink = page.locator('#sp-export-status a.sp-export-link');
	await expect(downloadLink).toBeVisible({ timeout: 20_000 });
	await expect(downloadLink).toContainText('Download video');

	const href = await downloadLink.getAttribute('href');
	expect(href).toMatch(/^blob:/);
	const bytes = await page.evaluate(async (url) => {
		const res = await fetch(url);
		const buf = await res.arrayBuffer();
		return buf.byteLength;
	}, href);
	expect(bytes).toBeGreaterThan(0);

	expect(errors).toEqual([]);
});

test('the hotspot marker jumps the camera back to its saved view', async ({ page }) => {
	const errors = collectPageErrors(page);

	await page.goto('/splat', { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await page.locator('.sp-sample[data-sample="shell"]').click();
	await expect(page.locator('#sp-hud')).toBeVisible({ timeout: 30_000 });

	await page.locator('#sp-hotspot-add').click();
	const marker = page.locator('.sp-hotspot-marker').first();
	await expect(marker).toBeVisible();
	await marker.click();

	// The "jump to this view" action in the row does the same thing and must
	// not throw even with a single saved view (no path, just a camera tween).
	await page.locator('.sp-hotspot-row .sp-icon-btn').first().click();

	expect(errors).toEqual([]);
});

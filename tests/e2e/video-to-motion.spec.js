/**
 * /video-to-motion regression cover. Drives the real page against a stubbed
 * /api/motion-swap, /api/auth/me and /api/agents so the capture → preview →
 * export lifecycle is deterministic:
 *   • the empty state (dropzone) renders with no console errors at three
 *     breakpoints (320, 768, 1440)
 *   • a successful capture drives processing → ready, enables the export
 *     buttons, and shows the trim row
 *   • a failed capture shows the failed overlay with a retry path back to
 *     empty; a 429 shows the limit overlay
 *   • a non-Mixamo (Daz/Genesis bone names) rig uploaded through the file
 *     input retargets in the browser with no error surfaced in #vtm-status
 *
 * The clip.json fixture is a two-keyframe clip on the canonical skeleton
 * (Hips only), the smallest shape retargetClipToObject accepts.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAZ_RIG = readFileSync(path.join(HERE, '..', '_fixtures', 'daz-rig.glb'));

const CLIP_JSON = {
	name: 'video-to-motion-test',
	duration: 1,
	tracks: [
		{
			name: 'Hips.quaternion',
			type: 'quaternion',
			times: [0, 1],
			values: [0, 0, 0, 1, 0, 0, 0, 1],
		},
		{
			name: 'Hips.position',
			type: 'vector',
			times: [0, 1],
			values: [0, 1, 0, 0, 1, 0],
		},
	],
};

async function stubSignedOut(page) {
	await page.route('**/api/auth/me', (r) => r.fulfill({ json: {} }));
}

async function stubSuccessfulCapture(page) {
	await page.route('**/api/motion-swap', (r) => {
		const body = r.request().postDataJSON?.() || {};
		if (body.action === 'upload') {
			return r.fulfill({
				json: {
					upload_url: 'https://cdn.example.invalid/upload-slot',
					public_url: 'https://cdn.example.invalid/video.mp4',
					method: 'PUT',
					headers: { 'content-type': 'video/mp4' },
				},
			});
		}
		return r.fulfill({ json: { job_id: 'job-1', eta_seconds: 1 } });
	});
	await page.route('https://cdn.example.invalid/upload-slot', (r) => r.fulfill({ status: 200, body: '' }));
	await page.route('**/api/motion-swap?job=job-1', (r) =>
		r.fulfill({ json: { status: 'done', clip_url: 'https://cdn.example.invalid/clip.json' } }),
	);
	await page.route('https://cdn.example.invalid/clip.json', (r) => r.fulfill({ json: CLIP_JSON }));
}

test.describe('/video-to-motion', () => {
	test.beforeEach(async ({ page }) => {
		await stubSignedOut(page);
	});

	for (const width of [320, 768, 1440]) {
		test(`empty state renders with no console errors at ${width}px`, async ({ page }) => {
			test.setTimeout(90_000);
			const errors = [];
			page.on('console', (msg) => {
				if (msg.type() === 'error') errors.push(msg.text());
			});
			page.on('pageerror', (err) => errors.push(String(err)));

			await page.setViewportSize({ width, height: 900 });
			await page.goto('/video-to-motion');

			await expect(page.locator('#vtm-drop')).toBeVisible();
			await expect(page.locator('#vtm-stage-processing')).toBeHidden();
			await expect(page.locator('#vtm-export-glb')).toBeDisabled();
			await expect(page.locator('#vtm-save-signed-out')).toBeVisible();

			expect(errors).toEqual([]);
		});
	}

	test('a successful capture reaches the ready stage and enables export', async ({ page }) => {
		test.setTimeout(90_000);
		await stubSuccessfulCapture(page);
		await page.goto('/video-to-motion');

		await page.setInputFiles('#vtm-file', {
			name: 'clip.mp4',
			mimeType: 'video/mp4',
			buffer: Buffer.from('fake-video-bytes'),
		});

		await expect(page.locator('#vtm-stage-processing')).toBeVisible();
		await expect(page.locator('#vtm-trim-row')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('#vtm-export-glb')).toBeEnabled();
		await expect(page.locator('#vtm-export-bvh')).toBeEnabled();
	});

	test('a failed capture shows the failed overlay, and retry returns to empty', async ({ page }) => {
		test.setTimeout(90_000);
		await page.route('**/api/motion-swap', (r) => {
			const body = r.request().postDataJSON?.() || {};
			if (body.action === 'upload') {
				return r.fulfill({
					json: {
						upload_url: 'https://cdn.example.invalid/upload-slot',
						public_url: 'https://cdn.example.invalid/video.mp4',
						method: 'PUT',
						headers: { 'content-type': 'video/mp4' },
					},
				});
			}
			return r.fulfill({ json: { job_id: 'job-2', eta_seconds: 1 } });
		});
		await page.route('https://cdn.example.invalid/upload-slot', (r) => r.fulfill({ status: 200, body: '' }));
		await page.route('**/api/motion-swap?job=job-2', (r) =>
			r.fulfill({ json: { status: 'failed', error: 'No person detected in the frame.' } }),
		);
		await page.goto('/video-to-motion');

		await page.setInputFiles('#vtm-file', {
			name: 'clip.mp4',
			mimeType: 'video/mp4',
			buffer: Buffer.from('fake-video-bytes'),
		});

		await expect(page.locator('#vtm-stage-failed')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('#vtm-fail-reason')).toHaveText('No person detected in the frame.');

		await page.locator('#vtm-retry').click();
		await expect(page.locator('#vtm-stage-empty')).toBeVisible();
	});

	test('a 429 shows the capture-limit overlay', async ({ page }) => {
		test.setTimeout(90_000);
		await page.route('**/api/motion-swap', (r) => {
			const body = r.request().postDataJSON?.() || {};
			if (body.action === 'upload') {
				return r.fulfill({
					json: {
						upload_url: 'https://cdn.example.invalid/upload-slot',
						public_url: 'https://cdn.example.invalid/video.mp4',
						method: 'PUT',
						headers: { 'content-type': 'video/mp4' },
					},
				});
			}
			return r.fulfill({ status: 429, json: { message: 'Too many captures from this connection.' } });
		});
		await page.route('https://cdn.example.invalid/upload-slot', (r) => r.fulfill({ status: 200, body: '' }));
		await page.goto('/video-to-motion');

		await page.setInputFiles('#vtm-file', {
			name: 'clip.mp4',
			mimeType: 'video/mp4',
			buffer: Buffer.from('fake-video-bytes'),
		});

		await expect(page.locator('#vtm-stage-limit')).toBeVisible({ timeout: 30_000 });
	});

	test('a non-Mixamo (Daz/Genesis) rig uploaded via file input retargets with no error', async ({ page }) => {
		test.setTimeout(90_000);
		await stubSuccessfulCapture(page);
		await page.goto('/video-to-motion');

		await page.setInputFiles('#vtm-file', {
			name: 'clip.mp4',
			mimeType: 'video/mp4',
			buffer: Buffer.from('fake-video-bytes'),
		});
		await expect(page.locator('#vtm-export-glb')).toBeEnabled({ timeout: 30_000 });

		await page.setInputFiles('#vtm-avatar-file', {
			name: 'daz-rig.glb',
			mimeType: 'model/gltf-binary',
			buffer: DAZ_RIG,
		});

		// A failed retarget surfaces its message in #vtm-status with
		// data-kind="error"; a successful one clears #vtm-status entirely.
		await expect(page.locator('#vtm-status[data-kind="error"]')).toBeHidden({ timeout: 15_000 });
		await expect(page.locator('#vtm-export-glb')).toBeEnabled();
	});
});

test.describe('/video-to-motion exports', () => {
	test.beforeEach(async ({ page }) => {
		await stubSignedOut(page);
	});

	test('GLB export is a well-formed glTF binary carrying the clip; BVH export is a well-formed hierarchy', async ({ page }) => {
		test.setTimeout(90_000);
		await stubSuccessfulCapture(page);
		await page.goto('/video-to-motion');
		await page.setInputFiles('#vtm-file', {
			name: 'clip.mp4',
			mimeType: 'video/mp4',
			buffer: Buffer.from('fake-video-bytes'),
		});
		await expect(page.locator('#vtm-export-glb')).toBeEnabled({ timeout: 30_000 });

		const [glbDownload] = await Promise.all([
			page.waitForEvent('download'),
			page.locator('#vtm-export-glb').click(),
		]);
		const glbBytes = readFileSync(await glbDownload.path());
		const dv = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
		expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF' magic
		expect(dv.getUint32(4, true)).toBe(2); // glTF version 2
		const jsonLen = dv.getUint32(12, true);
		const json = JSON.parse(Buffer.from(glbBytes.subarray(20, 20 + jsonLen)).toString('utf8'));
		expect(Array.isArray(json.animations)).toBe(true);
		expect(json.animations.length).toBeGreaterThan(0);
		expect(json.animations[0].channels.length).toBeGreaterThan(0);

		const [bvhDownload] = await Promise.all([
			page.waitForEvent('download'),
			page.locator('#vtm-export-bvh').click(),
		]);
		const bvhText = readFileSync(await bvhDownload.path(), 'utf8');
		expect(bvhText.startsWith('HIERARCHY')).toBe(true);
		expect(bvhText).toContain('ROOT Hips');
		expect(bvhText).toContain('MOTION');
		const frameMatch = bvhText.match(/Frames:\s*(\d+)/);
		expect(frameMatch).toBeTruthy();
		expect(Number(frameMatch[1])).toBeGreaterThan(0);
	});
});

import { test, expect } from '@playwright/test';

// Order x-grok-43: the X player card on /forge/share/:id (api/forge-share.js)
// points twitter:player at this exact runtime (pages/forge-embed.html). The
// unit suite (tests/api/forge-pipeline-endpoints.test.js) proves the meta tags
// are correct strings; this proves the page the meta tag names actually boots
// a real model-viewer and shows a model, which is what X's crawler and a
// person tapping the card both need. Dev serves this at the real file path
// (/forge-embed.html); the pretty /forge/embed rewrite is prod-only
// (vercel.json), same as tests/e2e/forge-embed-panel.spec.js's live preview.

const FOX = '/avatars/fox.glb';

const DEV_SERVER_NOISE = /WebSocket closed without opened/i;

function watchErrors(page) {
	const errors = [];
	page.on('pageerror', (err) => {
		const message = String(err?.message || err);
		if (!DEV_SERVER_NOISE.test(message)) errors.push(message);
	});
	return errors;
}

test.describe('forge player embed (X player card target)', () => {
	test('loads the real GLB, shows the poster first, and never autoplays audio', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto(
			`/forge-embed.html?src=${encodeURIComponent(FOX)}&poster=${encodeURIComponent('/avatars/fox-poster.png')}&title=${encodeURIComponent('A fox, forged')}`,
			{ waitUntil: 'domcontentloaded' },
		);

		const mv = page.locator('model-viewer#mv');
		await expect(mv).toHaveAttribute('src', FOX);
		// Poster-first: the attribute is set before the model finishes loading,
		// which is the only thing a server-rendered page can assert (model-viewer
		// itself decides when to swap poster for canvas once the GLB lands).
		await expect(mv).toHaveAttribute('poster', '/avatars/fox-poster.png');
		await expect(mv).toHaveAttribute('alt', 'A fox, forged \u2014 forged on three.ws');

		// model-viewer actually mounted its internal three.js canvas: the GLB
		// parsed and rendered, not just an empty custom element. model-viewer's
		// shadow root also holds an unrelated 2D overlay canvas, so target the
		// WebGL one by its own id rather than a generic descendant selector.
		await expect(page.locator('model-viewer#mv').locator('#webgl-canvas')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('body')).not.toHaveAttribute('data-state', 'error');

		// X's no-autoplay-audio rule: the embed never ships an <audio> or
		// <video> element at all, so there is nothing to autoplay.
		expect(await page.locator('audio, video').count()).toBe(0);
		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});

	test('framed by another origin (how X shows the card), it renders without a permissions-policy error', async ({
		page,
		baseURL,
	}) => {
		// X loads twitter:player in a cross-origin iframe that grants no
		// xr-spatial-tracking. model-viewer's "webxr" ar-mode probes WebXR anyway,
		// which Chromium reports as a console error inside the card. The host page
		// is served from a different origin so the frame gets the real
		// third-party permissions policy.
		const errors = watchErrors(page);
		const consoleErrors = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' && !DEV_SERVER_NOISE.test(msg.text())) consoleErrors.push(msg.text());
		});
		const player = `${baseURL}/forge-embed.html?src=${encodeURIComponent(FOX)}&title=${encodeURIComponent('A fox, forged')}`;
		// 127.0.0.1 and localhost are different origins but both loopback, so the
		// frame is truly cross-origin without tripping local-network-access blocks.
		const host = `${new URL(baseURL).protocol}//127.0.0.1:${new URL(baseURL).port}/__card-host__`;
		await page.route(host, (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: `<!doctype html><title>card host</title><iframe id="card" src="${player}" width="480" height="480"></iframe>`,
			}),
		);
		await page.goto(host);
		const frame = page.frameLocator('#card');
		await expect(frame.locator('model-viewer#mv').locator('#webgl-canvas')).toBeVisible({ timeout: 30_000 });
		await expect(frame.locator('body')).not.toHaveAttribute('data-state', 'error');
		// AR stays available through the modes a framed page can still launch.
		await expect(frame.locator('model-viewer#mv')).toHaveAttribute('ar-modes', 'scene-viewer quick-look');
		const xrErrors = consoleErrors.filter((t) => /xr-spatial-tracking|permissions policy/i.test(t));
		expect(xrErrors, `console errors: ${xrErrors.join(' | ')}`).toEqual([]);
		expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
	});

	test('keeps WebXR AR when the page is opened directly', async ({ page }) => {
		await page.goto(`/forge-embed.html?src=${encodeURIComponent(FOX)}`, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('model-viewer#mv')).toHaveAttribute('ar-modes', 'webxr scene-viewer quick-look');
	});

	test('shows the designed empty state, not a blank frame, when no model URL is given', async ({ page }) => {
		await page.goto('/forge-embed.html', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('body')).toHaveAttribute('data-state', 'error');
		await expect(page.locator('.msg h1')).toHaveText('No model to show');
	});

	test('rejects a javascript: src instead of loading it', async ({ page }) => {
		await page.goto(`/forge-embed.html?src=${encodeURIComponent("javascript:alert(1)")}`, {
			waitUntil: 'domcontentloaded',
		});
		await expect(page.locator('body')).toHaveAttribute('data-state', 'error');
		await expect(page.locator('model-viewer#mv')).not.toHaveAttribute('src', /javascript:/);
	});
});

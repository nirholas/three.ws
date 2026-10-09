import { test, expect } from '@playwright/test';

// /grok, the landing page for Grok Bot users.
//
// Drives the real page against the real APIs: the gallery strip fills from
// /api/forge-gallery, the setup tab mounts the shared connector card for
// /api/mcp-grok, the tool grid comes from that server's tools/list and the
// skill preview from /grok-skill.md. The failure and empty states are forced
// by answering the gallery request directly.

function watchErrors(page) {
	const errors = [];
	page.on('pageerror', (err) => errors.push(err.message));
	return errors;
}

test.describe('/grok', () => {
	test('renders every live section with real data', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/grok');
		const card = page.locator('#gk-grok-card');
		await expect(card.locator('#gc-name')).toHaveText('three-ws-grok');
		await expect(card.locator('#gc-url')).toHaveText('https://three.ws/api/mcp-grok');
		await expect(card.locator('[data-grok-auth="none"]')).toBeVisible();
		await expect(card.locator('#gc-say')).toHaveText(await page.locator('#gk-say-text').innerText());
		await expect(page.locator('#gk-tools .gk-tool').first()).toBeVisible({ timeout: 60_000 });
		await expect(page.locator('#gk-skill-list li:not(.gk-skel)').first()).toBeVisible();
		await expect(page.locator('.gk-recipe')).toHaveCount(3);

		const gallery = await page.request.get('/api/forge-gallery?limit=6').then((r) => r.json());
		if (gallery.enabled && gallery.creations.length) {
			await expect(page.locator('#gk-strip .gk-made').first()).toBeVisible({ timeout: 60_000 });
			await expect(page.locator('#gk-strip .gk-made').first()).toHaveAttribute('href', /^\/m\//);
		}
		expect(errors).toEqual([]);
	});

	test('the gallery strip offers a retry after an error, and says so when empty', async ({ page }) => {
		const errors = watchErrors(page);
		let mode = 'error';
		await page.route('**/api/forge-gallery**', (route) =>
			mode === 'error'
				? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
				: route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":true,"creations":[]}' }),
		);
		await page.goto('/grok');
		const note = page.locator('#gk-strip-note');
		await expect(note).toHaveAttribute('data-tone', 'error');
		await expect(note).toContainText('503');
		mode = 'empty';
		await note.getByRole('button', { name: 'Try again' }).click();
		await expect(note).not.toHaveAttribute('data-tone', 'error');
		await expect(note).toContainText('Be the first');
		expect(errors).toEqual([]);
	});
});

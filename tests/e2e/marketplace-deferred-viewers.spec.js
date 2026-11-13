// Marketplace cards must not build a <model-viewer> before anyone looks at one.
//
// Measured on a Pixel 5 (slow 4G, 4x CPU) against production /marketplace on
// 2026-11-13: every agent, avatar and onchain card without a stored picture,
// and every weekly theme pick, shipped a real <model-viewer> element whose
// model only loads on hover, focus or tap. Each element still ran model-viewer's
// whole constructor chain on insertion (shadow DOM, observers, renderer
// registration), about 32 ms apiece on that phone, and the grid renders three
// times while its feeds arrive, so a load constructed 90 viewers to keep 39:
// 2.9 s of main-thread blocking for models nobody had asked to see.
//
// Cards now carry an inert <model-slot> that becomes a real <model-viewer> on
// first attention. Since the same day the hero carousel follows that contract
// too: it paints each avatar's stored poster first and builds its viewer only
// once the visitor hovers, focuses or taps the hero, so no model-viewer is
// constructed (and model-viewer.min.js is not even fetched) during load.

import { test, expect } from '@playwright/test';

async function openMarketplace(page) {
	await page.goto('/marketplace', { waitUntil: 'domcontentloaded', timeout: 120_000 });
	// The grid is ready once it drops aria-busy and holds real cards.
	await page.waitForFunction(
		() => {
			const grid = document.getElementById('market-grid');
			return grid && !grid.hasAttribute('aria-busy') && grid.querySelector('.market-card-agent, .market-card-avatar');
		},
		null,
		{ timeout: 120_000 },
	);
}

test.describe('phone', () => {
	test.use({ viewport: { width: 393, height: 727 }, isMobile: true, hasTouch: true });

	test('cards build no model-viewer during load', async ({ page }) => {
		await openMarketplace(page);
		await page.waitForTimeout(1500);
		const counts = await page.evaluate(() => ({
			viewers: document.querySelectorAll('model-viewer').length,
			defined: !!customElements.get('model-viewer'),
			slots: document.querySelectorAll('#market-grid model-slot, #market-theme-picks model-slot').length,
			heroSlots: document.querySelectorAll('#market-hero-stage model-slot').length,
		}));
		expect(counts.slots, 'the grid must still offer 3D previews').toBeGreaterThan(0);
		expect(counts.viewers, JSON.stringify(counts)).toBe(0);
		expect(counts.defined, 'model-viewer must load on demand, not with the page').toBe(false);
	});

	test('tapping the hero wakes its active slide only', async ({ page }) => {
		await openMarketplace(page);
		const stage = page.locator('#market-hero-stage');
		await expect(stage.locator('.market-hero-slide model-slot')).not.toHaveCount(0, { timeout: 60_000 });
		// Slide 0 is on screen at first paint, so its poster is the one fetched at
		// high priority; autoplay may have moved on by now.
		await expect(stage.locator('.market-hero-slide[data-slot="0"] img.market-hero-poster')).toHaveAttribute('fetchpriority', 'high');
		await stage.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
		const mv = stage.locator('.market-hero-slide.active model-viewer');
		await expect(mv).toHaveCount(1, { timeout: 30_000 });
		await expect(mv).toHaveAttribute('src', /^https?:\/\/.+\.glb/);
		await expect(mv).toHaveAttribute('auto-rotate', '');
		expect(await page.evaluate(() => document.querySelectorAll('model-viewer:not(#market-hero model-viewer)').length)).toBe(0);
	});
});

test.describe('desktop', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('hovering a card turns its slot into a model-viewer loading that card\'s model', async ({ page }) => {
		await openMarketplace(page);
		// Pin the card first: once it wakes it no longer matches :has(model-slot).
		await page.evaluate(() => {
			const first = document.querySelector('#market-grid .market-card-agent:has(model-slot), #market-grid .market-card-avatar:has(model-slot)');
			first.setAttribute('data-e2e-card', '');
		});
		const card = page.locator('[data-e2e-card]');
		await card.scrollIntoViewIfNeeded();
		const glb = await card.locator('model-slot').getAttribute('data-src');
		expect(glb).toMatch(/^https?:\/\//);
		await card.hover();
		const mv = card.locator('model-viewer');
		await expect(mv).toHaveCount(1, { timeout: 10_000 });
		await expect(card.locator('model-slot')).toHaveCount(0);
		await expect(mv).toHaveAttribute('src', glb);
		expect(await mv.evaluate((el) => el.constructor !== HTMLElement && typeof el.dismissPoster === 'function')).toBe(true);
	});
});

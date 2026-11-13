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
// first attention. Only the hero carousel, which shows its model straight
// away, builds viewers during load.

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
		const counts = await page.evaluate(() => {
			const viewers = [...document.querySelectorAll('model-viewer')];
			return {
				outsideHero: viewers.filter((mv) => !mv.closest('#market-hero')).length,
				slots: document.querySelectorAll('#market-grid model-slot, #market-theme-picks model-slot').length,
			};
		});
		expect(counts.slots, 'the grid must still offer 3D previews').toBeGreaterThan(0);
		expect(counts.outsideHero, JSON.stringify(counts)).toBe(0);
	});
});

test.describe('desktop', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('hovering a card turns its slot into a model-viewer loading that card\'s model', async ({ page }) => {
		await openMarketplace(page);
		const card = page.locator('#market-grid .market-card-agent:has(model-slot), #market-grid .market-card-avatar:has(model-slot)').first();
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

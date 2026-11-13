// The coin page's header must not grow when the market data replaces its
// skeleton.
//
// Measured on a Pixel 5 against production on 2026-11-13 for /coin/<$THREE>:
// the skeleton header was 96 px tall, the rendered one 248 px (name row, price
// with its change chips wrapped under it, the "today" line, two rows of
// category chips). The price chart below moved 152 px down: a 0.1155 layout
// shift, the whole of the page's CLS budget on its own. Desktop grew 96 to 208.
//
// The header rows now have fixed heights (one-line name, one scrolling row of
// categories, a reserved "today" line) and the skeleton is built from the same
// rows, so the header is the same height before and after the data arrives.

import { test, expect } from '@playwright/test';

// $THREE, the coin this platform promotes. It has categories, a rank and a
// 24h move, so every row of the header renders.
const COIN = '/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const WIDTHS = [
	{ name: 'phone', viewport: { width: 393, height: 727 }, isMobile: true },
	{ name: 'small phone', viewport: { width: 320, height: 640 }, isMobile: true },
	{ name: 'tablet', viewport: { width: 768, height: 1024 } },
	{ name: 'desktop', viewport: { width: 1280, height: 800 } },
];

for (const { name, viewport, isMobile } of WIDTHS) {
	test.describe(name, () => {
		test.use({ viewport, isMobile: !!isMobile, hasTouch: !!isMobile });

		test('the header keeps its height when the market data renders', async ({ page }) => {
			await page.addInitScript(() => {
				document.addEventListener('DOMContentLoaded', () => {
					const head = document.getElementById('cv-head');
					const chart = document.getElementById('cv-chart');
					window.__first = {
						head: head ? head.getBoundingClientRect().height : -1,
						// Relative to the header, so a sub-pixel settle of the site nav
						// above main (0.6 px on desktop) does not count against it.
						chart: head && chart ? chart.getBoundingClientRect().top - head.getBoundingClientRect().top : -1,
						loaded: !!document.querySelector('#cv-head .cv-price'),
					};
				});
			});
			await page.goto(COIN, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			await page.waitForSelector('#cv-head .cv-price', { timeout: 120_000 });
			await page.waitForTimeout(300);

			const first = await page.evaluate(() => window.__first);
			expect(first.loaded, 'the price must not exist at DOMContentLoaded for this to test anything').toBe(false);
			const now = await page.evaluate(() => {
				const head = document.getElementById('cv-head');
				return {
					head: head.getBoundingClientRect().height,
					chart: document.getElementById('cv-chart').getBoundingClientRect().top - head.getBoundingClientRect().top,
					cats: head.querySelectorAll('.cv-cat').length,
					pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
				};
			});
			expect(Math.abs(now.head - first.head), JSON.stringify({ first, now })).toBeLessThanOrEqual(0.5);
			expect(Math.abs(now.chart - first.chart)).toBeLessThanOrEqual(0.5);
			// The categories still render (in one row), and the page never scrolls sideways.
			expect(now.cats).toBeGreaterThan(0);
			expect(now.pageOverflow).toBe(false);
		});
	});
}

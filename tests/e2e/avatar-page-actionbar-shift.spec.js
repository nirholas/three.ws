// The agent/avatar page's action bar must not grow when the view switcher
// mounts into it.
//
// Measured on a Pixel 5 against production on 2026-11-13: the switcher
// (3D, Chat, AR, Embed, Profile) is injected into an empty slot once the entity
// resolves. On a phone that slot is a full-width third row of the sticky action
// bar, so the bar grew from 65 to 125 px and pushed all of main#av-shell 60 px
// down: a 0.0669 layout shift on every agent profile view. At 700 px the
// switcher squeezed the back link and share buttons onto two lines (+19 px).
//
// The slot now reserves the switcher's height from the first paint and the
// side items never shrink, so the bar is the same height before and after.

import { test, expect } from '@playwright/test';

// A real agent with a 3D body, the one the mobile-perf preset measures.
const AGENT = '/agents/d94d2a50-86fa-4d2e-b87b-580f7517aa4c';

const WIDTHS = [
	{ name: 'phone', viewport: { width: 393, height: 851 }, isMobile: true },
	{ name: 'small tablet', viewport: { width: 620, height: 900 } },
	{ name: 'tablet', viewport: { width: 700, height: 900 } },
	{ name: 'desktop', viewport: { width: 1280, height: 800 } },
];

for (const { name, viewport, isMobile } of WIDTHS) {
	test.describe(name, () => {
		test.use({ viewport, isMobile: !!isMobile, hasTouch: !!isMobile });

		test('the action bar keeps its height when the view switcher mounts', async ({ page }) => {
			// Read the bar before any module script runs: the first paint's layout.
			await page.addInitScript(() => {
				document.addEventListener('DOMContentLoaded', () => {
					const bar = document.querySelector('.av-actionbar');
					const main = document.getElementById('av-shell');
					window.__first = {
						bar: bar ? bar.getBoundingClientRect().height : -1,
						main: main ? main.getBoundingClientRect().top : -1,
						switcher: !!document.querySelector('.view-switch'),
					};
				});
			});
			await page.goto(AGENT, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			await page.waitForSelector('#view-switch-slot .view-switch', { timeout: 120_000 });
			await page.waitForTimeout(300);

			const first = await page.evaluate(() => window.__first);
			expect(first.switcher, 'switcher must not exist at DOMContentLoaded for this to test anything').toBe(false);
			const now = await page.evaluate(() => ({
				bar: document.querySelector('.av-actionbar').getBoundingClientRect().height,
				main: document.getElementById('av-shell').getBoundingClientRect().top,
				items: [...document.querySelectorAll('.av-actionbar > *')].map((el) => ({
					cls: el.className,
					h: el.getBoundingClientRect().height,
					overflow: el.scrollWidth > el.clientWidth + 1,
				})),
			}));
			expect(Math.abs(now.bar - first.bar), JSON.stringify({ first, now })).toBeLessThanOrEqual(0.5);
			expect(Math.abs(now.main - first.main)).toBeLessThanOrEqual(0.5);
			// Nothing in the bar is clipped or wrapped to make room.
			for (const item of now.items) expect(item.overflow, item.cls).toBe(false);
		});
	});
}

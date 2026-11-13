// The marketplace's weekly theme strip must not grow when the week's theme
// replaces its placeholder.
//
// Measured on a Pixel 5 against production on 2026-11-13: the strip's header
// shipped as one line ("This week" and two placeholder dashes). When
// /api/marketplace/theme answered, the real title and blurb no longer fit, the
// blurb wrapped to its own line and the category's "Browse ..." button
// appeared on a third, so the header grew 89 px and moved the picks row, the
// hero carousel and everything under it: a 0.1059 layout shift on its own,
// more than the page's 0.1 budget.
//
// The header is now a fixed grid (eyebrow, title and button on one row, the
// blurb on one line under it; one row on wide screens), so the placeholder and
// the real theme take the same height.

import { test, expect } from '@playwright/test';

const WIDTHS = [
	{ name: 'phone', viewport: { width: 393, height: 727 }, isMobile: true },
	{ name: 'small phone', viewport: { width: 320, height: 640 }, isMobile: true },
	{ name: 'tablet', viewport: { width: 768, height: 1024 } },
	{ name: 'desktop', viewport: { width: 1280, height: 800 } },
];

for (const { name, viewport, isMobile } of WIDTHS) {
	test.describe(name, () => {
		test.use({ viewport, isMobile: !!isMobile, hasTouch: !!isMobile });

		test('the theme header keeps its height when the week loads', async ({ page }) => {
			await page.addInitScript(() => {
				document.addEventListener('DOMContentLoaded', () => {
					const head = document.querySelector('#market-theme-strip .market-theme-head');
					window.__first = {
						head: head ? head.getBoundingClientRect().height : -1,
						busy: !!document.getElementById('market-theme-strip')?.hasAttribute('aria-busy'),
					};
				});
			});
			await page.goto('/marketplace', { waitUntil: 'domcontentloaded', timeout: 120_000 });
			// renderTheme() drops aria-busy once the real theme is in.
			await page.waitForFunction(
				() => {
					const strip = document.getElementById('market-theme-strip');
					return strip && (strip.hidden || !strip.hasAttribute('aria-busy'));
				},
				null,
				{ timeout: 120_000 },
			);
			const first = await page.evaluate(() => window.__first);
			const now = await page.evaluate(() => {
				const strip = document.getElementById('market-theme-strip');
				const head = strip.querySelector('.market-theme-head');
				const blurb = document.getElementById('market-theme-blurb');
				return {
					hidden: strip.hidden,
					head: head.getBoundingClientRect().height,
					title: document.getElementById('market-theme-title').textContent.trim(),
					blurbTitle: blurb.getAttribute('title'),
					blurbText: blurb.textContent.trim(),
					pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
				};
			});
			test.skip(now.hidden, 'no theme this week: the strip collapses, nothing to compare');
			expect(first.busy, 'the theme must not be in before DOMContentLoaded').toBe(true);
			expect(now.title.length).toBeGreaterThan(1);
			expect(Math.abs(now.head - first.head), JSON.stringify({ first, now })).toBeLessThanOrEqual(0.5);
			// A blurb cut to one line stays readable in full on hover.
			expect(now.blurbTitle).toBe(now.blurbText);
			expect(now.pageOverflow).toBe(false);
		});
	});
}

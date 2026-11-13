// The /forge empty stage's starter chips must not move when their labels are
// randomized.
//
// Measured with Lighthouse desktop against production on 2026-11-13: /forge
// scored CLS 0.068, and 0.066 of it was `#empty-starters > button.chip`. The
// starters were a centered, wrapping flex row. seedChips()
// (src/forge-prompt-studio.js) swaps the static labels for generated prompts
// after first paint and already refuses a label that would wrap the row onto
// another line, but every swap still changed one chip's width, and in a
// centered flex row that slides every chip after it sideways. The row is now a
// grid of fixed cells with each chip filling its cell, so a chip's box depends
// only on the container width, never on its label.

import { test, expect } from '@playwright/test';

const WIDTHS = [
	{ name: 'small phone', viewport: { width: 320, height: 640 }, isMobile: true },
	{ name: 'phone', viewport: { width: 393, height: 727 }, isMobile: true },
	{ name: 'tablet', viewport: { width: 768, height: 1024 } },
	{ name: 'desktop', viewport: { width: 1350, height: 940 } },
];

for (const { name, viewport, isMobile } of WIDTHS) {
	test.describe(name, () => {
		test.use({ viewport, isMobile: !!isMobile, hasTouch: !!isMobile });

		test('randomized starter labels do not shift the starters', async ({ page }) => {
			await page.addInitScript(() => {
				window.__starterShift = 0;
				window.__staticLabels = null;
				new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						if (entry.hadRecentInput) continue;
						const hit = (entry.sources || []).some((s) => s.node && s.node.closest?.('#empty-starters'));
						if (hit) window.__starterShift += entry.value;
					}
				}).observe({ type: 'layout-shift', buffered: true });
				document.addEventListener('DOMContentLoaded', () => {
					window.__staticLabels = [...document.querySelectorAll('#empty-starters .chip')].map((c) => c.textContent.trim());
				});
			});
			await page.goto('/forge', { waitUntil: 'domcontentloaded', timeout: 120_000 });
			// seedChips() has run once any starter label differs from the HTML copy.
			await page.waitForFunction(
				() => {
					const labels = [...document.querySelectorAll('#empty-starters .chip')].map((c) => c.textContent.trim());
					return window.__staticLabels && labels.some((l, i) => l !== window.__staticLabels[i]);
				},
				null,
				{ timeout: 120_000 },
			);
			await page.waitForTimeout(1500);
			const out = await page.evaluate(() => ({
				shift: window.__starterShift,
				visible: !document.getElementById('state-empty')?.classList.contains('is-hidden'),
				overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
			}));
			test.skip(!out.visible, 'the empty stage is not showing (a returning visitor with a model loaded)');
			expect(out.shift, JSON.stringify(out)).toBeLessThan(0.001);
			expect(out.overflow).toBe(false);
		});
	});
}

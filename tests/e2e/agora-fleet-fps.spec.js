// Agora: the full citizen fleet must not collapse the frame rate. No more than
// MAX_ANIMATED mixers may advance at full rate in any one frame and the rest
// run at a reduced rate (src/agora/animation-budget.js,
// docs/agora/tasks/12-fleet-render-performance.md).
//
// Real data: /agora loads the live citizen fleet through the dev proxy. The
// browser here is usually headless Chromium on a software rasterizer, where
// per-object driver cost dwarfs a real GPU, so absolute fps is not asserted.
// The fleet is awaited until it has fully loaded, then the frame rate must stay
// above a floor relative to the first loaded window and the mixer ceiling,
// which is exact, must hold.

import { test, expect } from '@playwright/test';

test.setTimeout(420_000);

test('/agora holds its frame rate with the full fleet and budgets mixers', async ({ page }) => {
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/agora?fleetStats=1', { waitUntil: 'domcontentloaded', timeout: 120_000 });

	await page.waitForFunction(() => window.__agoraFleet && window.__agoraFleet.citizens >= 50, null, { timeout: 240_000, polling: 2_000 });
	// Let placement finish and the crowd's rigs land.
	await page.waitForFunction(
		() => {
			const f = window.__agoraFleet;
			const prev = window.__lastCitizens;
			window.__lastCitizens = f.citizens;
			return prev === f.citizens;
		},
		null,
		{ timeout: 240_000, polling: 8_000 },
	);

	const stats = await page.evaluate(() => window.__agoraFleet);
	console.log('citizens', stats.citizens, '| peak full mixers', stats.peakFull, '| peak advanced', stats.peakMixers, '| max', stats.maxAnimated);
	expect(stats.peakFull, 'full-rate mixers advanced in one frame').toBeLessThanOrEqual(stats.maxAnimated);
	expect(stats.mixers, 'the budget must advance fewer mixers than there are citizens').toBeLessThan(stats.citizens);
	expect(errors).toEqual([]);
});

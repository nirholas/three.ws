// Bring a page to its resting frame before axe measures it.
//
// axe composites a half-faded element's ink into its background, so a row
// still entering (opacity 0 to 1) reads as a contrast failure even though it
// clears AA at rest. First wait for every finite animation running now
// (capped, so a runaway effect never stalls the audit), then add a stylesheet
// that snaps every later animation and transition to its end, which also
// covers rows a polling page inserts after the wait. No colour, layout or
// content changes: only the in-between frames are removed.
// Same approach as tests/e2e/a11y-top-pages.spec.js.

export async function settleAndFreeze(page, capMs = 5_000) {
	await page.evaluate(async (cap) => {
		const finite = document.getAnimations().filter((a) => {
			const timing = a.effect && typeof a.effect.getTiming === 'function' ? a.effect.getTiming() : null;
			return a.playState !== 'finished' && !!timing && Number.isFinite(timing.iterations);
		});
		if (finite.length === 0) return;
		const settled = Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
		await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, cap))]);
	}, capMs);
	await page.addStyleTag({
		content: `*, *::before, *::after {
			animation-delay: 0s !important;
			animation-duration: 1ms !important;
			transition-delay: 0s !important;
			transition-duration: 1ms !important;
		}`,
	});
	await page.waitForTimeout(50);
}

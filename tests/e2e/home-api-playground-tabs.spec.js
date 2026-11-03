import { test, expect } from '@playwright/test';

// The classic homepage carries two playgrounds: the embed playground (HTML /
// React / ... flavor tabs) and the API playground (Try it / Node SDK / cURL).
// Both strips were once id="pg-tabs", so src/api-playground.js bound its tab
// handler to the embed strip and the API playground's Node SDK and cURL tabs
// did nothing when clicked. This drives the real page and clicks the real tabs.

test('the API playground tabs switch the pane they name', async ({ page }) => {
	const errors = [];
	page.on('pageerror', (err) => errors.push(err.message));
	// New visitors get the lite tier, which collapses the developer sections
	// (both playgrounds included). The full tier is the one that shows them.
	await page.addInitScript(() => {
		try {
			localStorage.setItem('tws:tier', 'full');
		} catch {}
	});
	await page.goto('/classic', { waitUntil: 'load' });

	const playground = page.locator('#api-playground');
	await expect(playground).toBeVisible({ timeout: 20000 });
	await playground.scrollIntoViewIfNeeded();
	const tabs = playground.locator('.dev-tab');
	await expect(tabs.first()).toBeVisible();

	for (const [name, pane] of [['Node SDK', 'sdk'], ['cURL', 'curl'], ['Try it', 'tryit']]) {
		const tab = playground.locator('.dev-tab', { hasText: name });
		await tab.click();
		await expect(tab).toHaveClass(/\bactive\b/);
		await expect(page.locator(`#pg-tab-${pane}`)).toHaveClass(/\bactive\b/);
		await expect(playground.locator('.dev-tab.active')).toHaveCount(1);
	}

	// The embed playground's flavor tabs are a separate widget and keep working.
	const react = page.locator('.pg-tabs .pg-tab[data-flavor="react"]');
	await react.click();
	await expect(react).toHaveClass(/\bactive\b/);
	expect(errors).toEqual([]);
});

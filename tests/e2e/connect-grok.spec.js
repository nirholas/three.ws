import { test, expect } from '@playwright/test';

// The Grok Bot tab on /connect.
//
// Grok Bot has no install link: its custom MCP connector is a form (name,
// transport, URL, authentication) and it connects from xAI's cloud. The tab
// shows those fields for whichever server is picked above it, so this drives
// the real page against the real server directory (/.well-known/mcp.json):
// the tab opens by click, by keyboard and by ?client=grok, the URL and the
// authentication follow every server choice, and the copy button puts the
// picked server's URL on the clipboard.

const GROK = 'https://three.ws/api/mcp-grok';

function watchErrors(page) {
	const errors = [];
	page.on('pageerror', (err) => errors.push(err.message));
	return errors;
}

test.describe('/connect Grok Bot tab', () => {
	test('arrow keys reach the tab and it shows the connector fields', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/connect');
		await expect(page.locator('.cn-server').first()).toBeVisible({ timeout: 60_000 });

		const claude = page.getByRole('tab', { name: 'Claude', exact: true });
		await claude.focus();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		const grok = page.getByRole('tab', { name: 'Grok Bot' });
		await expect(grok).toBeFocused();
		await expect(grok).toHaveAttribute('aria-selected', 'true');
		await expect(page).toHaveURL(/[?&]client=grok\b/);

		const panel = page.locator('#panel-grok');
		await expect(panel).toBeVisible();
		await expect(page.locator('#panel-claude')).toBeHidden();
		await expect(panel.locator('.cn-settings')).toContainText('Streamable HTTP');
		await expect(panel.locator('.cn-callout')).toContainText('localhost');

		// The default server needs sign-in, so the form asks for OAuth.
		await expect(page.locator('#cn-grok-url')).toHaveText('https://three.ws/api/mcp');
		await expect(panel.locator('[data-grok-auth="oauth"]')).toBeVisible();
		await expect(panel.locator('[data-grok-auth="none"]')).toBeHidden();
		await expect(page.locator('#cn-grok-say')).toHaveText(
			'Add a custom MCP server called three-ws-main at https://three.ws/api/mcp with OAuth authentication',
		);

		// Home and End wrap around the tab list like every other tab.
		await page.keyboard.press('End');
		await expect(page.getByRole('tab', { name: 'Other clients' })).toBeFocused();
		await page.keyboard.press('Home');
		await expect(claude).toBeFocused();
		expect(errors).toEqual([]);
	});

	test('?client=grok opens on the Grok server with no sign-in', async ({ page }) => {
		const errors = watchErrors(page);
		await page.goto('/connect?client=grok');
		await expect(page.getByRole('tab', { name: 'Grok Bot' })).toHaveAttribute('aria-selected', 'true');
		await expect(page.locator(`.cn-server[data-endpoint="${GROK}"]`)).toHaveAttribute('aria-checked', 'true', { timeout: 60_000 });

		const panel = page.locator('#panel-grok');
		await expect(page.locator('#cn-grok-url')).toHaveText(GROK);
		await expect(page.locator('#cn-grok-name')).toHaveText('three-ws-grok');
		await expect(panel.locator('[data-grok-auth="none"]')).toBeVisible();
		await expect(panel.locator('[data-grok-auth="oauth"]')).toBeHidden();
		await expect(page.locator('#cn-grok-signin-url')).toHaveText(`${GROK}?auth=oauth`);
		await expect(page.locator('#cn-grok-suggest')).toBeHidden();
		await expect(page.locator('#cn-grok-say')).toHaveText(`Add a custom MCP server called three-ws-grok at ${GROK}`);
		expect(errors).toEqual([]);
	});

	test('the copy button copies the URL of every server choice', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const errors = watchErrors(page);
		await page.goto('/connect?client=grok&server=three-ws-main');
		const servers = page.locator('.cn-server');
		await expect(servers.first()).toBeVisible({ timeout: 60_000 });

		// Off the Grok server, the panel offers to switch to it.
		await expect(page.locator('#cn-grok-suggest')).toBeVisible();

		const count = await servers.count();
		expect(count).toBeGreaterThan(1);
		for (let i = 0; i < count; i++) {
			const server = servers.nth(i);
			const endpoint = await server.getAttribute('data-endpoint');
			await server.click();
			await expect(page.locator('#cn-grok-url')).toHaveText(endpoint);
			await page.locator('#cn-grok-copy').click();
			await expect(page.locator('#cn-grok-copy')).toHaveAttribute('data-copied', 'true');
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(endpoint);

			// Exactly one authentication answer shows, and it matches the pill.
			const pill = await server.locator('.cn-pill').first().getAttribute('data-tone');
			const expected = pill === 'free' ? 'none' : pill === 'x402' ? 'key' : 'oauth';
			await expect(page.locator(`[data-grok-auth="${expected}"]`)).toBeVisible();
			await expect(page.locator('[data-grok-auth]:visible')).toHaveCount(1);
			await expect(page.locator('#cn-grok-copy')).not.toHaveAttribute('data-copied', 'true', { timeout: 5_000 });
		}

		// The suggestion button switches the whole page to the Grok server.
		await servers.first().click();
		await page.locator('#cn-grok-use').click();
		await expect(page.locator(`.cn-server[data-endpoint="${GROK}"]`)).toHaveAttribute('aria-checked', 'true');
		await expect(page.locator('#cn-grok-url')).toHaveText(GROK);
		await expect(page).toHaveURL(/[?&]server=three-ws-grok\b/);
		expect(errors).toEqual([]);
	});
});

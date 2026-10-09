/**
 * /connect, the Grok Bot tab. The tab shows the three settings Grok Bot's
 * custom MCP connector asks for, and the URL and sign-in must follow the
 * server picked in step 1. Runs against the real page and the real
 * /.well-known/mcp.json served by the dev server.
 */

import { expect, test } from '@playwright/test';

const GROK = 'https://three.ws/api/mcp-grok';
const MAIN = 'https://three.ws/api/mcp';

test.describe('/connect Grok Bot tab', () => {
	test.beforeEach(async ({ context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	});

	test('opens from the tab bar and shows transport, URL and authentication', async ({ page }) => {
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto('/connect');
		await expect(page.locator('#cn-servers .cn-server').first()).toBeVisible();

		const tab = page.getByRole('tab', { name: 'Grok Bot' });
		await tab.click();
		await expect(tab).toHaveAttribute('aria-selected', 'true');
		const panel = page.locator('#panel-grok');
		await expect(panel).toBeVisible();
		await expect(panel).toContainText('Streamable HTTP');
		await expect(panel).toContainText('localhost');
		await expect(page.locator('#cn-grok-url')).toHaveText(MAIN);
		await expect(page.locator('#cn-grok-auth')).toHaveText('OAuth');
		expect(new URL(page.url()).searchParams.get('client')).toBe('grok');
		expect(errors).toEqual([]);
	});

	test('the URL, authentication and copy button follow the picked server', async ({ page }) => {
		await page.goto('/connect?client=grok');
		await expect(page.locator('#cn-servers .cn-server').first()).toBeVisible();

		const free = page.locator('#cn-servers .cn-server', { hasText: 'No sign-in' }).first();
		await free.click();
		const freeUrl = await free.getAttribute('data-endpoint');
		await expect(page.locator('#cn-grok-url')).toHaveText(freeUrl);
		await expect(page.locator('#cn-grok-auth')).toHaveText('None');

		await page.locator('#panel-grok [data-copy-target="cn-grok-url"]').click();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(freeUrl);

		await page.locator(`#cn-servers .cn-server[data-endpoint="${MAIN}"]`).click();
		await expect(page.locator('#cn-grok-url')).toHaveText(MAIN);
		await expect(page.locator('#cn-grok-auth')).toHaveText('OAuth');
		await expect(page.locator('#cn-grok-signin-row')).toBeHidden();
		await page.locator('#panel-grok [data-copy-target="cn-grok-url"]').click();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(MAIN);
	});

	test('?client=grok preselects the Grok server and offers its OAuth URL', async ({ page }) => {
		await page.goto('/connect?client=grok');
		await expect(page.locator('#cn-grok-url')).toHaveText(GROK);
		await expect(page.locator('#cn-grok-signin-row')).toBeVisible();
		await expect(page.locator('#cn-grok-signin')).toHaveText(`${GROK}?auth=oauth`);
	});

	test('arrow keys move between tabs and reach the Grok Bot tab', async ({ page }) => {
		await page.goto('/connect');
		await page.getByRole('tab', { name: 'ChatGPT' }).focus();
		await page.keyboard.press('ArrowRight');
		const grok = page.getByRole('tab', { name: 'Grok Bot' });
		await expect(grok).toBeFocused();
		await expect(grok).toHaveAttribute('aria-selected', 'true');
		await expect(page.locator('#panel-grok')).toBeVisible();
		await page.keyboard.press('ArrowRight');
		await expect(page.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
		await expect(page.locator('#panel-grok')).toBeHidden();
	});
});

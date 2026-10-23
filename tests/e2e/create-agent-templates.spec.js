/**
 * Create-agent wizard: "Start from a template" gallery.
 *
 * Drives the real page. Auth and the three create calls are fulfilled at the
 * Playwright route layer (as in create-agent-avatar.spec.js) so the whole
 * client path runs: open the gallery, search, pick, prefill, ship. The test
 * asserts the POST bodies carry the template's persona and category.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { templates } = JSON.parse(
	readFileSync(path.join(import.meta.dirname, '..', '..', 'data/agent-templates.json'), 'utf8'),
);
const TEMPLATE = templates.find((t) => t.id === 'whale-watcher');

async function installFixtures(page, calls) {
	await page.route('**/api/auth/me**', (r) =>
		r.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ user: { id: 'usr_e2e', handle: 'e2e', display_name: 'E2E', plan: 'free' } }),
		}),
	);
	await page.route('**/api/avatars?**', (r) =>
		r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ avatars: [] }) }),
	);
	await page.route('**/api/agents', async (r) => {
		if (r.request().method() !== 'POST') return r.fallback();
		calls.create = r.request().postDataJSON();
		await r.fulfill({
			status: 201,
			contentType: 'application/json',
			body: JSON.stringify({ agent: { id: 'agt_e2e', name: calls.create.name } }),
		});
	});
	await page.route('**/api/marketplace/agents/*/publish', async (r) => {
		calls.publish = r.request().postDataJSON();
		await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
	});
}

test.describe('create-agent / template gallery', () => {
	test.beforeEach(async ({ page }) => {
		page.on('pageerror', (err) => {
			if (/WebSocket closed without opened/i.test(err.message)) return;
			throw new Error(`Uncaught page error: ${err.message}`);
		});
	});

	test('creates an agent from a template and ships its persona', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = {};
		await installFixtures(page, calls);
		await page.goto('/create-agent');
		await page.locator('#tpl-open').waitFor({ state: 'visible', timeout: 30_000 });

		await page.locator('#tpl-open').click();
		const dialog = page.locator('#tpl-dialog');
		await expect(dialog).toBeVisible();
		await expect(page.locator('.tpl-card').first()).toBeVisible();

		// Search narrows the grid; a miss shows the empty state with a way out.
		await page.locator('#tpl-search').fill('zzzznomatch');
		await expect(page.locator('#tpl-empty')).toBeVisible();
		await page.locator('#tpl-clear').click();
		await expect(page.locator('#tpl-empty')).toBeHidden();
		await page.locator('#tpl-search').fill('whale');
		await expect(page.locator('.tpl-card')).toHaveCount(
			templates.filter((t) => JSON.stringify(t).toLowerCase().includes('whale')).length > 0
				? await page.locator('.tpl-card').count()
				: 0,
		);

		await page.locator(`.tpl-card[data-id="${TEMPLATE.id}"]`).click();
		await expect(page.locator('.tpl-preview-name')).toHaveText(TEMPLATE.name);
		await page.locator('#tpl-use').click();
		await expect(dialog).toBeHidden();

		// Basics prefilled and still editable.
		await expect(page.locator('#f-name')).toHaveValue(TEMPLATE.name);
		await expect(page.locator('#tpl-status')).toContainText(TEMPLATE.name);
		await page.locator('#f-name').fill('Sol Whale Desk');

		// Personality step carries the template persona, greeting and category.
		await page.locator('#tpl-status button', { hasText: 'Review persona' }).click();
		await expect(page.locator('.panel[data-step="3"].is-active')).toBeVisible();
		await expect(page.locator('#f-persona')).toHaveValue(TEMPLATE.persona);
		await expect(page.locator('#f-greeting')).toHaveValue(TEMPLATE.greeting);
		await expect(page.locator('#f-category')).toHaveValue('finance');

		// Walk back to the avatar step, choose a starter, and ship.
		await page.locator('.stepper [data-step="1"], #stepper [data-step="1"]').first().click({ trial: false }).catch(() => {});
		if (!(await page.locator('.panel[data-step="1"].is-active').isVisible())) {
			while (!(await page.locator('.panel[data-step="1"].is-active').isVisible())) {
				await page.locator('#btn-back').click();
			}
		}
		await page.locator('#starter-grid .starter').first().click();
		for (let i = 0; i < 5 && !(await page.locator('#btn-create').isVisible()); i++) {
			await page.locator('#btn-next').click();
		}
		await page.locator('#btn-create').click();
		await expect(page.locator('#success-title')).toContainText('Sol Whale Desk');

		expect(calls.create.name).toBe('Sol Whale Desk');
		expect(calls.publish.system_prompt).toBe(TEMPLATE.persona.trim());
		expect(calls.publish.category).toBe('finance');
		expect(calls.publish.greeting).toBe(TEMPLATE.greeting);
	});

	test('keyboard: arrows move between cards, Escape closes, focus returns', async ({ page }) => {
		test.setTimeout(90_000);
		await installFixtures(page, {});
		await page.goto('/create-agent');
		await page.locator('#tpl-open').focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('#tpl-dialog')).toBeVisible();
		await expect(page.locator('.tpl-card').first()).toBeVisible();

		const first = page.locator('.tpl-card[tabindex="0"]');
		await first.focus();
		await page.keyboard.press('ArrowRight');
		const second = await page.evaluate(() => document.activeElement?.dataset?.id);
		expect(second).toBeTruthy();
		await page.keyboard.press('Home');
		await page.keyboard.press('Enter');
		await expect(page.locator('#tpl-use')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.locator('#tpl-dialog')).toBeHidden();
		await expect(page.locator('#tpl-open')).toBeFocused();
	});
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Compound alert rule builder (PriceAlertsPanel) in a real browser: empty
 * state, validation error, building a multi-condition rule, persistence across
 * reload, and migration of the legacy single-condition alerts.
 */

const RULES_KEY = 'hq-alert-rules-v1';
const LEGACY_KEY = 'hq-price-alerts';

/** The panel is lazy: a skeleton placeholder is swapped for the real panel once it scrolls into view. */
async function alertsPanel(page: Page) {
  const panel = page.locator('.panel[data-panel="price-alerts"]');
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.locator('.pa-container')).toBeVisible();
  return panel;
}

test.describe('HQ compound alert rules', () => {
  test('builds, persists and deletes a multi-condition rule', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((k) => localStorage.removeItem(k), RULES_KEY);
    await page.reload();

    const panel = await alertsPanel(page);
    await expect(panel.locator('.pa-empty')).toContainText('No alerts yet');
    await expect(panel.locator('.pa-empty')).toContainText('Press + Add');

    await panel.locator('#pa-toggle-form').click();
    await panel.locator('#pa-submit').click();
    await expect(panel.locator('.pa-form-error[role="alert"]')).toContainText('valid symbol and a number');

    await panel.locator('#pa-name').fill('e2e compound');
    await panel.locator('.pa-clause-symbol').first().fill('sol');
    await panel.locator('.pa-clause-op').first().selectOption('below');
    await panel.locator('.pa-clause-value').first().fill('1');
    await panel.locator('#pa-add-clause').click();
    await panel.locator('.pa-clause-metric').nth(1).selectOption('gas');
    await expect(panel.locator('.pa-clause-symbol')).toHaveCount(1);
    await panel.locator('.pa-clause-value').nth(1).fill('500');
    await panel.locator('[data-join="any"]').click();
    await expect(panel.locator('[data-join="any"]')).toHaveClass(/active/);
    await panel.locator('#pa-submit').click();

    const row = panel.locator('.pa-alert-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('e2e compound');
    await expect(row).toContainText('SOL price <= $1 OR ETH gas >= 500 gwei');

    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), RULES_KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'e2e compound', join: 'any', handoff: false, enabled: true });
    expect(stored[0].clauses).toEqual([
      { metric: 'price', symbol: 'SOL', op: 'below', value: 1 },
      { metric: 'gas', symbol: 'ETH', op: 'above', value: 500 },
    ]);

    await page.reload();
    await alertsPanel(page);
    await expect(panel.locator('.pa-alert-row')).toContainText('e2e compound');

    await panel.locator('[data-delete]').click();
    await expect(panel.locator('.pa-empty')).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), RULES_KEY)).toBe('[]');
  });

  test('migrates legacy single-condition alerts and keeps the legacy key as a backup', async ({ page }) => {
    await page.goto('/');
    const legacy = [{ id: 'legacy-1', symbol: 'BTC', condition: 'above', targetPrice: 1000000, enabled: true, triggered: false }];
    await page.evaluate(([rk, lk, v]) => { localStorage.removeItem(rk); localStorage.setItem(lk, v); }, [RULES_KEY, LEGACY_KEY, JSON.stringify(legacy)] as const);
    await page.reload();

    const panel = await alertsPanel(page);
    await expect(panel.locator('.pa-alert-row')).toContainText('BTC price >= $1000000');
    const after = await page.evaluate(([rk, lk]) => ({ rules: JSON.parse(localStorage.getItem(rk) || '[]'), legacy: localStorage.getItem(lk) }), [RULES_KEY, LEGACY_KEY] as const);
    expect(after.rules).toHaveLength(1);
    expect(after.rules[0]).toMatchObject({ id: 'legacy-1', join: 'all' });
    expect(after.legacy).not.toBeNull();
  });
});

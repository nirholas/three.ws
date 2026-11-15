import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Protocol Dashboards, Oracle Monitor and Protocol Risk Heatmap in a real
 * browser. The Vite dev server has no route for these handlers, so the spec
 * starts HQ's own local API sidecar and forwards each panel's request to it:
 * the populated states render live DeFiLlama, Pyth, Chainlink and exchange
 * data. Loading, error and empty states are produced by holding or answering
 * the request in the browser, the way an upstream outage would.
 */

const API_PORT = 46000 + Math.floor(Math.random() * 900);
const API = `http://127.0.0.1:${API_PORT}`;
let sidecar: ChildProcess | null = null;

test.beforeAll(async () => {
  sidecar = spawn(process.execPath, ['src-tauri/sidecar/local-api-server.mjs'], {
    env: { ...process.env, LOCAL_API_PORT: String(API_PORT), LOCAL_API_CLOUD_FALLBACK: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('local API sidecar did not start within 30s')), 30_000);
    sidecar!.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening on')) { clearTimeout(timer); resolve(); }
    });
    sidecar!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`local API sidecar exited with ${code}`)); });
  });
});

test.afterAll(() => {
  sidecar?.kill();
});

async function forward(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const response = await route.fetch({ url: `${API}${url.pathname}${url.search}`, timeout: 90_000 });
  await route.fulfill({ response });
}

/** Holds requests matching `pattern` until the returned release() is called, then forwards them to the sidecar. */
async function holdThenForward(page: Page, pattern: string): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(pattern, async (route) => { await gate; await forward(route); });
  return release;
}

/** Lazy panels mount their real class once they scroll into view. */
async function panel(page: Page, id: string) {
  const el = page.locator(`.panel[data-panel="${id}"]`);
  await el.scrollIntoViewIfNeeded();
  return el;
}

function failOnce(page: Page, pattern: string, message: string) {
  let failed = false;
  return page.route(pattern, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: message }) });
      return;
    }
    await forward(route);
  });
}

test.describe('HQ protocol intelligence panels', () => {
  test.setTimeout(180_000);
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('risk heatmap: skeleton, live Solana matrix with honest unknown cells', async ({ page }) => {
    const release = await holdThenForward(page, '**/api/risk-heatmap*');
    await page.goto('/');
    const p = await panel(page, 'risk-heatmap');
    await expect(p.locator('.pd-skel[aria-busy="true"]')).toBeVisible();
    release();

    const rows = p.locator('.rh-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 90_000 });
    expect(await rows.count()).toBeGreaterThan(3);
    await expect(p.locator('[data-rh-chain]')).toHaveValue('Solana');
    await expect(p.locator('.rh-table thead')).toContainText('Governance');

    const unknown = p.locator('.rh-table tbody .rh-cell.rh-unknown').first();
    await expect(unknown).toHaveText('?');
    await expect(unknown).toHaveAttribute('aria-label', /risk unknown/);
    await unknown.focus();
    await expect(unknown).toBeFocused();

    const method = p.locator('.pd-method');
    await method.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(method).toHaveAttribute('open', '');
    await expect(method).toContainText('Heuristic, not financial advice');
  });

  test('risk heatmap: error with working retry, then designed empty state', async ({ page }) => {
    await failOnce(page, '**/api/risk-heatmap*', 'The data sources did not answer. Try again in a moment.');
    await page.goto('/');
    const p = await panel(page, 'risk-heatmap');
    const alert = p.locator('.pd-error[role="alert"]');
    await expect(alert).toContainText('did not answer');
    await alert.locator('[data-pd-retry]').click();
    await expect(p.locator('.rh-table tbody tr').first()).toBeVisible({ timeout: 90_000 });

    await page.unroute('**/api/risk-heatmap*');
    await page.route('**/api/risk-heatmap*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ timestamp: new Date().toISOString(), chain: 'all', dimensions: ['contract', 'oracle', 'governance', 'liquidity', 'market'], rows: [], sources: ['DeFiLlama protocols and hacks'], methodology: 'Heuristic, not financial advice or an audit.' }),
    }));
    await p.locator('[data-rh-chain]').selectOption('all');
    await expect(p.locator('.pd-empty')).toContainText('No protocols came back');
  });

  test('oracle monitor: skeleton, live Pyth (Solana) and Chainlink rows with ages', async ({ page }) => {
    const release = await holdThenForward(page, '**/api/oracle-deviation*');
    await page.goto('/');
    const p = await panel(page, 'oracle-monitor');
    await expect(p.locator('.pd-skel[aria-busy="true"]')).toBeVisible();
    release();

    const rows = p.locator('.pd-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 90_000 });
    await expect(rows.first()).toContainText('Pyth');
    await expect(rows.first()).toContainText('Solana');
    await expect(p.locator('.pd-table tbody')).toContainText('Chainlink');
    await expect(rows.first().locator('td').nth(5)).toHaveText(/^\d+(s|m|\.\dh) \/ /);

    const threshold = p.locator('[data-om-threshold]');
    await threshold.focus();
    await threshold.selectOption('25');
    await expect(p.locator('[data-om-threshold]')).toHaveValue('25');
  });

  test('oracle monitor: error with working retry, then designed empty state', async ({ page }) => {
    await failOnce(page, '**/api/oracle-deviation*', 'Oracle reads failed. Try again in a moment.');
    await page.goto('/');
    const p = await panel(page, 'oracle-monitor');
    await expect(p.locator('.pd-error[role="alert"]')).toContainText('Oracle reads failed');
    await p.locator('[data-pd-retry]').click();
    await expect(p.locator('.pd-table tbody tr').first()).toBeVisible({ timeout: 90_000 });

    await page.unroute('**/api/oracle-deviation*');
    await page.route('**/api/oracle-deviation*', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ timestamp: new Date().toISOString(), thresholdBps: 100, rows: [], lanes: {}, sources: ['Pyth'], methodology: 'Deviation in basis points.' }),
    }));
    await p.locator('[data-om-threshold]').selectOption('100');
    const empty = p.locator('.pd-empty');
    await expect(empty).toContainText('No oracle feeds answered');
    await expect(empty.locator('[data-pd-retry]')).toHaveText('Check again');
  });

  test('protocol dashboard: Solana protocol first, then an EVM protocol, from live data', async ({ page }) => {
    await page.route('**/api/top-protocols*', forward);
    const release = await holdThenForward(page, '**/api/protocol-dashboard*');
    await page.goto('/');
    const p = await panel(page, 'protocol-dashboard');
    const picker = p.locator('[data-pd-picker]');
    await expect(picker).toBeVisible({ timeout: 90_000 });
    await expect(p.locator('.pd-skel[aria-busy="true"]')).toBeVisible();
    release();

    await expect(p.locator('[data-pd-solana]')).toBeChecked();
    const categories = await page.evaluate(async () => {
      const res = await fetch('/api/top-protocols');
      const json = await res.json() as { protocols: { slug: string; category: string }[] };
      return Object.fromEntries(json.protocols.map((x) => [x.slug, x.category]));
    });
    const offered = await picker.locator('option').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(offered.length).toBeGreaterThan(3);
    expect(offered.filter((slug) => ['CEX', 'Chain'].includes(categories[slug]))).toEqual([]);

    const head = p.locator('.pd-head');
    await expect(head).toBeVisible({ timeout: 90_000 });
    await expect(head).toContainText('Solana');
    await expect(p.locator('.pd-block h4').first()).toHaveText('TVL');

    await p.locator('[data-pd-solana]').uncheck();
    await expect(picker.locator('option[value="uniswap-v3"]')).toHaveCount(1, { timeout: 90_000 });
    await picker.selectOption('uniswap-v3');
    await expect(head).toContainText('Uniswap', { timeout: 90_000 });
    await expect(p.locator('.pd-block h4', { hasText: 'LP profitability' })).toBeVisible();
    const window7 = p.locator('[data-pd-window="7"]');
    await window7.click();
    await expect(p.locator('[data-pd-window="7"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 90_000 });
  });

  test('protocol dashboard: error with working retry', async ({ page }) => {
    await page.route('**/api/top-protocols*', forward);
    await failOnce(page, '**/api/protocol-dashboard*', 'DeFiLlama did not answer. Try again in a moment.');
    await page.goto('/');
    const p = await panel(page, 'protocol-dashboard');
    await expect(p.locator('.pd-error[role="alert"]')).toContainText('DeFiLlama did not answer', { timeout: 90_000 });
    await p.locator('[data-pd-retry]').click();
    await expect(p.locator('.pd-head')).toBeVisible({ timeout: 90_000 });
  });

  test('protocol dashboard: designed empty picker state with a chain toggle', async ({ page }) => {
    await page.route('**/api/top-protocols*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ protocols: [] }) }));
    await page.goto('/');
    const q = await panel(page, 'protocol-dashboard');
    await expect(q.locator('.pd-empty')).toContainText('No protocols with Solana TVL came back', { timeout: 90_000 });
    await q.locator('[data-pd-toggle-solana]').click();
    await expect(q.locator('.pd-empty')).toContainText('No protocols with TVL came back');
  });
});

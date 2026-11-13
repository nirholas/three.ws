import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';

/**
 * Real-browser round trip of the HQ host bridge: a host page on an allowlisted
 * origin embeds HQ in an iframe and drives it through src/hq-host.js, the
 * same client three.ws pages use. Covers hq:ready, correlated panel data with
 * freshness, a malformed command, a DeFi tool query, and a compound alert rule
 * firing across the frame boundary.
 */

// An allowlisted host origin (hq-bridge-origins.ts). The page is served by a real
// local server: Chrome's local-network checks block a localhost iframe inside a
// page synthesized with route.fulfill, which has no address space of its own.
const HOST_PORT = 3210;
const HOST_ORIGIN = `http://localhost:${HOST_PORT}`;
const HOST_CLIENT = readFileSync(new URL('../../../src/hq-host.js', import.meta.url), 'utf8');

declare global {
  interface Window {
    __hq: {
      host: {
        getPanelData(key: string): Promise<unknown>;
        getPanelSnapshot(key: string): Promise<{ key: string; data: unknown; updatedAt: string | null }>;
        runTool(tool: string, args?: Record<string, unknown>): Promise<{ tool: string; args: Record<string, unknown>; rows: unknown[]; facts: string[] }>;
      };
      frame: HTMLIFrameElement;
      origin: string;
      events: Array<{ type: string; payload: unknown }>;
      raw: Array<{ type: string; payload: Record<string, unknown> }>;
    };
  }
}

function hostPage(hqUrl: string): string {
  const hqOrigin = new URL(hqUrl).origin;
  return `<!doctype html><meta charset="utf-8"><title>HQ host</title>
<iframe id="hq" src="${hqUrl}" style="width:1280px;height:900px;border:0"></iframe>
<script type="module">
import { createHqHost } from '/hq-host.js';
const frame = document.getElementById('hq');
const raw = [];
// Registered before the client so a reply is recorded before its promise settles.
window.addEventListener('message', (e) => { if (e.origin === ${JSON.stringify(hqOrigin)}) raw.push(e.data); });
const host = createHqHost({ frame, origin: ${JSON.stringify(hqOrigin)}, timeoutMs: 45000 });
window.__hq = { host, frame, origin: ${JSON.stringify(hqOrigin)}, events: [], raw };
for (const type of ['hq:ready', 'hq:alert-triggered']) host.on(type, (payload) => window.__hq.events.push({ type, payload }));
</script>`;
}

let hostServer: Server;
let hqUrl = '';

test.beforeAll(async ({ baseURL }) => {
  hqUrl = `${baseURL}/`;
  hostServer = createServer((req, res) => {
    if (req.url === '/hq-host.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(HOST_CLIENT);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(hostPage(hqUrl));
  });
  await new Promise<void>((resolve, reject) => {
    hostServer.once('error', reject);
    hostServer.listen(HOST_PORT, 'localhost', () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => hostServer.close(() => resolve()));
});

async function openHost(page: Page): Promise<void> {
  await page.goto(`${HOST_ORIGIN}/host.html`);
}

/** Agent tools and alert feeds live in api/*.js, which only the HQ server (not Vite dev) serves. */
async function apiServed(page: Page, baseURL: string): Promise<boolean> {
  const res = await page.request.get(`${baseURL}/api/agent-tools`).catch(() => null);
  return !!res && res.ok() && (res.headers()['content-type'] ?? '').includes('json');
}

test.describe('HQ host bridge', () => {
  test('announces hq:ready while the data load is still running', async ({ page, baseURL }) => {
    await openHost(page);
    await page.waitForFunction(() => window.__hq?.events.some((e) => e.type === 'hq:ready'), null, { timeout: 30000 });
    const ready = await page.evaluate(() => window.__hq.events.find((e) => e.type === 'hq:ready')!.payload as { version: string; variant: string });
    expect(typeof ready.version).toBe('string');
    expect(['full', 'tech']).toContain(ready.variant);
  });

  test('answers host:get-panel-data with the correlation id and a freshness time', async ({ page, baseURL }) => {
    await openHost(page);
    await page.waitForFunction(() => window.__hq?.events.some((e) => e.type === 'hq:ready'), null, { timeout: 30000 });

    const panels = await page.evaluate(async () => {
      const snap = await window.__hq.host.getPanelSnapshot('panels');
      const reply = window.__hq.raw.find((m) => m.type === 'hq:panel-data' && m.payload.key === 'panels');
      return { snap, reply };
    });
    expect(panels.reply?.payload.id).toMatch(/^h[a-z0-9]+$/);
    expect(panels.snap.key).toBe('panels');
    expect((panels.snap.data as Record<string, boolean>)['price-alerts']).toBe(true);
    expect(Date.parse(panels.snap.updatedAt!)).toBeGreaterThan(Date.now() - 60_000);

    const markets = await page.evaluate(() => window.__hq.host.getPanelSnapshot('markets'));
    expect(Array.isArray(markets.data)).toBe(true);
    if (markets.updatedAt === null) expect(markets.data).toEqual([]);
    else expect(Number.isNaN(Date.parse(markets.updatedAt))).toBe(false);
  });

  test('replies hq:error to a malformed or unknown panel request', async ({ page, baseURL }) => {
    await openHost(page);
    await page.waitForFunction(() => window.__hq?.events.some((e) => e.type === 'hq:ready'), null, { timeout: 30000 });

    await page.evaluate(() => {
      window.__hq.frame.contentWindow!.postMessage({ type: 'host:get-panel-data', payload: { id: 'bad-1', key: 42, extra: 'x' } }, window.__hq.origin);
    });
    await page.waitForFunction(() => window.__hq.raw.some((m) => m.type === 'hq:error' && m.payload.id === 'bad-1'));
    const bad = await page.evaluate(() => window.__hq.raw.find((m) => m.type === 'hq:error' && m.payload.id === 'bad-1')!.payload);
    expect(bad.code).toBe('bad_request');

    const unknown = await page.evaluate(() => window.__hq.host.getPanelData('no-such-panel').then(() => null, (err) => ({ code: err.code, message: err.message })));
    expect(unknown).toEqual({ code: 'unknown_panel', message: expect.stringContaining('no-such-panel') });
  });

  test('runs a DeFi tool over the bridge with live data', async ({ page, baseURL }) => {
    test.skip(!(await apiServed(page, baseURL!)), 'api/agent-tools is served by the HQ server (npm run build && node scripts/cloudrun-server.mjs), not Vite dev');
    await openHost(page);
    await page.waitForFunction(() => window.__hq?.events.some((e) => e.type === 'hq:ready'), null, { timeout: 30000 });

    const r = await page.evaluate(() => window.__hq.host.runTool('top_yields', { chain: 'Solana', symbol: 'USDC', limit: 3 }));
    expect(r.tool).toBe('top_yields');
    expect(r.args).toMatchObject({ chain: 'Solana', symbol: 'USDC' });
    expect(r.facts.length).toBeGreaterThan(0);
    for (const row of r.rows as Array<{ chain: string; symbol: string }>) {
      expect(row.chain).toBe('Solana');
      expect(row.symbol.toUpperCase()).toBe('USDC');
    }
  });

  test('a compound rule built in HQ fires hq:alert-triggered with a reversible proposal', async ({ page, baseURL }) => {
    test.skip(!(await apiServed(page, baseURL!)), 'live alert feeds are served by the HQ server, not Vite dev');
    await openHost(page);
    await page.waitForFunction(() => window.__hq?.events.some((e) => e.type === 'hq:ready'), null, { timeout: 30000 });

    const hq = page.frameLocator('#hq');
    // Lazy panel: the skeleton placeholder is replaced by the real panel once in view.
    const panel = hq.locator('.panel[data-panel="price-alerts"]');
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.locator('.pa-container')).toBeVisible();
    await panel.locator('#pa-toggle-form').click();
    await panel.locator('#pa-name').fill('e2e bridge rule');
    await panel.locator('.pa-clause-symbol').first().fill('BTC');
    await panel.locator('.pa-clause-value').first().fill('1');
    await panel.locator('#pa-add-clause').click();
    await panel.locator('.pa-clause-symbol').nth(1).fill('ETH');
    await panel.locator('.pa-clause-value').nth(1).fill('1');
    await panel.locator('#pa-handoff').check();
    await panel.locator('#pa-submit').click();

    await page.waitForFunction(() => window.__hq.events.some((e) => e.type === 'hq:alert-triggered'), null, { timeout: 60000 });
    const fired = await page.evaluate(() => window.__hq.events.find((e) => e.type === 'hq:alert-triggered')!.payload as Record<string, any>);
    expect(fired.name).toBe('e2e bridge rule');
    expect(fired.handoff).toBe(true);
    expect(fired.description).toMatch(/BTC/);
    expect(fired.description).toMatch(/ETH/);
    expect(['briefing', 'create_alert']).toContain(fired.proposal.kind);
    await expect(panel.locator('.pa-triggered-badge')).toBeVisible();
  });
});

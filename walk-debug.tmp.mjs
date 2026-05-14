import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
await ctx.grantPermissions(['camera']);
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (err) => logs.push('[pageerror] ' + (err?.stack || err)));
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('requestfailed', (req) => logs.push(`[reqfail] ${req.url()} ${req.failure()?.errorText}`));
page.on('websocket', (ws) => {
	logs.push(`[ws-open] ${ws.url()}`);
	ws.on('framereceived', (f) => logs.push(`[ws-recv] ${typeof f.payload === 'string' ? f.payload.slice(0,80) : `<${f.payload.length}B>`}`));
	ws.on('framesent', (f) => logs.push(`[ws-send] ${typeof f.payload === 'string' ? f.payload.slice(0,80) : `<${f.payload.length}B>`}`));
	ws.on('socketerror', (e) => logs.push(`[ws-err] ${e}`));
	ws.on('close', () => logs.push(`[ws-close] ${ws.url()}`));
});

await page.goto('http://localhost:3000/walk?name=alice', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

const state = await page.evaluate(() => ({
	statusText: document.getElementById('walk-status')?.textContent,
	onlineStatus: document.getElementById('walk-online')?.dataset?.status,
	onlineLabel: document.getElementById('walk-online')?.querySelector('[data-label]')?.textContent,
}));
await browser.close();
console.log(JSON.stringify({ state, logs }, null, 2));

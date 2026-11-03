// Drives the head-unit page in real Chromium with no dongle attached and
// reports console errors, the visible panel and screenshots.
// Usage: node scripts/verify-head-unit-page.mjs <page url> <screenshot dir>
import { chromium } from 'playwright';

const [url = 'http://127.0.0.1:7300/', outDir = '.'] = process.argv.slice(2);
const browser = await chromium.launch();
const problems = [];
for (const [name, viewport] of [['desktop', { width: 1280, height: 720 }], ['phone', { width: 400, height: 860 }]]) {
	const page = await browser.newPage({ viewport });
	page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${name} ${m.type()}: ${m.text()}`));
	page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
	await page.goto(url, { waitUntil: 'load' });
	await page.waitForSelector('#panel-disconnected:not([hidden])', { timeout: 15000 });
	await page.waitForFunction(() => document.getElementById('agent').classList.contains('is-ready'), null, { timeout: 30000 }).catch(() => problems.push(`${name}: agent iframe never loaded`));
	const visible = await page.$$eval('[data-panel]:not([hidden])', (els) => els.map((e) => e.id));
	const status = await page.textContent('#status-text');
	const ids = await page.textContent('#usb-ids');
	const note = await page.textContent('#probe-note');
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
	await page.click('[data-action="retry"]:visible');
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${outDir}/head-unit-${name}.png` });
	console.log(JSON.stringify({ name, visible, status, ids, note, horizontalOverflow: overflow }));
	await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'console: clean');

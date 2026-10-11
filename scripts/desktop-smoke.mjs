// Drives the web desktop in a real browser: boots it, opens the Start menu,
// launches apps, and reports console errors and failed requests.
// Usage: node scripts/desktop-smoke.mjs [baseUrl] [screenshotDir]
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:3000';
const shots = process.argv[3] || '';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => !/ERR_ABORTED/.test(r.failure()?.errorText || '') && problems.push(`failed: ${r.url()}`));
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png` });

await page.goto(`${base}/?view=desktop`, { waitUntil: 'networkidle' });
await page.waitForSelector('.os-task');
await shot('1-boot');
console.log('icons', await page.locator('.os-icon').count(), 'welcome win', await page.locator('.win[data-app=welcome]').count());

await page.click('.os-tb.start');
await page.waitForSelector('.start-menu');
await page.fill('.start-menu input', 'forge');
await shot('2-start-search');
await page.keyboard.press('Enter');
await page.waitForSelector('.win[data-app=forge] iframe');
await page.waitForTimeout(3000);
console.log('forge title', await page.locator('.win[data-app=forge] .win-name').textContent());
console.log('nav hidden in frame', await page.frameLocator('.win[data-app=forge] iframe').locator('html.tws-in-os').count());
await shot('3-forge');

await page.dblclick('.os-icon:nth-child(3)').catch(() => {});
await page.click('.os-tb[aria-label^="Widgets"]');
await page.waitForSelector('.widgets');
await shot('4-widgets');
await page.keyboard.press('Escape');
await page.click('.os-clock');
await shot('5-calendar');
await page.keyboard.press('Escape');
await page.click('.win[data-app=forge] .win-maxbtn');
await shot('6-max');
await page.click('.win[data-app=forge] .win-min');
console.log('running buttons', await page.locator('.os-tb.run').count());

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.os-task');
console.log('restored windows', await page.locator('.win').count());

await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(400);
await shot('7-mobile');
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();

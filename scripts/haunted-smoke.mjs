// Drives /haunted in headless Chromium against the dev server and reports console errors.
// Usage: node scripts/haunted-smoke.mjs [url] [screenshot.png]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:3000/haunted';
const shot = process.argv[3];
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#hn-loading', { state: 'hidden', timeout: 90000 }).catch(() => problems.push('loading overlay never hid'));
await page.waitForTimeout(2500);
const chips = await page.locator('#hn-chars [role=radio]').count();
const clips = await page.locator('#hn-anim option').count();
await page.keyboard.press('2');
await page.waitForTimeout(1500);
await page.click('#hn-lights');
await page.fill('#hn-fog', '0.08');
if (shot) await page.screenshot({ path: shot });
console.log(JSON.stringify({ chips, clips, problems }, null, 2));
await browser.close();
process.exit(problems.length || !chips ? 1 : 0);

// Launches every native OS app in the real desktop shell and reports console errors.
// Usage: node scripts/desktop-os-smoke.mjs [baseUrl] [outDir]
import { chromium } from '@playwright/test';

const base = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || '';
const apps = ['files', 'notepad', 'photos', 'calculator', 'clock', 'weather', 'camera', 'paint', 'terminal', 'taskmgr', 'media'];
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let failed = 0;
for (const id of apps) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone', 'geolocation'], geolocation: { latitude: 40.7, longitude: -74 } });
	const page = await ctx.newPage();
	const errors = [];
	page.on('console', (m) => m.type() === 'error' && !/503|Failed to load resource/.test(m.text()) && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto(`${base}/?view=desktop&boot=0&world=0&app=${id}`, { waitUntil: 'domcontentloaded' });
	const win = page.locator(`.win[data-app="${id}"]`);
	await win.waitFor({ timeout: 15000 }).catch(() => errors.push('window did not open'));
	await page.waitForTimeout(2500);
	const broken = await page.locator(`.win[data-app="${id}"] .napp-error`).count();
	if (broken) errors.push(await page.locator('.napp-error').first().innerText());
	if (out) await page.screenshot({ path: `${out}/${id}.png` });
	console.log(`${errors.length ? 'FAIL' : 'ok  '} ${id}${errors.length ? `: ${errors.join(' | ').slice(0, 300)}` : ''}`);
	failed += errors.length ? 1 : 0;
	await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);

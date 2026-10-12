// Smoke-drives /dissolve in headless Chromium: logs console errors and saves a screenshot.
import { chromium } from 'playwright';

const out = process.argv[2] || 'dissolve.png';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log(m.type(), m.text()));
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:3000/dissolve?q=lite', { waitUntil: 'load' });
await page.waitForFunction(() => window.__dissolve?.engine?.shapes?.A && window.__dissolve.engine.shapes.B, null, { timeout: 90000 }).catch((e) => console.log('timeout', e.message));
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
await page.click('#dsMorph');
await page.waitForTimeout(5000);
await page.screenshot({ path: out.replace('.png', '-b.png') });
await browser.close();

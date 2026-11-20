#!/usr/bin/env node
// Screenshots /grok at desktop and phone widths and reports console errors.
//
//   node scripts/grok-page-shots.mjs --base http://localhost:3281 --out <dir> --tag before
//
// Used to compare the page before and after a layout change and to prove it
// loads without console errors at 1440 and 390 wide.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'http://localhost:3281');
const out = path.resolve(arg('out', '.'));
const tag = arg('tag', 'shot');
const widths = (arg('widths', '1440,390')).split(',').map(Number);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
let failed = false;
for (const width of widths) {
	const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
	const errors = [];
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto(`${base}/grok`, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
	await page.waitForTimeout(2500);
	const file = path.join(out, `grok-${tag}-${width}.png`);
	await page.screenshot({ path: file, fullPage: true });
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	console.log(JSON.stringify({ width, file, horizontalOverflowPx: overflow, consoleErrors: errors }));
	if (errors.length || overflow > 0) failed = true;
	await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);

// Screenshot /nvidia (Live right now section) and /nvidia/benchmarks at desktop
// and phone widths, in light and dark color schemes, and fail on any console
// error or failed /api/nvidia/stats request.
//
//   node scripts/nvidia-live-shots.mjs [baseUrl] [outDir]
//
// Defaults: http://localhost:3251, <os tmpdir>/nvidia-live-shots (evidence, not
// committed).

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.argv[2] || 'http://localhost:3251';
const outDir = resolve(process.argv[3] || join(tmpdir(), 'nvidia-live-shots'));
await mkdir(outDir, { recursive: true });

const pages = [
	{ name: 'nvidia', path: '/nvidia', target: '#live' },
	{ name: 'benchmarks', path: '/nvidia/benchmarks', target: 'main' },
];
const widths = [1280, 400];
const schemes = ['light', 'dark'];

const browser = await chromium.launch();
const problems = [];
const shots = [];

for (const p of pages) {
	for (const width of widths) {
		for (const colorScheme of schemes) {
			const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
			// The site theme switcher (public/theme-switcher.js) follows the saved
			// 'twx_theme' choice and defaults to the dark brand theme, so light is
			// exercised the way a visitor picks it, not only by OS preference.
			await ctx.addInitScript((mode) => { try { localStorage.setItem('twx_theme', mode); } catch {} }, colorScheme);
			const page = await ctx.newPage();
			const tag = `${p.name}-${width}-${colorScheme}`;
			page.on('console', (m) => {
				if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`);
			});
			page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
			page.on('response', (r) => {
				if (r.status() >= 400) problems.push(`${tag} HTTP ${r.status()} ${new URL(r.url()).pathname}`);
			});
			await page.goto(base + p.path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
			await page.waitForSelector('[data-nvl-root][data-loaded="true"], [data-nvl="error"]:not([hidden])', { timeout: 60_000 });
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			if (overflow > 1) problems.push(`${tag} page scrolls horizontally by ${overflow}px`);
			const file = resolve(outDir, `${tag}.png`);
			const target = page.locator(p.target).first();
			await target.screenshot({ path: file, animations: 'disabled' });
			shots.push(file);
			await ctx.close();
		}
	}
}

await browser.close();
for (const s of shots) console.log('shot', s);
if (problems.length) {
	for (const pr of problems) console.error('problem', pr);
	process.exit(1);
}
console.log(`ok: ${shots.length} screenshots, no console errors`);

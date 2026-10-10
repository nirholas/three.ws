#!/usr/bin/env node
/**
 * Captures the real product screens the motion studio is allowed to animate.
 * Every asset is a screenshot of the live production page; nothing is drawn.
 *
 *   node scripts/capture-motion-studio-assets.mjs [--origin=https://three.ws]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'marketing/motion-studio/assets/screens');
const arg = process.argv.find((a) => a.startsWith('--origin='));
const ORIGIN = (arg ? arg.slice(9) : 'https://three.ws').replace(/\/$/, '');

const SHOTS = [
	{ id: 'home', path: '/', settle: 6000 },
	{ id: 'forge', path: '/forge', settle: 6000 },
	{ id: 'characters', path: '/characters', settle: 7000 },
	{ id: 'marketplace', path: '/marketplace', settle: 6000 },
	{ id: 'atlas', path: '/atlas', settle: 8000 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
	args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const manifest = { capturedAt: new Date().toISOString(), origin: ORIGIN, viewport: '1920x1080', shots: [] };
for (const shot of SHOTS) {
	const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
	try {
		const res = await page.goto(ORIGIN + shot.path, { waitUntil: 'domcontentloaded', timeout: 45000 });
		await page.waitForTimeout(shot.settle);
		const file = path.join(OUT, `${shot.id}.png`);
		await page.screenshot({ path: file });
		manifest.shots.push({ id: shot.id, url: ORIGIN + shot.path, status: res?.status(), title: await page.title(), file: path.relative(ROOT, file), pageErrors: errors });
		console.log('ok', shot.id, res?.status(), await page.title());
	} catch (e) {
		manifest.shots.push({ id: shot.id, url: ORIGIN + shot.path, error: String(e).slice(0, 200) });
		console.log('FAIL', shot.id, String(e).slice(0, 120));
	}
	await ctx.close();
}
await browser.close();
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

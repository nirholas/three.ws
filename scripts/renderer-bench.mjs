#!/usr/bin/env node
// Renderer parity + perf harness for the opt-in WebGPU path (src/renderer-factory.js).
//
// Loads the Restyle Studio (`/restyle?bench`) with the same model under three
// conditions and reports, for each: the backend that actually rendered, console
// errors, an offscreen frame of the live scene, and render cost per frame.
//
//   default         no opt-in                              -> classic WebGL2
//   webgpu          ?renderer=webgpu, GPU present          -> WebGPURenderer
//   webgpu-denied   ?renderer=webgpu, navigator.gpu removed -> must fall back to WebGL2
//
// Parity and timing are measured offscreen (render target + readback) because
// headless software WebGPU cannot present to a canvas. Numbers from a software
// adapter compare the two code paths, not GPU hardware; run the same command on
// a machine with a real GPU for hardware numbers.
//
// Usage: node scripts/renderer-bench.mjs [--base http://localhost:3000] [--frames 60]
//        [--json out.json] [--shots dir] [--headed]
// Needs a dev/preview server running and Playwright's chromium installed.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : dflt;
};
const base = opt('base', 'http://localhost:3000');
const frames = Number(opt('frames', '60'));
const jsonOut = opt('json', '');
const shotsDir = opt('shots', '');
const W = 384;
const H = 512;

const GPU_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan,WebGPU',
	'--use-angle=swiftshader',
	'--use-webgpu-adapter=swiftshader',
	'--ignore-gpu-blocklist',
];

const CASES = [
	{ name: 'default', query: '', denyGpu: false },
	{ name: 'webgpu', query: '&renderer=webgpu', denyGpu: false },
	{ name: 'webgpu-denied', query: '&renderer=webgpu', denyGpu: true },
];

async function run(browser, c) {
	const ctx = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
	const page = await ctx.newPage();
	if (c.denyGpu) {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'gpu', { value: undefined });
		});
	}
	const errors = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
	});
	await page.goto(`${base}/restyle?bench${c.query}`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => window.__restyleBench, null, { timeout: 90000 });
	await page.waitForFunction(
		() => document.getElementById('status').hidden && document.getElementById('error').hidden,
		null,
		{ timeout: 90000 },
	);
	await page.waitForTimeout(1500);
	const backend = await page.$eval('#canvas-wrap canvas', (cv) => cv.dataset.renderer);
	const badge = await page.$eval('#renderer-badge', (n) => n.textContent);
	const pixels = await page.evaluate(([w, h]) => window.__restyleBench.capture(w, h), [W, H]);
	await page.evaluate(() => window.__restyleBench.setRim(1.5));
	const rimPixels = await page.evaluate(([w, h]) => window.__restyleBench.capture(w, h), [W, H]);
	await page.evaluate(() => window.__restyleBench.setRim(0));
	const renderMs = await page.evaluate(([w, h, n]) => window.__restyleBench.renderMs(w, h, n), [W, H, frames]);
	await ctx.close();
	return { case: c.name, backend, badge, errors, renderMs, pixels: Uint8Array.from(pixels), rimPixels: Uint8Array.from(rimPixels) };
}

function toPng(px) {
	const png = new PNG({ width: W, height: H });
	png.data = Buffer.from(px);
	return PNG.sync.write(png);
}

function compare(a, b) {
	let sum = 0;
	let covered = 0;
	let both = 0;
	for (let i = 0; i < a.length; i += 4) {
		const ca = a[i + 3] > 0;
		const cb = b[i + 3] > 0;
		if (ca) covered++;
		if (ca && cb) both++;
		sum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
	}
	return { meanAbsDiff: sum / (a.length / 4), silhouetteOverlap: covered ? both / covered : 0 };
}

const browser = await chromium.launch({ args: GPU_ARGS, headless: !args.includes('--headed') });
const results = [];
for (const c of CASES) results.push(await run(browser, c));
await browser.close();

const ref = results[0];
const rows = results.map((r) => {
	const cmp = r === ref ? null : compare(ref.pixels, r.pixels);
	return {
		case: r.case,
		backend: r.backend,
		badge: r.badge,
		renderMsPerFrame: Number(r.renderMs.toFixed(2)),
		errors: r.errors,
		rimVsDefault: r === ref ? null : Number(compare(ref.rimPixels, r.rimPixels).meanAbsDiff.toFixed(2)),
		rimEffectOnDefault: Number(compare(r.pixels, r.rimPixels).meanAbsDiff.toFixed(2)),
		vsDefault: cmp && {
			meanAbsDiff0to255: Number(cmp.meanAbsDiff.toFixed(2)),
			silhouetteOverlap: Number(cmp.silhouetteOverlap.toFixed(4)),
		},
	};
});
for (const r of rows) {
	console.log(
		`${r.case.padEnd(14)} backend=${r.backend} badge=${r.badge} render=${r.renderMsPerFrame}ms/frame` +
			(r.vsDefault ? ` diff=${r.vsDefault.meanAbsDiff0to255}/255 silhouette=${r.vsDefault.silhouetteOverlap}` : '') +
			` rimEffect=${r.rimEffectOnDefault}/255 rimDiffVsDefault=${r.rimVsDefault ?? 0}/255 errors=${r.errors.length}`,
	);
	for (const e of r.errors) console.log(`    ${e}`);
}
if (shotsDir) {
	mkdirSync(shotsDir, { recursive: true });
	for (const r of results) {
		writeFileSync(`${shotsDir}/${r.case}.png`, toPng(r.pixels));
		writeFileSync(`${shotsDir}/${r.case}-rim.png`, toPng(r.rimPixels));
	}
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ frames, size: [W, H], rows }, null, 2));

const failed =
	results.some((r) => r.errors.length > 0) ||
	results[0].backend !== 'webgl' ||
	results[2].backend !== 'webgl';
process.exit(failed ? 1 : 0);

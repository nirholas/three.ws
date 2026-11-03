#!/usr/bin/env node
// Parity + perf harness for the viewer's opt-in WebGPU path (Viewer.create,
// src/viewer/cinematic-tsl.js). Companion to scripts/renderer-bench.mjs, which
// covers the Restyle Studio.
//
// Loads the main viewer (/app) with the same model under three conditions and
// the <agent-3d> element with its renderer attribute set both ways:
//
//   default         no opt-in                               -> classic WebGL2
//   webgpu          ?renderer=webgpu, GPU present           -> WebGPURenderer + TSL chain
//   webgpu-denied   ?renderer=webgpu, navigator.gpu removed -> must fall back to WebGL2
//   agent-3d        <agent-3d renderer="webgpu">             -> element on WebGPU
//   agent-3d-pinned <agent-3d renderer="webgl">, ?renderer=webgpu on the page
//                                                            -> attribute wins, WebGL2
//
// For each: the backend that rendered, console errors, an offscreen frame of
// the scene pass (parity vs default), ms per scene pass and ms per full
// cinematic frame. Headless software adapters measure the code paths, not GPU
// hardware; run on a machine with a real GPU for hardware numbers.
//
// Usage: node scripts/viewer-renderer-bench.mjs [--base http://localhost:3000]
//        [--model /avatars/cz.glb] [--frames 60] [--json out.json] [--shots dir] [--headed]
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
const model = opt('model', '/avatars/cz.glb');
const frames = Number(opt('frames', '60'));
const jsonOut = opt('json', '');
const shotsDir = opt('shots', '');
const W = 384;
const H = 512;
const LOAD_TIMEOUT = Number(opt('timeout', '240000'));

const GPU_ARGS = [
	'--enable-unsafe-webgpu',
	'--enable-features=Vulkan,WebGPU',
	'--use-angle=swiftshader',
	'--use-webgpu-adapter=swiftshader',
	'--ignore-gpu-blocklist',
];

const CASES = [
	{ name: 'default', path: `/app?bench#model=${model}`, denyGpu: false, expect: 'webgl' },
	{ name: 'webgpu', path: `/app?bench&renderer=webgpu#model=${model}`, denyGpu: false, expect: 'webgpu' },
	{ name: 'webgpu-denied', path: `/app?bench&renderer=webgpu#model=${model}`, denyGpu: true, expect: 'webgl' },
	{ name: 'agent-3d', path: '/agent-3d-renderer-harness.html?bench&attr=webgpu', denyGpu: false, expect: 'webgpu', element: true },
	{ name: 'agent-3d-pinned', path: '/agent-3d-renderer-harness.html?bench&attr=webgl&renderer=webgpu', denyGpu: false, expect: 'webgl', element: true },
];

// Noise the page emits on every load regardless of renderer (dev-server dep
// re-optimisation, third-party widgets offline in a sandbox) is not a renderer
// error; everything else counts.
const IGNORED = [/Outdated Optimize Dep/, /Failed to load resource: net::ERR_/];

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
		if (m.type() !== 'error' || IGNORED.some((re) => re.test(m.text()))) return;
		const where = m.location()?.url;
		errors.push(`console.error: ${m.text()}${where ? ` (${where})` : ''}`);
	});
	await page.goto(`${base}${c.path}`, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT });
	await page.waitForFunction(() => window.__viewerBench?.loaded, null, { timeout: LOAD_TIMEOUT });
	await page.waitForTimeout(3000); // camera fly-in and first-pose settle
	await page.evaluate(() => window.__viewerBench.freeze());
	const backend = await page.evaluate(() => window.__viewerBench.backend);
	const canvasBackend = await page.evaluate(() => {
		const cv = [...document.querySelectorAll('canvas[data-renderer]')];
		const host = document.querySelector('agent-3d');
		const inShadow = host?.shadowRoot ? [...host.shadowRoot.querySelectorAll('canvas[data-renderer]')] : [];
		return [...cv, ...inShadow].map((n) => n.dataset.renderer).join(',');
	});
	const pixels = await page.evaluate(([w, h]) => window.__viewerBench.capture(w, h), [W, H]);
	const sceneMs = await page.evaluate(([w, h, n]) => window.__viewerBench.renderMs(w, h, n), [W, H, frames]);
	const postMs = await page.evaluate((n) => window.__viewerBench.postMs(n), frames);
	await ctx.close();
	return { ...c, backend, canvasBackend, errors, sceneMs, postMs, pixels: Uint8Array.from(pixels) };
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
for (const c of CASES) {
	try {
		results.push(await run(browser, c).catch((err) => {
			// A dev server that discovers a new dependency mid-load (three/webgpu
			// the first time a page opts in) reloads the page once; rerun.
			if (!/Execution context was destroyed|Outdated Optimize Dep/.test(err.message)) throw err;
			return run(browser, c);
		}));
	} catch (err) {
		results.push({ ...c, backend: null, errors: [`harness: ${err.message.split('\n')[0]}`], sceneMs: NaN, postMs: NaN, pixels: null });
	}
}
await browser.close();

const ref = results[0];
const rows = results.map((r) => {
	const cmp = r !== ref && !r.element && r.pixels && ref.pixels ? compare(ref.pixels, r.pixels) : null;
	return {
		case: r.name,
		expected: r.expect,
		backend: r.backend,
		canvas: r.canvasBackend,
		sceneMsPerFrame: Number((r.sceneMs ?? NaN).toFixed(2)),
		postMsPerFrame: Number((r.postMs ?? NaN).toFixed(2)),
		errors: r.errors,
		vsDefault: cmp && {
			meanAbsDiff0to255: Number(cmp.meanAbsDiff.toFixed(2)),
			silhouetteOverlap: Number(cmp.silhouetteOverlap.toFixed(4)),
		},
	};
});
for (const r of rows) {
	console.log(
		`${r.case.padEnd(14)} backend=${r.backend} (expected ${r.expected}) canvas=${r.canvas} ` +
			`scene=${r.sceneMsPerFrame}ms post=${r.postMsPerFrame}ms` +
			(r.vsDefault ? ` diff=${r.vsDefault.meanAbsDiff0to255}/255 silhouette=${r.vsDefault.silhouetteOverlap}` : '') +
			` errors=${r.errors.length}`,
	);
	for (const e of r.errors) console.log(`    ${e}`);
}
if (shotsDir) {
	mkdirSync(shotsDir, { recursive: true });
	for (const r of results) if (r.pixels) writeFileSync(`${shotsDir}/viewer-${r.name}.png`, toPng(r.pixels));
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ model, frames, size: [W, H], rows }, null, 2));

const failed = rows.some((r) => r.errors.length > 0 || r.backend !== r.expected);
process.exit(failed ? 1 : 0);

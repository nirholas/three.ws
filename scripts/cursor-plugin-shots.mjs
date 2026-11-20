#!/usr/bin/env node
// Captures the two Cursor plugin listing screenshots from a real generation:
// the three.ws viewer showing the generated GLB, and the run receipt (the
// result card the forge_free tool result links to).
//
//   node scripts/cursor-plugin-shots.mjs --session <session-check.json>
//   node scripts/cursor-plugin-shots.mjs \
//     --glb https://three.ws/cdn/forge/anon/<id>.glb \
//     --run https://three.ws/runs/rr_<id> \
//     --base http://localhost:3271 \
//     --out integrations/cursor/three-ws/assets
//
// The GLB and receipt come from a real forge_free call: --session reads them
// from the JSON that `scripts/cursor-plugin-session-check.mjs --json <file>`
// writes (facts.glbUrl and facts.receiptUrl). --base is the origin the
// pages are loaded from; the dev server proxies /api to production, so a
// local origin renders the same production data. Site chrome that floats over
// content (the search hint, the language button, the corner companion) is
// hidden so the shot shows the result itself. Exits 1 on any console error.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : fallback;
};

const session = arg('session') ? JSON.parse(fs.readFileSync(arg('session'), 'utf8')).facts || {} : {};
const glb = arg('glb', session.glbUrl);
const run = arg('run', session.receiptUrl);
const base = arg('base', 'https://three.ws').replace(/\/$/, '');
const out = path.resolve(arg('out', 'integrations/cursor/three-ws/assets'));
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '800'));

if (!glb || !run) {
	console.error('usage: cursor-plugin-shots.mjs (--session <json> | --glb <glb url> --run <run receipt url>) [--base <origin>] [--out <dir>]');
	process.exit(2);
}

const runPath = new URL(run).pathname;
if (!/^\/runs\/[\w-]+$/.test(runPath)) {
	console.error(`--run must be a run receipt URL like https://three.ws/runs/rr_..., got ${run}`);
	process.exit(2);
}

const FLOATING_CHROME = '.tws-atlas-hint, .twx-i18n-fab, #tws-corner-stack { display: none !important; }';

const shots = [
	{
		file: 'screenshot-viewer.png',
		url: `${base}/viewer?src=${encodeURIComponent(glb)}`,
		ready: async (page) => {
			await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
			await page.waitForTimeout(8000);
		},
	},
	{
		file: 'screenshot-result-card.png',
		url: `${base}${runPath}`,
		ready: async (page) => {
			await page.getByText('Open the model').first().waitFor({ timeout: 60_000 });
			await page.waitForTimeout(1000);
		},
	},
];

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
for (const shot of shots) {
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
	const errors = [];
	page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
	page.on('pageerror', (e) => errors.push(String(e)));
	const res = await page.goto(shot.url, { waitUntil: 'load', timeout: 90_000 });
	await page.addStyleTag({ content: FLOATING_CHROME });
	await shot.ready(page);
	const file = path.join(out, shot.file);
	await page.screenshot({ path: file, timeout: 120_000 });
	console.log(JSON.stringify({ file, url: shot.url, status: res?.status(), consoleErrors: errors }));
	if (!res?.ok() || errors.length) failed = true;
	await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);

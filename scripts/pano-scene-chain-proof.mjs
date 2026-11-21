#!/usr/bin/env node
// Real-browser proof for /pano-scene against real workers (work order 347).
//
// Drives Chromium against a Vite dev server whose /api proxies to
// scripts/capture-upload-live-server.mjs (the real server/index.mjs, real R2,
// throwaway Postgres) started with GCP_PANODEPTH_URL (and GCP_PANO2SPLAT_URL for
// .insp) pointing at real GPU workers. Nothing is stood in: the photo is uploaded
// to the bucket, the depth worker runs, and the page renders the returned shell.
//
//   node scripts/pano-scene-chain-proof.mjs --base http://localhost:3347 --key-file <key> \
//     --file <360 photo .jpg|.png|.insp> --out <screenshot dir> [--width 1280] [--timeout-s 900]

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const BASE = arg('base', 'http://localhost:3347');
const KEY = readFileSync(arg('key-file'), 'utf8').trim();
const FILE = arg('file');
const OUT = arg('out', '.');
const WIDTH = Number(arg('width', 1280));
const TIMEOUT_MS = Number(arg('timeout-s', 900)) * 1000;
if (!FILE) {
	process.stderr.write('usage: pano-scene-chain-proof.mjs --base <url> --key-file <f> --file <photo> --out <dir>\n');
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const problems = [];
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
await ctx.route(/\/api\//, (route) => {
	if (new URL(route.request().url()).origin !== new URL(BASE).origin) return route.continue();
	return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${KEY}` } });
});
const page = await ctx.newPage();
page.on('console', (m) => {
	if (['error', 'warning'].includes(m.type()) && !/GL Driver Message|GPU stall due to ReadPixels/.test(m.text())) problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
	if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url().split('?')[0]}`);
});

const t0 = Date.now();
await page.goto(`${BASE}/pano-scene`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#ps-idle:not([hidden])');
await page.screenshot({ path: join(OUT, `pano-scene-idle-${WIDTH}.png`) });
log(`file ${basename(FILE)} ${statSync(FILE).size} bytes`);
await page.setInputFiles('#ps-file', FILE);

const stages = new Set();
let last = '';
const deadline = Date.now() + TIMEOUT_MS;
let outcome = 'timeout';
while (Date.now() < deadline) {
	const s = await page.evaluate(() => ({
		loading: !document.getElementById('ps-loading').hidden,
		title: document.getElementById('ps-loading-title').textContent.trim(),
		sub: document.getElementById('ps-loading-sub').textContent.trim(),
		bar: document.getElementById('ps-bar').style.width,
		error: !document.getElementById('ps-error').hidden && document.getElementById('ps-error-sub').textContent.trim(),
		done: !document.getElementById('ps-done').hidden,
		hud: !document.getElementById('ps-hud').hidden && document.getElementById('ps-hud-label').textContent.trim(),
	}));
	const line = `${s.title} | ${s.sub} | ${s.bar}`;
	if (s.loading && line !== last) {
		last = line;
		stages.add(s.title);
		log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`);
	}
	if (s.error) {
		outcome = `error: ${s.error}`;
		break;
	}
	if (s.done && s.hud) {
		outcome = `done: ${s.hud}`;
		break;
	}
	await page.waitForTimeout(1500);
}
const wall = (Date.now() - t0) / 1000;
log(`outcome ${outcome} after ${wall.toFixed(1)}s; stages seen: ${[...stages].join(' > ')}`);
await page.screenshot({ path: join(OUT, `pano-scene-result-${WIDTH}.png`) });

if (outcome.startsWith('done')) {
	const links = await page.evaluate(() => ({
		glb: document.getElementById('ps-dl-glb').href,
		ply: document.getElementById('ps-dl-ply').href,
		open: document.getElementById('ps-open').href,
	}));
	for (const [k, v] of Object.entries(links)) log(`${k} ${v.split('?')[0]}`);
	for (const k of ['glb', 'ply']) {
		const r = await fetch(links[k], { method: 'HEAD' });
		log(`${k} HEAD ${r.status} ${r.headers.get('content-length')} bytes`);
		if (!r.ok) problems.push(`${k} link answered ${r.status}`);
	}
	await page.click('#ps-step');
	await page.keyboard.down('w');
	await page.waitForTimeout(800);
	await page.keyboard.up('w');
	await page.screenshot({ path: join(OUT, `pano-scene-stepped-${WIDTH}.png`) });
	await page.click('#ps-recenter');
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
	if (overflow) problems.push('horizontal overflow');
}

log(problems.length ? `problems (${problems.length}):\n  ${problems.join('\n  ')}` : 'no console errors, warnings or failed requests');
await browser.close();
process.exit(outcome.startsWith('done') && !problems.length ? 0 : 1);

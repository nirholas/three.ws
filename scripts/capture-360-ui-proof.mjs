#!/usr/bin/env node
// Real-browser proof for the /capture 360 mode (work order 340).
//
// Drives Chromium against a Vite dev server that proxies /api to
// scripts/capture-upload-live-server.mjs (the real server/index.mjs, real R2 bucket,
// throwaway Postgres) with the stand-in pano2splat worker behind it
// (scripts/capture-360-live-worker.mjs). The browser makes real multipart PUTs to
// the bucket; only the worker is a stand-in.
//
//   node scripts/capture-360-ui-proof.mjs --base http://localhost:3340 --key-file <c3key> \
//     --dir <folder with metro.mp4 hof.mp4 *_00.insv *_10.insv> --out <screenshot dir> [--phase preview|raw|upload|all]

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const BASE = arg('base', 'http://localhost:3340');
const KEY = readFileSync(arg('key-file'), 'utf8').trim();
const DIR = arg('dir');
const OUT = arg('out', '.');
const PHASE = arg('phase', 'all');
const WIDTH = Number(arg('width', 1280));
mkdirSync(OUT, { recursive: true });

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
await ctx.route(/\/api\//, (route) => {
	const u = new URL(route.request().url());
	if (u.origin !== new URL(BASE).origin) return route.continue();
	return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${KEY}` } });
});

async function open() {
	const page = await ctx.newPage();
	page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
	page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	await page.goto(`${BASE}/capture`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#c3-tabs');
	return page;
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}-${WIDTH}.png`) });

// ── preview: 2:1 mp4 auto-selects 360, sphere player, trim ─────────────────
if (PHASE === 'preview' || PHASE === 'all') {
	const page = await open();
	log('tab default selected:', await page.getAttribute('#c3-tab-standard', 'aria-selected'));
	const t0 = Date.now();
	// Dropped on the Standard tab: the router must notice the 2:1 video and switch modes.
	await page.setInputFiles('#pc-video-file', join(DIR, 'metro.mp4'));
	await page.waitForSelector('#c3-review:not([hidden])', { timeout: 60000 });
	log('360 tab selected after file:', await page.getAttribute('#c3-tab-360', 'aria-selected'));
	await page.waitForSelector('#c3-preview canvas', { timeout: 60000 });
	log('sphere preview canvas up in ms:', Date.now() - t0, '| note:', (await page.textContent('#c3-preview-note')).trim());
	await page.waitForSelector('#c3-trim-wrap:not([hidden])');
	await page.waitForTimeout(2500);
	log('trim thumbnails:', await page.locator('#c3-trim img, #c3-trim canvas').count());
	const handle = page.locator('#c3-trim [role=slider]').first();
	log('trim handles:', await page.locator('#c3-trim [role=slider]').count());
	await handle.focus();
	for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
	log('start handle after 5 nudges:', await handle.getAttribute('aria-valuetext'));
	log('summary:', (await page.textContent('#c3-summary')).replace(/\s+/g, ' ').trim());
	log('estimate:', (await page.textContent('#c3-estimate')).trim());
	const before = await page.locator('#c3-preview canvas').screenshot();
	const box = await page.locator('#c3-preview canvas').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 20, { steps: 6 });
	await page.mouse.up();
	await page.waitForTimeout(500);
	const after = await page.locator('#c3-preview canvas').screenshot();
	log('drag changed the view:', !before.equals(after));
	await shot(page, 'preview-metro');
	await page.close();
}

// ── raw: .insv pair, fallback copy, pair offer ─────────────────────────────
if (PHASE === 'raw' || PHASE === 'all') {
	const page = await open();
	await page.click('#c3-tab-360');
	await page.setInputFiles('#c3-file', join(DIR, 'zenodo-ritmo-x3-format-exemplar_00.insv'));
	await page.waitForSelector('#c3-review:not([hidden])', { timeout: 60000 });
	log('raw: 360 tab selected:', await page.getAttribute('#c3-tab-360', 'aria-selected'));
	await page.waitForFunction(() => document.querySelector('#c3-preview-note')?.textContent.trim().length > 0, null, { timeout: 30000 });
	log('raw preview:', (await page.textContent('#c3-preview')).trim(), '|', (await page.textContent('#c3-preview-note')).trim());
	log('pair offer visible:', await page.isVisible('#c3-pair'), '|', (await page.textContent('#c3-pair-msg')).trim());
	log('start enabled before pair:', await page.isEnabled('#c3-start'));
	await shot(page, 'raw-pair-offer');
	await page.setInputFiles('#c3-file', [join(DIR, 'zenodo-ritmo-x3-format-exemplar_00.insv'), join(DIR, 'zenodo-ritmo-x3-format-exemplar_10.insv')]);
	await page.waitForTimeout(1500);
	log('pair offer after both files:', await page.isVisible('#c3-pair'));
	log('summary:', (await page.textContent('#c3-summary')).replace(/\s+/g, ' ').trim());
	await shot(page, 'raw-pair-complete');
	await page.close();
}

// ── upload: >=1 GB, reload mid-upload, resume, job, result ─────────────────
if (PHASE === 'upload' || PHASE === 'all') {
	const file = join(DIR, 'hof.mp4');
	const size = statSync(file).size;
	log('upload file bytes:', size);
	let page = await open();
	await page.click('#c3-tab-360');
	await page.setInputFiles('#c3-file', file);
	await page.waitForSelector('#c3-review:not([hidden])', { timeout: 120000 });
	log('hof review note:', (await page.textContent('#c3-preview-note')).trim());
	await page.waitForFunction(() => !document.querySelector('#c3-start').disabled, null, { timeout: 30000 });
	const tStart = Date.now();
	await page.click('#c3-start');
	await page.waitForSelector('#c3-meter:not([hidden])', { timeout: 60000 });
	await page.waitForFunction(() => /Uploading/.test(document.querySelector('#c3-work-title')?.textContent || '') && parseFloat(document.querySelector('#c3-bar-fill').style.width) > 35, null, { timeout: 600000, polling: 50 });
	log('before reload:', (await page.textContent('#c3-meter-text')).trim());
	await shot(page, 'upload-progress');
	const tReload = Date.now();
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#c3-tabs');
	await page.waitForSelector('#c3-resume:not([hidden])', { timeout: 15000 });
	log('resume banner:', (await page.textContent('#c3-resume-msg')).trim());
	await shot(page, 'upload-resume-banner');
	await page.setInputFiles('#c3-file', file);
	await page.waitForSelector('#c3-review:not([hidden])', { timeout: 120000 });
	await page.waitForFunction(() => /Resume/.test(document.querySelector('#c3-start')?.textContent || ''), null, { timeout: 30000 });
	log('start button after reload:', (await page.textContent('#c3-start')).trim());
	await page.click('#c3-start');
	await page.waitForSelector('#c3-meter:not([hidden])', { timeout: 60000 });
	await page.waitForFunction(() => !/Uploading/.test(document.querySelector('#c3-work-title')?.textContent || ''), null, { timeout: 900000, polling: 200 });
	log('upload finished, total ms since first click:', Date.now() - tStart, '| since reload:', Date.now() - tReload);
	await page.waitForSelector('#c3-result:not([hidden])', { timeout: 300000 });
	log('result stats:', (await page.textContent('#c3-result-stats')).trim());
	await page.waitForSelector('#c3-result-stage canvas', { timeout: 120000 });
	log('splat canvas rendered; actions:', (await page.locator('#c3-result-actions a, #c3-result-actions button').allTextContents()).map((s) => s.trim()).join(' | '));
	await page.waitForTimeout(3000);
	await shot(page, 'result');
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#c3-captures .c3-cap, #c3-captures [data-job]', { timeout: 20000 }).catch(() => {});
	log('captures list rows:', await page.locator('#c3-captures > *').count());
	await shot(page, 'captures');
	await page.close();
}

// ── result: reopen the newest job from its URL (what a returning user does) ──
if (PHASE === 'result') {
	const res = await fetch(`${BASE}/api/pano-capture?mine=1`, { headers: { authorization: `Bearer ${KEY}` } });
	const { captures } = await res.json();
	const job = captures[0];
	log('newest job:', job.job_id, job.status, job.stage);
	const page = await ctx.newPage();
	page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
	page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	await page.goto(`${BASE}/capture?mode=360&job=${job.job_id}`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('#c3-result:not([hidden])', { timeout: 120000 });
	log('result stats:', (await page.textContent('#c3-result-stats')).trim());
	await page.waitForSelector('#c3-result-stage canvas', { timeout: 120000 });
	await page.waitForTimeout(4000);
	log('actions:', (await page.locator('#c3-result-actions a, #c3-result-actions button').allTextContents()).map((t) => t.trim()).join(' | '));
	log('preview video src set:', await page.evaluate(() => !!document.querySelector('#c3-result-video')?.src), 'visible:', await page.isVisible('#c3-result-video'));
	await shot(page, 'result');
	log('captures rows:', await page.locator('#c3-captures > *').count());
	await page.close();
}

await browser.close();
log('console errors/warnings:', errors.length);
for (const e of errors) log('  ', e);
process.exit(errors.length ? 1 : 0);

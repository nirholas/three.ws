#!/usr/bin/env node
/**
 * Browser verification for the Forge on-device photo check.
 *
 * Drives the real /forge page in Chromium against a running dev server and
 * proves, from the network log, that no photo bytes leave the page before the
 * visitor confirms the review. Also exercises the warning, retake, cancel and
 * unsupported-device fallback paths and fails on any console error.
 *
 *   node scripts/forge-photo-prep-verify.mjs [--base=http://localhost:3109] [--out=<dir for screenshots and network log>]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const base = flags.base || 'http://localhost:3109';
const out = resolve(flags.out || 'docs/forge-photo-prep/verify');
mkdirSync(out, { recursive: true });

const PHOTOS = resolve('docs/forge-photo-prep/photos');
const failures = [];
const storageCors = [];
const check = (ok, msg) => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
	if (!ok) failures.push(msg);
};

// Same-origin and third-party requests that could carry a photo: anything with
// a body, plus the upload endpoints by name.
const carriesPhoto = (r) => r.method !== 'GET' && r.method !== 'HEAD' && r.method !== 'OPTIONS';
const isUpload = (r) => /\/api\/forge-upload/.test(r.url) || (r.method === 'PUT' && !r.url.startsWith(base));

async function openForge(browser, { disableOffscreen = false } = {}) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	if (disableOffscreen) await context.addInitScript(() => delete globalThis.OffscreenCanvas);
	const page = await context.newPage();
	const log = [];
	const errors = [];
	page.on('request', (req) =>
		log.push({ t: Date.now(), method: req.method(), url: req.url(), bytes: req.postDataBuffer()?.length || 0, phase: page.__phase || 'before-confirm' }),
	);
	page.on('console', (m) => {
		if (m.type() !== 'error') return;
		// The presigned PUT after confirm goes to the storage bucket, whose CORS
		// allowlist covers :3000 and production only. Off those origins it fails
		// the same way with or without the photo check, so it is reported, not counted.
		if (/cloudflarestorage\.com.*blocked by CORS/.test(m.text()) || (m.text() === 'Failed to load resource: net::ERR_FAILED' && storageCors.length)) {
			storageCors.push(m.text().slice(0, 80));
			return;
		}
		errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));
	// A shared dev server restarts when anyone edits a config dependency, which
	// can drop the connection or a module mid-load; reload until the page is up.
	// Errors from a load that did not come up are discarded with it.
	for (let attempt = 1; ; attempt++) {
		try {
			await page.goto(`${base}/forge`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
			await page.click('#tab-image', { timeout: 60_000 });
			await page.waitForSelector('#views-grid .view-slot', { timeout: 60_000 });
			break;
		} catch (err) {
			if (attempt >= 10) throw err;
			console.log(`     dev server not ready (${err.message.split('\n')[0]}), retrying`);
			errors.length = 0;
			await new Promise((r) => setTimeout(r, 3000));
		}
	}
	return { context, page, log, errors };
}

const browser = await chromium.launch();
try {
	// 1. Clean photo: review shows, nothing uploads until "Use this photo".
	{
		const { context, page, log, errors } = await openForge(browser);
		const t0 = Date.now();
		await page.setInputFiles('#view-file-input', join(PHOTOS, 'backpack.jpg'));
		await page.waitForSelector('.view-slot[data-state="preparing"]', { timeout: 10_000 });
		await page.screenshot({ path: join(out, '1-preparing.png') });
		await page.waitForSelector('dialog.pp-dialog[open]', { timeout: 120_000 });
		await page.screenshot({ path: join(out, '2-review-clean.png') });
		const before = log.filter((r) => r.t >= t0);
		check(!before.some(isUpload), 'no /api/forge-upload or storage PUT before confirm');
		check(!before.some(carriesPhoto), `no request with a body before confirm (${before.length} requests, all GET)`);
		check(before.some((r) => r.url.includes('/models/photo-prep/u2netp')), 'model fetched from our own origin');
		const ok = await page.textContent('.pp-ok');
		check(Boolean(ok), `clean photo shows the all-clear line: "${ok}"`);
		page.__phase = 'after-confirm';
		await page.click('.pp-primary');
		await page.waitForFunction(() => {
			const s = document.querySelector('.view-slot[data-index="0"]')?.dataset.state;
			return s === 'uploaded' || s === 'error' || s === 'uploading';
		});
		await page.waitForTimeout(1500);
		const after = log.filter((r) => r.phase === 'after-confirm');
		const presign = after.find((r) => r.url.includes('/api/forge-upload'));
		check(Boolean(presign), 'upload starts only after confirm');
		const state = await page.getAttribute('.view-slot[data-index="0"]', 'data-state');
		console.log(`     slot after confirm: ${state}`);
		check(errors.length === 0, `no console errors (${errors.join(' | ') || 'none'})`);
		writeFileSync(
			join(out, 'network-clean.json'),
			JSON.stringify(log.filter((r) => r.t >= t0).map(({ t, ...r }) => ({ ms: t - t0, ...r })), null, '\t') + '\n',
		);
		await context.close();
	}

	// 2. Bad photo: warnings in plain words, Retake clears the slot without uploading.
	{
		const { context, page, log, errors } = await openForge(browser);
		const t0 = Date.now();
		await page.setInputFiles('#view-file-input', join(PHOTOS, 'defocused-scooter.jpg'));
		await page.waitForSelector('dialog.pp-dialog[open]', { timeout: 120_000 });
		const warnings = await page.$$eval('.pp-warnings li', (els) => els.map((e) => `${e.dataset.code}: ${e.textContent}`));
		check(warnings.length >= 2, `scooter warnings: ${warnings.join(' / ')}`);
		check((await page.textContent('.pp-primary')).trim() === 'Use anyway', 'primary action reads "Use anyway"');
		await page.click('.pp-seg-btn[data-show="cutout"]');
		await page.screenshot({ path: join(out, '3-review-warnings-cutout.png') });
		page.once('filechooser', () => {});
		await page.click('.pp-btn[value="retake"]');
		await page.waitForSelector('dialog.pp-dialog', { state: 'detached' });
		const state = await page.getAttribute('.view-slot[data-index="0"]', 'data-state');
		check(state === 'empty', `Retake empties the slot (${state})`);
		check(!log.filter((r) => r.t >= t0).some(carriesPhoto), 'Retake sent nothing');
		check(errors.length === 0, `no console errors (${errors.join(' | ') || 'none'})`);
		await context.close();
	}

	// 3. Send original toggle + Esc cancels.
	{
		const { context, page, log, errors } = await openForge(browser);
		const t0 = Date.now();
		await page.setInputFiles('#view-file-input', join(PHOTOS, 'teapot.jpg'));
		await page.waitForSelector('dialog.pp-dialog[open]', { timeout: 120_000 });
		await page.check('.pp-toggle input');
		check((await page.getAttribute('.pp-compare', 'data-send')) === 'original', 'toggle switches the highlighted image to the original');
		await page.screenshot({ path: join(out, '4-review-send-original.png') });
		await page.keyboard.press('Escape');
		await page.waitForSelector('dialog.pp-dialog', { state: 'detached' });
		check((await page.getAttribute('.view-slot[data-index="0"]', 'data-state')) === 'empty', 'Esc cancels and empties the slot');
		check(!log.filter((r) => r.t >= t0).some(carriesPhoto), 'cancel sent nothing');
		check(errors.length === 0, `no console errors (${errors.join(' | ') || 'none'})`);
		await context.close();
	}

	// 4. Device that cannot run the check: flow continues exactly as today, one-line note.
	{
		const { context, page, errors } = await openForge(browser, { disableOffscreen: true });
		await page.setInputFiles('#view-file-input', join(PHOTOS, 'sneaker.jpg'));
		await page.waitForFunction(() => document.querySelector('.photo-prep-note')?.textContent);
		const note = await page.textContent('.photo-prep-note');
		check(/uploads as before/.test(note), `fallback note: "${note}"`);
		check((await page.$('dialog.pp-dialog')) === null, 'no review dialog on the fallback path');
		await page.waitForFunction(() => {
			const s = document.querySelector('.view-slot[data-index="0"]')?.dataset.state;
			return s === 'uploading' || s === 'uploaded' || s === 'error';
		});
		await page.screenshot({ path: join(out, '5-fallback.png') });
		check(errors.length === 0, `no console errors (${errors.join(' | ') || 'none'})`);
		await context.close();
	}
} finally {
	await browser.close();
}

if (storageCors.length) console.log(`INFO ${storageCors.length} storage CORS error(s) after confirm: the bucket allowlists :3000 and production, not ${base}`);
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);

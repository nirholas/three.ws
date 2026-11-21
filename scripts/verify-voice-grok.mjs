#!/usr/bin/env node
// Drive /voice/grok in headless Chromium with a real spoken question as the
// microphone, and capture the page's states plus its measured latency.
//
//   node scripts/verify-voice-grok.mjs [--base http://127.0.0.1:3276] [--turns 3] [--out <dir>]
//
// Chromium has no microphone in headless mode, so the fake capture device plays
// tests/fixtures/voice/tallest-mountain-question.wav (made with the /api/tts/speak
// lane, transcribed back as "What is the tallest mountain in the world?" by
// /api/asr). Whatever engine the server offers is the one exercised: Grok voice
// when GROK_API_KEY is set and the session is signed in, the standard chain
// otherwise. Writes PNGs and a JSON report (turn latencies, console errors).

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:3276');
const TURNS = Number(arg('turns', 3));
const OUT = resolve(arg('out', resolve(ROOT, 'tmp/voice-grok-verify')));
const WAV = resolve(ROOT, 'tests/fixtures/voice/tallest-mountain-question.wav');
// The fixture is 3.86 s; holding a little longer captures the whole question once.
const HOLD_MS = 4000;
const AVATAR = arg('avatar', '');

mkdirSync(OUT, { recursive: true });
const report = { base: BASE, engine: null, turns: [], consoleErrors: [], failedRequests: [], shots: [] };

const browser = await chromium.launch({
	args: [
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader',
		'--use-fake-ui-for-media-stream',
		'--use-fake-device-for-media-stream',
		`--use-file-for-fake-audio-capture=${WAV}`,
		'--autoplay-policy=no-user-gesture-required',
	],
});

function watch(page, label) {
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') report.consoleErrors.push({ label, type: m.type(), text: m.text() });
	});
	page.on('pageerror', (e) => report.consoleErrors.push({ label, type: 'pageerror', text: String(e) }));
	page.on('response', (r) => {
		if (r.status() >= 400 && !r.url().includes('/api/voice/grok/session')) report.failedRequests.push({ label, status: r.status(), url: r.url() });
	});
}

async function shot(page, name) {
	const file = resolve(OUT, `${name}.png`);
	await page.screenshot({ path: file, fullPage: false, timeout: 180000 });
	report.shots.push(file);
}

const url = `${BASE}/voice/grok${AVATAR ? `?avatar=${AVATAR}` : ''}`;
// The page a step is driving, so a failure can say what that page showed.
let current = null;

async function diagnose(err) {
	report.failure = { message: String(err?.message || err).split('\n')[0] };
	if (!current || current.isClosed()) return;
	try {
		Object.assign(report.failure, await current.evaluate(() => ({
			engine: document.getElementById('vg-kicker')?.dataset.engine,
			state: document.getElementById('vg-state')?.dataset.state,
			banner: document.getElementById('vg-banner')?.innerText.trim(),
			transcript: [...document.querySelectorAll('#vg-transcript .vg-msg')].map((n) => `${n.dataset.role}: ${n.textContent}`),
			turns: window.__voiceGrokTurns || [],
		})));
		await shot(current, 'failure');
	} catch (e) {
		report.failure.diagnoseError = String(e?.message || e);
	}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
	// 1. Happy path: whichever engine the server offers, three real turns.
	const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
	await ctx.grantPermissions(['microphone'], { origin: BASE });
	const page = await ctx.newPage();
	current = page;
	watch(page, 'main');
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
	await page.waitForFunction(() => ['grok', 'chain', 'signin'].includes(document.getElementById('vg-kicker').dataset.engine), null, { timeout: 180000 });
	await page.waitForSelector('#vg-stage canvas', { timeout: 300000 });
	await page.waitForFunction(() => !document.getElementById('vg-connect').disabled, null, { timeout: 180000 });
	report.engine = await page.$eval('#vg-kicker', (n) => n.dataset.engine);
	await sleep(1500);
	await shot(page, '1-idle');

	await page.click('#vg-connect');
	await page.waitForFunction(() => !document.getElementById('vg-talk').disabled, null, { timeout: 180000 });

	const talk = await page.$('#vg-talk');
	const box = await talk.boundingBox();
	for (let i = 0; i < TURNS; i++) {
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await sleep(HOLD_MS / 2);
		if (i === 0) await shot(page, '2-listening');
		await sleep(HOLD_MS / 2);
		await page.mouse.up();
		await page.waitForFunction(() => document.getElementById('vg-state').dataset.state === 'speaking', null, { timeout: 180000 });
		await sleep(700);
		if (i === 0) await shot(page, '3-speaking');
		await page.waitForFunction(() => document.getElementById('vg-state').dataset.state === 'idle', null, { timeout: 300000 });
		await sleep(400);
	}
	report.turns = await page.evaluate(() => window.__voiceGrokTurns || []);
	report.transcript = await page.$$eval('#vg-transcript .vg-msg', (ns) => ns.map((n) => `${n.dataset.role}: ${n.textContent}`));
	await shot(page, '4-after-turns');
	await ctx.close();

	// 2. Error: the microphone is blocked for the site (a real permission
	// denial set through the DevTools protocol, not a stubbed API).
	const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
	const page2 = await ctx2.newPage();
	current = page2;
	watch(page2, 'mic-blocked');
	const cdp = await ctx2.newCDPSession(page2);
	await cdp.send('Browser.setPermission', { permission: { name: 'audioCapture' }, setting: 'denied', origin: BASE });
	await page2.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
	await page2.waitForFunction(() => !document.getElementById('vg-connect').disabled, null, { timeout: 300000 });
	await page2.click('#vg-connect');
	await page2.waitForFunction(() => document.getElementById('vg-banner').dataset.tone === 'error', null, { timeout: 15000 });
	report.micBlockedBanner = await page2.$eval('#vg-banner h2', (n) => n.textContent);
	await shot(page2, '5-error-mic-blocked');
	await ctx2.close();
} catch (err) {
	await diagnose(err);
} finally {
	await browser.close();
}

const med = (k) => {
	const v = report.turns.map((t) => t[k]).filter(Number.isFinite).sort((a, b) => a - b);
	if (!v.length) return null;
	const m = v.length >> 1;
	return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
report.median = { response_ms: med('response'), mouth_ms: med('mouth') };
// Errors the page logs are the page's problem; a blocked microphone logs nothing.
report.ok = !report.failure && report.turns.length >= TURNS && report.consoleErrors.filter((e) => e.type !== 'warning').length === 0;
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failure: report.failure, engine: report.engine, turns: report.turns, median: report.median, transcript: report.transcript, micBlockedBanner: report.micBlockedBanner, consoleErrors: report.consoleErrors, failedRequests: report.failedRequests, out: OUT }, null, 2));
process.exit(report.ok ? 0 : 1);

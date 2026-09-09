#!/usr/bin/env node
/**
 * Drive the satellite view in a real browser and capture every state it can be
 * in, as a picture and as the text the page was actually showing.
 *
 * It is a verification harness, not a test: it opens Chromium against a running
 * three.ws, a running satellite and a running Home Assistant, speaks into the
 * pipeline through Chromium's own microphone, and screenshots what happens. The
 * microphone audio is a real WAV; Chromium plays it into `getUserMedia` with
 * --use-file-for-fake-audio-capture, so the page's capture path, resampler and
 * WebSocket all run exactly as they do for a person.
 *
 *   node scripts/capture-states.mjs \
 *     --base http://127.0.0.1:3000 --satellite-id <uuid> --session <sid cookie> \
 *     --audio /tmp/say.wav --out /tmp/states
 *
 * Every file it writes is named for the state it shows, so a reviewer can line
 * the ten states up against the ten designs without reading this script.
 *
 * Three of the ten cannot be reached by talking to a healthy stack, so each one
 * is its own phase and the caller arranges the world before running it:
 *
 *   --phase main        the default: unpaired, pairing, idle, listening,
 *                       thinking, speaking, the answer, and the resting screen
 *   --phase wake        needs --audio to start with the pipeline's wake word;
 *                       captures the moment Home Assistant reports the wake
 *   --phase error       run with speech-to-text stopped, so the pipeline really
 *                       fails and the page has a real error to show
 *   --phase disconnect  stop the satellite process while this is waiting
 *
 * Splitting them is deliberate. A harness that broke its own stack to reach a
 * state would leave the next phase running against wreckage, and a screenshot
 * of a state nobody can explain how to reach is not evidence of anything.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};

const BASE = arg('base', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const SATELLITE_ID = arg('satellite-id', '');
const SESSION = arg('session', '');
const AUDIO = arg('audio', '');
const OUT = arg('out', './satellite-states');
const VIDEO = args.includes('--video');
const PHASE = arg('phase', 'main');
/** Seconds a phase waits for the world to change around it. */
const WAIT = Number(arg('wait', 25));

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.error('[capture]', ...a);
const shots = [];

const capture = async (page, name, note) => {
	const file = join(OUT, `${name}.png`);
	await page.screenshot({ path: file, fullPage: false });
	const badge = await page.locator('.hs-badge').first().textContent().catch(() => null);
	const said = await page.locator('.hs-said').first().textContent().catch(() => null);
	const answered = await page.locator('.hs-answered').first().textContent().catch(() => null);
	const status = await page.locator('.hs-live-status').first().textContent().catch(() => null);
	const body = await page.locator('#hs-root').first().innerText().catch(() => null);
	shots.push({ state: name, note, file, badge, said, answered, status, text: (body || '').slice(0, 400) });
	log(`${name}: ${badge || (body || '').split('\n')[0] || ''}`);
};

/** Open the live view and wait for it to settle. Shared by every phase. */
const openLive = async (page) => {
	await page.goto(`${BASE}/smart-home/satellite?id=${SATELLITE_ID}`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('.hs-badge', { timeout: 30_000 });
	await page.waitForFunction(() => document.querySelector('.hs-badge')?.dataset.state === 'idle', null, { timeout: 30_000 })
		.catch(() => log('did not reach idle; capturing whatever state it is in'));
	await page.waitForTimeout(2000);
};

/**
 * Watch the badge and screenshot each named state the first time it appears.
 * Polling from the outside would miss most of a pipeline run, which takes about
 * a second end to end.
 */
const watchStates = async (page, wanted, seconds, stopAfter = null) => {
	const seen = new Set();
	const deadline = Date.now() + seconds * 1000;
	while (Date.now() < deadline) {
		const state = await page.locator('.hs-badge').first().getAttribute('data-state').catch(() => null);
		if (state && !seen.has(state) && wanted[state]) {
			seen.add(state);
			await capture(page, `${wanted[state]}-${state}`, `pipeline state: ${state}`);
		}
		if (stopAfter && seen.has(stopAfter)) break;
		await page.waitForTimeout(120);
	}
	return seen;
};

const main = async () => {
	const browser = await chromium.launch({
		args: [
			'--use-fake-ui-for-media-stream',
			'--use-fake-device-for-media-stream',
			...(AUDIO ? [`--use-file-for-fake-audio-capture=${AUDIO}`] : []),
			'--autoplay-policy=no-user-gesture-required',
			'--enable-features=WebRTC-Audio',
		],
	});
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		permissions: ['microphone'],
		...(VIDEO ? { recordVideo: { dir: OUT, size: { width: 1280, height: 900 } } } : {}),
	});
	if (SESSION) {
		const url = new URL(BASE);
		await context.addCookies([{ name: 'sid', value: SESSION, domain: url.hostname, path: '/', httpOnly: true, secure: false }]);
	}

	const page = await context.newPage();
	const consoleErrors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

	if (PHASE === 'main') {
		// 1 and 2: the manage view, where a satellite is paired.
		await page.goto(`${BASE}/smart-home/satellite`, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('#hs-root [class*="hs-panel"]', { timeout: 30_000 });
		await page.waitForTimeout(1200);
		await capture(page, '01-unpaired', 'the manage view: no satellite paired yet');

		const pairButton = page.getByRole('button', { name: /pairing code/i });
		if (await pairButton.count()) {
			await pairButton.first().click();
			await page.waitForSelector('.hs-code', { timeout: 20_000 }).catch(() => {});
			await page.waitForTimeout(600);
			await capture(page, '02-pairing', 'a single-use pairing code and the exact command to run');
		}

		if (!SATELLITE_ID) {
			log('no --satellite-id, stopping after the manage view');
		} else {
			// 3, then 5 to 7: the live view, driven by really speaking to it.
			await openLive(page);
			await capture(page, '03-idle', 'paired, Home Assistant connected, waiting');

			const watcher = watchStates(page, { listening: '05', thinking: '06', speaking: '07' }, 75, 'speaking');
			await page.getByRole('button', { name: /talk now/i }).click();
			await page.waitForTimeout(4200);
			await page.getByRole('button', { name: /^done$/i }).click().catch(() => {});
			await watcher;
			await page.waitForTimeout(1500);
			await capture(page, '09-after', 'the transcript and the answer, after the run');

			// The display going to sleep is a state too, and the page is written
			// to keep the socket while it does.
			await page.evaluate(() => {
				Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
				document.dispatchEvent(new Event('visibilitychange'));
			});
			await page.waitForTimeout(700);
			await capture(page, '11-asleep', 'screen resting: the pipeline keeps running');
		}
	} else if (PHASE === 'wake') {
		// 4: Home Assistant heard the wake word. The satellite does no detection
		// of its own, so this state only exists because the house reported it.
		await openLive(page);
		const watcher = watchStates(page, { wake: '04', listening: '05b' }, WAIT, 'wake');
		await page.getByRole('button', { name: /wake word/i }).click();
		const seen = await watcher;
		if (!seen.has('wake')) log('no wake was reported; check the pipeline wake word matches the audio');
		await page.getByRole('button', { name: /stop listening/i }).click().catch(() => {});
	} else if (PHASE === 'error') {
		// 8: a real failure from the pipeline, shown rather than swallowed. The
		// caller stopped speech-to-text before running this.
		await openLive(page);
		const watcher = watchStates(page, { error: '08' }, WAIT, 'error');
		await page.getByRole('button', { name: /talk now/i }).click();
		await page.waitForTimeout(4200);
		await page.getByRole('button', { name: /^done$/i }).click().catch(() => {});
		const seen = await watcher;
		await page.waitForTimeout(1200);
		if (!seen.has('error')) await capture(page, '08-error', 'the page after a failed pipeline run');
	} else if (PHASE === 'disconnect') {
		// 9: the satellite is gone. The page has to say so, and has to say that
		// the voice assistant itself is unaffected.
		await openLive(page);
		log(`stop the satellite process now; waiting up to ${WAIT}s for the page to notice`);
		await page.waitForFunction(
			() => ['offline', 'disconnected'].includes(document.querySelector('.hs-badge')?.dataset.state),
			null,
			{ timeout: WAIT * 1000 },
		).catch(() => log('the page never reported the satellite as gone'));
		await page.waitForTimeout(800);
		const state = await page.locator('.hs-badge').first().getAttribute('data-state').catch(() => null);
		await capture(page, `10-${state || 'offline'}`, 'the satellite is gone; the assistant is not');
	} else {
		throw new Error(`unknown --phase ${PHASE}`);
	}

	writeFileSync(join(OUT, `states-${PHASE}.json`), `${JSON.stringify({ shots, consoleErrors }, null, '\t')}\n`);
	console.log(JSON.stringify({ captured: shots.map((s) => s.state), consoleErrors }, null, '\t'));

	await context.close();
	await browser.close();
};

main().catch((err) => {
	console.error(`[capture] failed: ${err.message}`);
	process.exit(1);
});

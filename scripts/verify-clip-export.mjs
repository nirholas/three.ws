#!/usr/bin/env node
// End-to-end proof for "Make a clip" (src/clip/): drives a real Chromium
// through the dialog on an avatar page, exports a portrait and a landscape MP4,
// then measures lip-sync in the exported files with ffmpeg.
//
//   node scripts/verify-clip-export.mjs [--base http://localhost:3267]
//        [--avatar <avatar id>] [--out <dir>] [--headed] [--states]
//
// --states skips the export and instead drives the error and quota states:
// a recording over the plan's length (rejected in the browser), a line over
// the character budget (rejected by the API before any quota is spent), then
// real clips until the visitor allowance is gone and the dialog shows the
// daily-limit screen. It spends the rest of the caller's daily clips.
//
// Needs the dev server pointed at a local API that has NVIDIA_API_KEY
// (DEV_API_PROXY=http://localhost:3268 with server/index.mjs on 3268), and
// ffmpeg/ffprobe on PATH. Spends one clip of the caller's daily quota; the
// second aspect reuses the cached voice and face track.
//
// Sync is measured three ways, all at the 30 fps frame grid:
//   1. audio placement: the MP4's audio track against the Magpie WAV the API
//      returned. Expected lag is the lead-in (0.3 s = 9 frames).
//   2. face placement: mouth darkness in the MP4's frames against the
//      Audio2Face-3D jawOpen track the API returned, laid out on the clip
//      timeline. Expected lag is 0.
//   3. end to end: mouth darkness against the MP4's own audio envelope, which
//      includes Audio2Face-3D's inherent anticipation of the sound.
// Pass when |1 - 9| <= 1 and |2| <= 1 frame.

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CLIP_FPS, LEAD_IN_SEC, bestLag, rmsEnvelope } from '../src/clip/clip-math.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const BASE = opt('base', 'http://localhost:3267');
const AVATAR = opt('avatar', 'a4bad2f5-8a07-43cf-82e5-b6ba1314441e');
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'three-ws-clip-proof')));
const HEADED = args.includes('--headed');
const STATES = args.includes('--states');
const LINE = 'Hello from three dot w s. Pick an agent, type a line, and share the clip anywhere.';

mkdirSync(OUT, { recursive: true });
const step = (msg) => console.error(`[clip-proof] ${new Date().toISOString().slice(11, 19)} ${msg}`);

function run(cmd, cmdArgs, { binary = false } = {}) {
	const r = spawnSync(cmd, cmdArgs, { maxBuffer: 1 << 30, encoding: binary ? 'buffer' : 'utf8' });
	if (r.status !== 0) throw new Error(`${cmd} failed: ${binary ? r.stderr.toString() : r.stderr}`);
	return r.stdout;
}

function probe(file) {
	return JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
}

function decodeAudio(file, rate = 48000) {
	const buf = run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { binary: true });
	return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function decodeGray(file, w, h) {
	const buf = run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:${h}`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { binary: true });
	const frame = w * h;
	const frames = [];
	for (let o = 0; o + frame <= buf.length; o += frame) frames.push(buf.subarray(o, o + frame));
	return frames;
}

// Per-cell dark-pixel counts. The cell whose darkness varies most over the
// clip is the open-and-close mouth; choosing by variance alone keeps the
// selection independent of any lag.
function mouthSignal(frames, w, h, cell = 6, dark = 45) {
	const cols = Math.floor(w / cell);
	const rows = Math.floor(h / cell);
	const series = Array.from({ length: cols * rows }, () => new Float32Array(frames.length));
	frames.forEach((f, t) => {
		for (let y = 0; y < rows * cell; y++) {
			const row = Math.floor(y / cell) * cols;
			for (let x = 0; x < cols * cell; x++) if (f[y * w + x] < dark) series[row + Math.floor(x / cell)][t]++;
		}
	});
	let best = -1;
	let bestVar = -1;
	series.forEach((s, i) => {
		let m = 0;
		for (const v of s) m += v;
		m /= s.length;
		let v2 = 0;
		for (const v of s) v2 += (v - m) ** 2;
		if (v2 > bestVar) {
			bestVar = v2;
			best = i;
		}
	});
	return { signal: Array.from(series[best]), cell: { col: best % cols, row: Math.floor(best / cols), size: cell } };
}

function jawOnTimeline(track, frameCount) {
	const idx = track.blendShapeNames.indexOf('jawOpen');
	if (idx < 0) throw new Error('A2F track has no jawOpen channel');
	const out = new Array(frameCount).fill(0);
	for (let i = 0; i < frameCount; i++) {
		const t = i / CLIP_FPS - LEAD_IN_SEC;
		const k = Math.max(0, Math.min(track.frames.length - 1, Math.round(t * track.fps)));
		out[i] = track.frames[k].w[idx];
	}
	return out;
}

async function openPage() {
	const browser = await chromium.launch({
		headless: !HEADED,
		args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
	});
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	// Software GL makes every interaction slow; the defaults assume a GPU.
	page.setDefaultTimeout(120_000);
	const consoleErrors = [];
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`);
	});
	page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
	return { browser, page, consoleErrors };
}

// A real WAV of `seconds` of a 220 Hz tone, longer than any plan allows.
function toneWav(seconds, rate = 16000) {
	const n = Math.round(seconds * rate);
	const buf = Buffer.alloc(44 + n * 2);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write('WAVEfmt ', 8);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(rate, 24);
	buf.writeUInt32LE(rate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(n * 2, 40);
	for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000), 44 + i * 2);
	return buf;
}

async function verifyStates() {
	const { browser, page, consoleErrors } = await openPage();
	const report = { base: BASE, avatar: AVATAR, states: {} };
	step(`opening ${BASE}/avatars/${AVATAR}`);
	await page.goto(`${BASE}/avatars/${AVATAR}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await page.locator('#av-clip').click({ timeout: 180_000 });
	await page.locator('.clip-form').waitFor({ timeout: 120_000 });
	const limits = await page.evaluate(async () => (await fetch('/api/clips/voice', { credentials: 'include' })).json());
	report.limits = { plan: limits.plan, perDay: limits.perDay, maxSeconds: limits.maxSeconds, maxChars: limits.maxChars };

	step('recording over the length cap');
	const wav = path.join(OUT, 'too-long.wav');
	writeFileSync(wav, toneWav(limits.maxSeconds + 5));
	await page.locator('[data-source="recording"]').click();
	await page.locator('.clip-file').setInputFiles(wav);
	const notice = page.locator('.clip-notice[role="alert"]');
	await notice.waitFor({ timeout: 60_000 });
	report.states.recording_too_long = await notice.innerText();
	await page.screenshot({ path: path.join(OUT, 'state-recording-too-long.png') });

	step('line over the character budget, straight to the API');
	report.states.api_too_long = await page.evaluate(async (n) => {
		const r = await fetch('/api/clips/voice', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'a'.repeat(n + 40) }),
		});
		return { status: r.status, body: await r.json() };
	}, limits.maxChars);

	await page.locator('[data-source="text"]').click();
	const quotaScreen = page.locator('.clip-msg-warn');
	for (let i = 1; i <= limits.perDay + 1; i++) {
		step(`clip attempt ${i}`);
		await page.locator('.clip-text').fill(`Quota check number ${i}, run ${Date.now()}.`);
		const voiceResp = page.waitForResponse((r) => r.url().endsWith('/api/clips/voice') && r.request().method() === 'POST', { timeout: 180_000 });
		await page.locator('.clip-go').click();
		const r = await voiceResp;
		const status = r.status();
		const body = await r.json().catch(() => null);
		report.states[`attempt_${i}`] = { status, code: body?.code || body?.error || null, remaining: body?.quota?.remaining ?? null };
		if (status === 429) {
			await quotaScreen.waitFor({ timeout: 30_000 });
			report.states.quota_screen = (await quotaScreen.innerText()).replace(/\s+/g, ' ');
			report.states.quota_actions = await quotaScreen.locator('a, button').allInnerTexts();
			await page.screenshot({ path: path.join(OUT, 'state-quota.png') });
			break;
		}
		if (status !== 200) throw new Error(`attempt ${i}: unexpected ${status} ${JSON.stringify(body)}`);
		// The clip is charged once the voice call succeeds; cancel the render.
		await page.locator('.clip-cancel').click({ timeout: 60_000 });
		await page.locator('.clip-form').waitFor({ timeout: 30_000 });
	}
	await browser.close();
	report.consoleErrors = consoleErrors;
	const q = report.states;
	report.pass = /allows clips up to/.test(q.recording_too_long || '')
		&& q.api_too_long?.status === 400 && q.api_too_long?.body?.error === 'too_long'
		&& Boolean(q.quota_screen) && consoleErrors.length === 0;
	writeFileSync(path.join(OUT, 'states-report.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	process.exit(report.pass ? 0 : 1);
}

async function exportBoth() {
	const { browser, page, consoleErrors } = await openPage();
	let voice = null;
	page.on('response', async (r) => {
		if (r.url().endsWith('/api/clips/voice') && r.request().method() === 'POST') {
			voice = { status: r.status(), body: await r.json().catch(() => null) };
		}
	});

	step(`opening ${BASE}/avatars/${AVATAR}`);
	await page.goto(`${BASE}/avatars/${AVATAR}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await page.locator('#av-clip').click({ timeout: 180_000 });
	step('dialog opened');
	await page.locator('.clip-form').waitFor({ timeout: 120_000 });
	step('form ready');
	await page.locator('.clip-text').fill(LINE);
	await page.locator('[data-framing="face"]').click();
	await page.locator('[data-background="color"]').click();
	await page.locator('[data-color="#00b140"]').click();
	await page.locator('.clip-captions').uncheck();

	const results = {};
	for (const aspect of ['portrait', 'landscape']) {
		if (aspect === 'portrait') {
			await page.locator('[data-aspect="portrait"]').click();
			await page.locator('.clip-go').click();
		} else {
			await page.locator('[data-r="other"]').click();
		}
		const started = Date.now();
		step(`rendering ${aspect}`);
		const ticker = setInterval(async () => {
			const t = await page.locator('.clip-dlg-body').innerText().catch(() => '');
			step(`  ${t.replace(/\s+/g, ' ').slice(0, 120)}`);
		}, 15_000);
		await page.locator('.clip-video').waitFor({ timeout: 900_000 }).finally(() => clearInterval(ticker));
		step(`${aspect} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
		const b64 = await page.evaluate(async () => {
			const blob = await (await fetch(document.querySelector('.clip-video').src)).blob();
			const bytes = new Uint8Array(await blob.arrayBuffer());
			let s = '';
			for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
			return btoa(s);
		});
		const file = path.join(OUT, `clip-${aspect}.mp4`);
		writeFileSync(file, Buffer.from(b64, 'base64'));
		const meta = await page.locator('.clip-meta').innerText();
		results[aspect] = { file, renderSec: (Date.now() - started) / 1000, meta: meta.replace(/\s+/g, ' ') };
		await page.screenshot({ path: path.join(OUT, `dialog-${aspect}.png`) });
	}
	await browser.close();
	return { results, voice, consoleErrors };
}

if (STATES) await verifyStates();
const { results, voice, consoleErrors } = await exportBoth();
if (!voice?.body?.ok) throw new Error(`voice call failed: ${JSON.stringify(voice)}`);
const wavFile = path.join(OUT, 'speech.wav');
writeFileSync(wavFile, Buffer.from(voice.body.audio.base64, 'base64'));
writeFileSync(path.join(OUT, 'a2f-track.json'), JSON.stringify(voice.body.animation));
const speech = decodeAudio(wavFile);

const report = { base: BASE, avatar: AVATAR, line: LINE, quota: voice.body.quota, consoleErrors, clips: {} };
for (const [aspect, r] of Object.entries(results)) {
	const p = probe(r.file);
	const v = p.streams.find((s) => s.codec_type === 'video');
	const a = p.streams.find((s) => s.codec_type === 'audio');
	const frameCount = Number(v.nb_frames);
	const audio = decodeAudio(r.file);
	const envOut = Array.from(rmsEnvelope(audio, 48000, CLIP_FPS));
	const envSpeech = Array.from(rmsEnvelope(speech, 48000, CLIP_FPS));
	const padded = new Array(envOut.length).fill(0);
	envSpeech.forEach((x, i) => {
		if (i < padded.length) padded[i] = x;
	});
	const audioLag = bestLag(padded, envOut, 20);

	const [w, h] = v.width > v.height ? [480, 270] : [270, 480];
	const frames = decodeGray(r.file, w, h);
	const mouth = mouthSignal(frames, w, h);
	const jaw = jawOnTimeline(voice.body.animation, frames.length);
	const faceLag = bestLag(jaw, mouth.signal, 15);
	const avLag = bestLag(envOut, mouth.signal, 15);

	report.clips[aspect] = {
		file: r.file,
		render_seconds: r.renderSec,
		dialog_meta: r.meta,
		video: { codec: v.codec_name, width: v.width, height: v.height, fps: v.r_frame_rate, frames: frameCount, duration: Number(v.duration) },
		audio: { codec: a.codec_name, sample_rate: Number(a.sample_rate), channels: a.channels, duration: Number(a.duration) },
		audio_placement_lag_frames: audioLag.lag,
		audio_placement_error_frames: audioLag.lag - Math.round(LEAD_IN_SEC * CLIP_FPS),
		audio_placement_score: Number(audioLag.score.toFixed(3)),
		face_placement_lag_frames: faceLag.lag,
		face_placement_score: Number(faceLag.score.toFixed(3)),
		mouth_vs_audio_lag_frames: avLag.lag,
		mouth_vs_audio_score: Number(avLag.score.toFixed(3)),
		mouth_cell: mouth.cell,
		pass: Math.abs(audioLag.lag - Math.round(LEAD_IN_SEC * CLIP_FPS)) <= 1 && Math.abs(faceLag.lag) <= 1,
	};
}
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(Object.values(report.clips).every((c) => c.pass) ? 0 : 1);

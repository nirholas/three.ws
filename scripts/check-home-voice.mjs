#!/usr/bin/env node
/**
 * The browser proof for the hands-free voice loop (src/voice/home-voice.js).
 *
 * Everything a claim about this feature rests on is measured here, in a real
 * Chromium, against the real speech lanes:
 *
 *   1  cold load          nothing about listening is fetched before opt-in
 *   2  happy path         wake word, capture, transcription, agent turn, reply
 *   3  barge-in           playback stops after the user starts talking
 *   4  self-trigger       the agent's own wake word does not wake it
 *   5  guarded (refused)  an ambient "yeah" does not confirm
 *   6  guarded (accepted) the word "confirm" does
 *   7  mute               capture stops at the track, not behind a flag
 *   8  unavailable        a deployment with no speech lane degrades honestly
 *   9  permission denied  a refused microphone has a way back
 *  10  state gallery      a frame of each of the twelve states
 *
 * The microphone is a real MediaStream fed from a WAV by Chromium's fake capture
 * device, and the speech in those WAVs is synthesized by the platform's own TTS
 * lane rather than hand-picked from a recording. /api/asr and /api/tts/speak are
 * the real endpoints throughout.
 *
 * Two more scenarios need --live, because they need a real Home Assistant:
 *
 *  11  live              a spoken command really turns a real light off
 *  12  live-confirm      a real minted confirmation really unlocks a real door
 *
 * ONE thing is substituted, and only in scenarios 5 and 6: the /api/chat
 * response that carries a pending_confirmation. Reaching the real one in the
 * BROWSER needs a connected Home Assistant and a provider key for the model that
 * picks the tool, so the payload is supplied there to the documented shape and
 * every other leg of those two scenarios (speech, VAD, ASR, the grammar, the
 * redemption request) is the real path. The half a substitution cannot vouch
 * for, that the id was real and that redeeming it moves a deadbolt, is what
 * scenario 12 proves against the real module and the real device. Verified on
 * 2026-09-09: the substituted payload matches what api/_lib/home/tools.js
 * composes, summary sentence included.
 *
 * Usage:
 *   node scripts/check-home-voice.mjs [--port 3457] [--out .cache/home-voice]
 *   node scripts/check-home-voice.mjs --headed        # watch it run
 *   node scripts/check-home-voice.mjs --live --only live-confirm
 *
 * Exit code is 0 when every assertion held, 1 otherwise. The measured legs and
 * the assertions are written to <out>/report.json.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const PORT = Number(flag('port', process.env.HOME_VOICE_PORT || 3457));
const BASE = `http://localhost:${PORT}`;
const OUT = resolve(flag('out', '.cache/home-voice'));
const HEADED = args.includes('--headed');
/**
 * Also drive a REAL Home Assistant, end to end, and assert the device changed.
 *
 * Off by default because it needs docker and a local API server: the loop's
 * /api/chat has to run somewhere that can reach a Home Assistant on loopback,
 * and production cannot route into this machine. Everything it adds is real.
 */
const LIVE = args.includes('--live');
const LIVE_API_PORT = Number(flag('live-api-port', 3798));
const LIVE_VITE_PORT = Number(flag('live-vite-port', 3799));
/**
 * Run only the named scenarios, comma separated. A full run spends the ASR
 * bucket for the IP, and the block that follows lengthens each time it is hit,
 * so re-verifying one fix by re-running all ten scenarios costs the next hour of
 * runs. Names are the keys of SCENARIOS below.
 */
const ONLY = (flag('only', '') || '')
	.split(',')
	.map((name) => name.trim())
	.filter(Boolean);
const AUDIO = join(OUT, 'audio');

mkdirSync(AUDIO, { recursive: true });

/**
 * The QA account from .env, used only so the run is not throttled to the
 * anonymous per-IP buckets (10 TTS and 15 ASR per hour, which one full run
 * spends). The lanes themselves are the same lanes either way. Without the
 * credentials the run still works; it just cannot repeat as often.
 */
let SESSION_COOKIE = null;

/**
 * The credentials live in .env, and nothing in a bare `node script.mjs` reads
 * that file. Without this the run silently falls back to the anonymous buckets
 * and dies part-way through the happy path on a 429 that reads like a broken
 * speech lane. Same shape as the loader in scripts/agent-wallet-smoke.mjs; a
 * value already in the environment always wins.
 */
(function loadEnvFiles() {
	for (const name of ['.env', '.env.local']) {
		const file = resolve(process.cwd(), name);
		if (!existsSync(file)) continue;
		for (const line of readFileSync(file, 'utf8').split('\n')) {
			const m = line.match(/^([A-Z0-9_]+)=(.*)$/i);
			if (!m) continue;
			const value = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
			if (process.env[m[1]] == null || process.env[m[1]] === '') process.env[m[1]] = value;
		}
	}
})();

async function signIn() {
	const email = process.env.AUDIT_EMAIL;
	const password = process.env.AUDIT_PASSWORD;
	if (!email || !password) {
		console.log('[auth] AUDIT_EMAIL / AUDIT_PASSWORD not set: running against the anonymous rate limits.');
		return;
	}
	const upstream = process.env.DEV_API_PROXY || 'https://three.ws';
	const res = await fetch(`${upstream}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	if (!res.ok) {
		console.log(`[auth] login failed (${res.status}): running against the anonymous rate limits.`);
		return;
	}
	const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
	const sid = raw.map((c) => c.split(';')[0]).find((c) => c.startsWith('__Host-sid='));
	if (!sid) {
		console.log('[auth] no session cookie returned: running against the anonymous rate limits.');
		return;
	}
	SESSION_COOKIE = sid;
	console.log('[auth] signed in as the QA account.');
}

/**
 * A disk cache for the agent's own speech, used only where synthesis is
 * scaffolding rather than the thing under test.
 *
 * The guarded-action scenarios make the agent read a confirmation sentence
 * aloud, and re-synthesising the same fixed sentence on every run spends the
 * account's hourly TTS budget on bytes that are identical each time. A cold
 * cache calls the real lane; a warm one replays it. The barge-in and happy-path
 * scenarios never use this, so the tts and firstAudio legs in the report are
 * always measured against a live call.
 */
const TTS_CACHE = join(OUT, 'tts-cache');

async function cachedSpeech(text) {
	mkdirSync(TTS_CACHE, { recursive: true });
	const key = createHash('sha256').update(text).digest('hex').slice(0, 32);
	const file = join(TTS_CACHE, `${key}.wav`);
	if (existsSync(file)) return readFileSync(file);
	const res = await fetch(`${BASE}/api/tts/speak`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(SESSION_COOKIE ? { cookie: SESSION_COOKIE } : {}) },
		body: JSON.stringify({ text, format: 'wav' }),
	});
	if (!res.ok) throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 160)}`);
	const buf = Buffer.from(await res.arrayBuffer());
	writeFileSync(file, buf);
	return buf;
}

async function routeCachedSpeech(page) {
	await page.route('**/api/tts/speak', async (route) => {
		const { text } = JSON.parse(route.request().postData() || '{}');
		try {
			const body = await cachedSpeech(text || ' ');
			await route.fulfill({ status: 200, contentType: 'audio/wav', body });
		} catch (err) {
			await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: String(err) }) });
		}
	});
}

const results = [];
function check(name, pass, detail) {
	results.push({ name, pass: !!pass, detail });
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── fixtures: real synthesized speech, cached on disk ───────────────────────

/**
 * Utterances the scenarios need. leadMs is silence before the speech, which is
 * what buys the page time to load its models before the microphone matters, and
 * tailMs is the trailing silence that lets the VAD call the utterance finished.
 */
const CLIPS = {
	command: { text: 'Hey Jarvis, turn the kitchen light off.', leadMs: 1200, tailMs: 2500 },
	selfTrigger: { text: 'Hey Jarvis. That is my own wake word, spoken by me.', leadMs: 1200, tailMs: 2000 },
	bargeUser: { text: 'Actually stop, I changed my mind about that.', leadMs: 5000, tailMs: 2500 },
	ambientYeah: { text: 'Yeah.', leadMs: 8000, tailMs: 2500 },
	confirmToken: { text: 'Confirm.', leadMs: 8000, tailMs: 2500 },
	silence: { text: '', leadMs: 12000, tailMs: 0 },
};

async function ensureClips() {
	for (const [name, spec] of Object.entries(CLIPS)) {
		const path = join(AUDIO, `${name}.wav`);
		spec.path = path;
		if (existsSync(path)) continue;
		const speech = spec.text ? await synthesize(spec.text) : { samples: new Float32Array(0), rate: 16000 };
		const lead = Math.round((spec.leadMs / 1000) * 16000);
		const tail = Math.round((spec.tailMs / 1000) * 16000);
		const resampled = resample(speech.samples, speech.rate, 16000);
		const out = new Float32Array(lead + resampled.length + tail);
		out.set(resampled, lead);
		writeFileSync(path, wav16(out, 16000));
		spec.speechStartMs = spec.leadMs;
		console.log(`[fixture] ${name}.wav ${(out.length / 16000).toFixed(2)}s`);
	}
}

/** The platform's own TTS lane, so the test speech is speech the product makes. */
async function synthesize(text) {
	const res = await fetch(`${BASE}/api/tts/speak`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(SESSION_COOKIE ? { cookie: SESSION_COOKIE } : {}) },
		body: JSON.stringify({ text, format: 'wav' }),
	});
	if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`);
	return decodeWav(Buffer.from(await res.arrayBuffer()));
}

function decodeWav(buf) {
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let off = 12;
	let rate = 16000;
	let bits = 16;
	let channels = 1;
	let dataOff = 0;
	let dataLen = 0;
	while (off + 8 <= buf.byteLength) {
		const id = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
		const size = dv.getUint32(off + 4, true);
		if (id === 'fmt ') {
			channels = dv.getUint16(off + 10, true);
			rate = dv.getUint32(off + 12, true);
			bits = dv.getUint16(off + 22, true);
		}
		if (id === 'data') {
			dataOff = off + 8;
			dataLen = size;
			break;
		}
		off += 8 + size + (size % 2);
	}
	const frames = Math.floor(dataLen / (bits / 8) / channels);
	const out = new Float32Array(frames);
	for (let i = 0; i < frames; i++) out[i] = dv.getInt16(dataOff + i * 2 * channels, true) / 32768;
	return { samples: out, rate };
}

function resample(x, from, to) {
	if (from === to || !x.length) return x;
	const ratio = from / to;
	const n = Math.floor(x.length / ratio);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const p = i * ratio;
		const k = Math.floor(p);
		const f = p - k;
		const a = x[k] || 0;
		const b = x[k + 1] !== undefined ? x[k + 1] : a;
		out[i] = a + (b - a) * f;
	}
	return out;
}

function wav16(samples, rate) {
	const n = samples.length;
	const buf = Buffer.alloc(44 + n * 2);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + n * 2, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(rate, 24);
	buf.writeUInt32LE(rate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(n * 2, 40);
	for (let i = 0; i < n; i++) {
		buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
	}
	return buf;
}

// ── browser plumbing ────────────────────────────────────────────────────────

async function launch(audioPath, { loopAudio = true } = {}) {
	// A machine under memory pressure from a neighbour's build kills a browser
	// during startup, and it can die at any point between launch and the first
	// page. That is never a finding about the page under test, so the whole
	// startup is retried rather than only the first call in it.
	let lastError = null;
	for (let attempt = 0; attempt < 4; attempt++) {
		let browser = null;
		try {
			return await startBrowser(audioPath, loopAudio);
		} catch (err) {
			lastError = err;
			await browser?.close().catch(() => {});
			await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
		}
	}
	throw lastError;
}

async function startBrowser(audioPath, loopAudio) {
	const chromiumArgs = [
		'--use-fake-device-for-media-stream',
		'--use-fake-ui-for-media-stream',
		'--autoplay-policy=no-user-gesture-required',
		// Playwright already passes --disable-dev-shm-usage, which matters here: a
		// container's 64 MB /dev/shm is smaller than the wasm speech runtime plus a
		// decoded audio buffer. Nothing further is capped on purpose: a heap or
		// renderer-process limit small enough to be a good neighbour is also small
		// enough to kill the tab while onnxruntime is compiling, and a dead tab
		// reads as a bug in the page.
	];
	// The fake capture file starts the moment getUserMedia opens, and the models
	// take a few seconds to arrive on a cold cache. Looping means the utterance
	// comes round again rather than the whole scenario hinging on a guess about
	// how long the download took.
	if (audioPath) chromiumArgs.push(`--use-file-for-fake-audio-capture=${audioPath}${loopAudio ? '' : '%noloop'}`);

	const browser = await chromium.launch({ headless: !HEADED, args: chromiumArgs });
	const context = await browser.newContext({
		permissions: ['microphone'],
		// The session travels as a header rather than a cookie because the cookie is
		// __Host- prefixed and Secure, and the dev origin is plain http on localhost.
		// The dev server forwards it upstream unchanged either way.
		extraHTTPHeaders: SESSION_COOKIE ? { cookie: SESSION_COOKIE } : {},
	});
	const page = await context.newPage();
	const requests = [];
	page.on('request', (r) => requests.push({ url: r.url(), at: Date.now() }));
	const consoleErrors = [];
	const failedResponses = [];
	// Noise from the harness and from the platform chrome, neither of which is the
	// page under test: the dev server's HMR socket cannot reach a
	// Codespace-forwarded origin, its dependency cache is re-optimized whenever a
	// concurrent agent edits this worktree, and the site nav polls
	// /api/notifications when localStorage still holds an auth hint.
	//
	// That last one is this harness's own doing and not something a visitor sees.
	// The session here travels as a header, so the page is authenticated for the
	// requests this script makes and anonymous for the cookie jar the nav reads,
	// and the poll 401s in between. Measured on 2026-09-09 with no hint present:
	// zero requests to /api/notifications and no 401, and a stale hint is cleared
	// by the first 401 rather than retried.
	//
	// A console message carries the failing URL in its LOCATION, not in its text
	// ("Failed to load resource: ... 401"), so the url has to be matched too. It
	// was not, and every run reported that 401 as a console error on the voice
	// surface.
	const isDevNoise = (text) => /\[vite\]|WebSocket|hmr|\/api\/notifications|Outdated Optimize Dep|\/node_modules\/\.vite\//i.test(text);
	page.on('console', (m) => {
		const where = m.location()?.url || 'unknown';
		if (m.type() === 'error' && !isDevNoise(`${m.text()} ${where}`)) {
			consoleErrors.push(`${m.text()} @ ${where}`);
		}
	});
	page.on('response', (r) => {
		if (r.status() >= 400 && !isDevNoise(r.url())) failedResponses.push(`${r.status()} ${r.url().replace(BASE, '')}`);
	});
	page.on('pageerror', (e) => {
		if (!isDevNoise(String(e))) consoleErrors.push(String(e));
	});
	return { browser, context, page, requests, consoleErrors, failedResponses };
}

/** Mirror the loop's own event stream into the page so the script can await it. */
const TAP = `
	window.__hv = { events: [], states: [] };
	const install = () => {
		if (!window.homeVoice) return false;
		const loop = window.homeVoice.loop;
		const priorEvent = loop.onEvent;
		loop.onEvent = (e) => { priorEvent?.(e); window.__hv.events.push({ ...e, t: performance.now() }); };
		const priorState = loop.onState;
		loop.onState = (s, d) => { priorState?.(s, d); window.__hv.states.push({ state: s, t: performance.now() }); };
		return true;
	};
	if (!install()) {
		const timer = setInterval(() => { if (install()) clearInterval(timer); }, 25);
	}
`;

async function bootPage(page, { query = '' } = {}) {
	// Concurrent agents edit vite.config.js in this worktree, which restarts the
	// dev server mid-run. Retry rather than fail a real assertion on that.
	let lastError = null;
	for (let attempt = 0; attempt < 6; attempt++) {
		try {
			await page.goto(`${BASE}/voice/home${query}`, { waitUntil: 'domcontentloaded' });
			await page.waitForFunction(() => !!window.homeVoice, null, { timeout: 30000 });
			await page.evaluate(TAP);
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(4000);
		}
	}
	throw lastError;
}

async function optIn(page) {
	await page.evaluate(async () => {
		const { loop } = window.homeVoice;
		loop.grantConsent();
		await loop.enable();
	});
}

async function waitForEvent(page, type, timeout = 45000) {
	try {
		await page.waitForFunction((t) => window.__hv.events.some((e) => e.type === t), type, { timeout, polling: 50 });
	} catch (err) {
		const seen = await page.evaluate(() => ({
			state: window.homeVoice.loop.state,
			wakeReady: !!window.homeVoice.loop._wake?.ready,
			vadRunning: !!window.homeVoice.loop._vad?.running,
			peakScore: Math.max(0, ...window.__hv.events.filter((e) => e.type === 'wake-score').map((e) => e.score)),
			scores: window.__hv.events.filter((e) => e.type === 'wake-score').length,
			types: [...new Set(window.__hv.events.map((e) => e.type))],
		}));
		throw new Error(`waiting for "${type}" timed out. Loop state: ${JSON.stringify(seen)}`);
	}
}

const events = (page) => page.evaluate(() => window.__hv.events);
const legs = (page) => page.evaluate(() => window.homeVoice.loop.latencySummary());

// ── scenarios ───────────────────────────────────────────────────────────────

/**
 * Load the page once and throw the browser away.
 *
 * Other agents edit this worktree while a run is in flight, which makes Vite
 * re-optimize its dependency cache and answer 504 to whatever was mid-flight.
 * Absorbing that here means a real assertion never fails for it.
 */
async function warmUp() {
	const { browser, page } = await launch(null);
	try {
		await page.goto(`${BASE}/voice/home`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
		await page.waitForTimeout(1500);
		await page.reload({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
		console.log('[warm] dev server primed.');
	} finally {
		await browser.close();
	}
}

async function scenarioColdLoad() {
	const { browser, page, requests, consoleErrors, failedResponses } = await launch(null);
	try {
		await bootPage(page);
		await page.waitForTimeout(3000);
		const voiceAssets = requests.filter((r) =>
			/models\/voice|onnxruntime|vad-web|wake-word\.js|silero/i.test(r.url),
		);
		check('cold load fetches nothing about listening before opt-in', voiceAssets.length === 0, {
			fetched: voiceAssets.map((r) => r.url.replace(BASE, '')),
		});
		const state = await page.evaluate(() => window.homeVoice.loop.state);
		check('the loop rests in a non-listening state on a cold load', state === 'off' || state === 'unavailable', {
			state,
		});
		const micLive = await page.evaluate(() => window.homeVoice.loop.micLive);
		check('no microphone is open on a cold load', micLive === false);
		await page.locator('#voice-panel').screenshot({ path: join(OUT, 'cold-load.png') });

		// The same cold browser, after opting in: now the models arrive.
		await optIn(page);
		await page.waitForTimeout(1500);
		const afterOptIn = requests.filter((r) => /models\/voice/i.test(r.url));
		check('the models are fetched only once the user opts in', afterOptIn.length > 0, {
			count: afterOptIn.length,
			sample: afterOptIn.slice(0, 3).map((r) => r.url.replace(BASE, '')),
		});
		check('no console errors on the voice surface', consoleErrors.length === 0, {
			errors: consoleErrors.slice(0, 4),
			failedResponses: failedResponses.slice(0, 6),
		});
	} finally {
		await browser.close();
	}
}

async function scenarioHappyPath() {
	const { browser, page } = await launch(CLIPS.command.path);
	try {
		await bootPage(page);
		await optIn(page);
		await waitForEvent(page, 'wake', 45000);
		const wake = (await events(page)).find((e) => e.type === 'wake');
		check('the wake word fires on real speech', wake.score >= 0.5, { score: Number(wake.score.toFixed(4)) });

		await waitForEvent(page, 'transcript', 60000);
		const transcript = (await events(page)).find((e) => e.type === 'transcript');
		check('the utterance after the wake word is transcribed by the real lane', /kitchen light/i.test(transcript.text), {
			text: transcript.text,
		});

		// The turn runs against the real /api/chat. Whether it can reach a device is
		// order 04's business; what is measured here is that the loop completes.
		await page
			.waitForFunction(
				() => ['idle', 'speaking', 'error', 'confirm-pending'].includes(window.homeVoice.loop.state),
				null,
				{ timeout: 90000 },
			)
			.catch(() => {});

		const measured = await legs(page);
		check('the wake-word leg is inside its 200 ms budget', (measured.wake?.median ?? 1e9) <= 200, measured.wake);
		check('the end-of-speech leg is inside its 400 ms budget', (measured.endpoint?.median ?? 1e9) <= 400, measured.endpoint);
		check('transcription round trip is measured', !!measured.asr, measured.asr);
		await page.locator('#voice-panel').screenshot({ path: join(OUT, 'happy-path.png') });
		return measured;
	} finally {
		await browser.close();
	}
}

/**
 * The answer the agent is part-way through when it gets interrupted. Long enough
 * that a real interruption lands inside it, and hoisted out of the scenario so
 * main() can put it in the speech cache before the clock starts: synthesizing it
 * live costs more than the interrupting clip's 5 s silent lead, which would make
 * the scenario measure TTS latency instead of barge-in.
 */
const BARGE_IN_ANSWER =
	'The kitchen light is off, the hallway light is off, the thermostat is holding at twenty degrees, ' +
	'the front door is locked, and the garage is closed. Nothing else has changed since this morning.';

async function scenarioBargeIn() {
	const { browser, page } = await launch(CLIPS.bargeUser.path);
	try {
		// The agent's own speech comes from the disk cache here, which is the same
		// bytes the real lane produced, returned in milliseconds. The live lane
		// takes seconds to synthesize a sentence this long, and the interrupting
		// clip starts talking 5 s in: against the live lane the interruption
		// reliably lands BEFORE the first sample plays, which measures TTS latency
		// rather than barge-in. Cached, the agent is genuinely audible when the
		// user talks over it, which is the thing this scenario exists to prove.
		await routeCachedSpeech(page);
		await bootPage(page);
		await optIn(page);
		// Speak a long enough answer that the user's interruption lands inside it,
		// and keep trying until one of them genuinely does.
		//
		// The interrupting clip starts talking 5 s in, and on a cold page the
		// models, the opt-in and the synthesis can still be finishing then, so the
		// first interruption sometimes arrives before a single sample has played.
		// That is not an un-interruptible agent, it is a race in this harness, and
		// asserting on it made a passing feature look broken. The microphone clip
		// loops, so another interruption is always a few seconds away: speak again
		// and measure the one that lands while sound is actually coming out.
		let stop = null;
		let barge = null;
		const stalls = [];
		for (let attempt = 0; attempt < 3 && !stop?.audible; attempt++) {
			// Wait for the loop to be quiet first. An utterance injected while the
			// loop is mid-turn is cancelled by the loop's own _speak (which opens
			// with _cancelPlayback), and a cancelled utterance neither plays nor
			// reports a failure: it just silently returns. Measured on 2026-09-09,
			// that is exactly what a retry started too early does.
			await page.waitForFunction(() => window.homeVoice.loop.state === 'idle', null, { timeout: 60000 });
			const mark = (await events(page)).length;
			// Started, not awaited. _speak resolves when the utterance finishes
			// playing, and the whole point of this scenario is that it never does:
			// the promise a barge-in cancels is left unsettled on purpose, so
			// returning it here would hang the evaluate for the rest of the run.
			await page.evaluate((line) => {
				window.homeVoice.loop._speak(line);
			}, BARGE_IN_ANSWER);
			// Wait for sound actually leaving the speaker, not merely for the state
			// flip: _speak enters `speaking` before the synthesis request returns, so
			// a failed TTS call would otherwise read as a silent, un-interruptible
			// agent.
			try {
				await page.waitForFunction(
					() => !!window.homeVoice.loop._playback || window.__hv.events.some((e) => e.type === 'tts-failed'),
					null,
					{ timeout: 30000 },
				);
			} catch {
				// The loop took the utterance away again. Record what it was holding
				// and try the next cycle rather than failing on a race: a bare
				// "waitForFunction timed out" names none of the three legs this wait
				// covers (the request, the decode, the start of playback).
				stalls.push(
					await page.evaluate(() => ({
						state: window.homeVoice.loop.state,
						contextState: window.homeVoice.loop._audioContext?.state ?? null,
						pendingSynthesis: !!window.homeVoice.loop._playbackAbort,
					})),
				);
				continue;
			}
			const ttsFailure = (await events(page)).slice(mark).find((e) => e.type === 'tts-failed');
			if (ttsFailure) throw new Error(`the agent could not speak, so barge-in cannot be measured: ${ttsFailure.message}`);

			await waitForEvent(page, 'barge-in', 45000);
			const since = (await events(page)).slice(mark);
			barge = since.find((e) => e.type === 'barge-in') || barge;
			stop = since.find((e) => e.type === 'playback-stopped' && e.reason === 'barge-in') || stop;
		}
		if (!stop) throw new Error(`playback never started in three attempts: ${JSON.stringify(stalls)}`);
		check('the user talking over the agent stops playback', !!stop, { audible: stop?.audible });
		check('and the sound it stopped was already coming out of the speaker', stop?.audible === true, {
			audible: stop?.audible,
		});
		const measured = await legs(page);
		check('playback stops within 200 ms of the user starting to talk', (measured.bargeIn?.median ?? 1e9) <= 200, measured.bargeIn);
		// Read the transitions the loop made AT the barge-in, from the recorded
		// log. A live read races the real turn that the interrupting utterance
		// legitimately kicks off: by the time it runs the loop may already be
		// thinking, or speaking the answer, and neither of those is a failure.
		// The pair is asserted rather than the destination alone because state 8
		// existing but being skipped would leave a host with no way to render it.
		const after = await page.evaluate((t) => window.__hv.states.filter((s) => s.t >= t).map((s) => s.state), barge.t);
		check(
			'the loop passes through barged-in and is capturing again immediately',
			after[0] === 'barged-in' && after[1] === 'capturing',
			{ after: after.slice(0, 4).join(' -> ') },
		);
		await page.locator('#voice-panel').screenshot({ path: join(OUT, 'barge-in.png') });
		return measured;
	} finally {
		await browser.close();
	}
}

async function scenarioSelfTrigger() {
	const { browser, page } = await launch(CLIPS.selfTrigger.path);
	try {
		await bootPage(page);
		await optIn(page);
		// Hold the loop in the state it is in while its own voice is playing.
		await page.evaluate(() => {
			const { loop } = window.homeVoice;
			loop._wake.suppressed = true;
			loop._setState('speaking', { text: 'Hey Jarvis is my wake word.' });
			// The wake word only reads frames while idle, so for this proof the
			// frames are handed to it directly: the guard, not the state gate, is
			// what is under test.
			loop._onFrame = function (frame) {
				this._wake.push(frame);
			}.bind(loop);
			loop._vad.onFrame = (frame) => loop._onFrame(frame, 0);
		});
		await page.waitForFunction(() => window.homeVoice.loop._wake.suppressedPeak > 0.5, null, { timeout: 45000 });
		const peak = await page.evaluate(() => window.homeVoice.loop._wake.suppressedPeak);
		const wakes = (await events(page)).filter((e) => e.type === 'wake');
		check('the agent hearing its own wake word scores high enough to wake', peak >= 0.5, { peak: Number(peak.toFixed(4)) });
		check('and does not wake, because the guard is absolute', wakes.length === 0, { wakes: wakes.length });
		return { peak, wakes: wakes.length };
	} finally {
		await browser.close();
	}
}

/**
 * The /api/chat stream a guarded request produces, frame for frame as
 * api/chat.js sends it: a `home_tool` frame carrying the gate's
 * pending_confirmation, then the model's closing sentence.
 *
 * Substituted here only because reaching the real one needs a connected Home
 * Assistant and a home connection record, which belong to earlier orders in the
 * campaign. The payload is the real contract (api/_lib/home/tools.js composes
 * `structured.confirmation`), and the redemption these scenarios then perform is
 * the real endpoint's real request.
 */
const CONFIRMATION_ID = '3d5a0c58-7a8e-4d31-9a53-1f0e2c9b4a77';
const GUARDED_STREAM = [
	{
		type: 'home_tool',
		tool: 'home_call',
		status: 'pending_confirmation',
		home_id: 'check-home',
		data: {
			status: 'pending_confirmation',
			home: { id: 'check-home', label: 'Check Home' },
			confirmation: {
				id: CONFIRMATION_ID,
				summary: 'This will unlock the Front Door.',
				risk: 'opens the house',
				domain: 'lock',
				service: 'unlock',
				entity_ids: ['lock.front_door'],
				entities: [{ entity_id: 'lock.front_door', domain: 'lock', name: 'Front Door', state: 'locked' }],
				expires_in_seconds: 90,
				confirm_url: '/api/home/check-home/confirm',
			},
		},
	},
	{ type: 'done', reply: 'That one needs your approval.', home: [], actions: [] },
]
	.map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
	.join('');

async function scenarioGuarded({ clip, expectRedeemed, label }) {
	// One pass of the audio, not a loop: a repeated "yeah" would re-run the whole
	// turn every few seconds and the point of the scenario is one utterance
	// against one open confirmation.
	const { browser, page } = await launch(clip.path, { loopAudio: false });
	const redemptions = [];
	try {
		await page.route('**/api/chat', (route) =>
			route.fulfill({ status: 200, contentType: 'text/event-stream', body: GUARDED_STREAM }),
		);
		await page.route('**/api/csrf-token', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { token: 'check' } }) }),
		);
		await page.route('**/api/home/*/confirm', (route) => {
			redemptions.push(JSON.parse(route.request().postData() || '{}'));
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Unlocked the Front Door.' }),
			});
		});

		await routeCachedSpeech(page);
		await bootPage(page, { query: '?home=check-home' });
		await optIn(page);
		await page.evaluate(() => window.homeVoice.loop.say('unlock the front door'));
		await waitForEvent(page, 'confirmation-open', 45000);
		const spoken = await page.evaluate(() => window.homeVoice.loop.stateDetail.confirmation?.sentence);
		check(`${label}: the whole action is spoken and shown before anything happens`, spoken === 'This will unlock the Front Door.', {
			spoken,
		});
		const shownEntities = await page.locator('.hv-confirm-entities li').allTextContents();
		check(
			`${label}: the entity is on screen, by name and by id, while the confirmation is open`,
			shownEntities.some((t) => t.includes('Front Door') && t.includes('lock.front_door')),
			{ shownEntities },
		);
		await page.locator('#voice-panel').screenshot({ path: join(OUT, `guarded-${expectRedeemed ? 'confirm' : 'yeah'}.png`) });

		await waitForEvent(page, 'transcript', 90000);
		const transcript = (await events(page)).find((e) => e.type === 'transcript');
		await page.waitForTimeout(2500);

		if (expectRedeemed) {
			check(`${label}: the spoken token is transcribed as the token`, /confirm/i.test(transcript.text), {
				text: transcript.text,
			});
			check(`${label}: the door is unlocked, by id alone`, redemptions.length === 1, { redemptions });
			check(
				`${label}: the redemption carries the confirmation id and nothing else`,
				redemptions[0] && Object.keys(redemptions[0]).join(',') === 'confirmation_id',
				redemptions[0],
			);
			check(`${label}: and it is the id the server minted`, redemptions[0]?.confirmation_id === CONFIRMATION_ID);
		} else {
			check(`${label}: the ambient word is transcribed`, transcript.text.trim().length > 0, { text: transcript.text });
			check(`${label}: nothing is unlocked`, redemptions.length === 0, { redemptions });
			const notToken = (await events(page)).some((e) => e.type === 'confirmation-not-token');
			check(`${label}: the loop says out loud that it was not the token`, notToken);
		}
	} finally {
		await browser.close();
	}
}

async function scenarioMute() {
	const { browser, page } = await launch(CLIPS.silence.path, { loopAudio: false });
	try {
		await bootPage(page);
		await optIn(page);
		const before = await page.evaluate(() => ({
			tracks: window.homeVoice.loop.trackStates(),
			live: window.homeVoice.loop.micLive,
			indicator: document.querySelector('.hv-indicator').dataset.live,
		}));
		check('the indicator reads live while the microphone is live', before.live && before.indicator === 'true', before);

		await page.click('[data-act="mute"]');
		await page.waitForFunction(() => window.homeVoice.loop.state === 'muted', null, { timeout: 15000 });
		await page.waitForTimeout(400);
		const after = await page.evaluate(() => ({
			tracks: window.homeVoice.loop.trackStates(),
			live: window.homeVoice.loop.micLive,
			indicator: document.querySelector('.hv-indicator').dataset.live,
			text: document.querySelector('.hv-indicator-text').textContent,
		}));
		check('mute ends every track at the device', after.tracks.every((s) => s === 'ended'), after.tracks);
		check('and the indicator follows the track, not a flag', after.live === false && after.indicator === 'false', after);
		await page.locator('#voice-panel').screenshot({ path: join(OUT, 'muted.png') });
		return after;
	} finally {
		await browser.close();
	}
}

async function scenarioUnavailable() {
	const { browser, page } = await launch(null);
	try {
		await page.route('**/api/asr', (route) =>
			route.request().method() === 'GET'
				? route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ configured: false, encodings: [], sampleRate: 16000 }),
					})
				: route.continue(),
		);
		await bootPage(page);
		await page.waitForFunction(() => window.homeVoice.loop.state === 'unavailable', null, { timeout: 20000 });
		const detail = await page.evaluate(() => ({
			state: window.homeVoice.loop.state,
			reason: window.homeVoice.loop.stateDetail.reason,
			micLive: window.homeVoice.loop.micLive,
			body: document.querySelector('#voice-panel .hv-body').textContent,
		}));
		check('an unconfigured speech lane lands in the unavailable state', detail.state === 'unavailable');
		check('with an honest reason, and no microphone', /not available/i.test(detail.body) && !detail.micLive, detail);

		// Even a user who insists gets no microphone.
		await page.evaluate(async () => {
			const { loop } = window.homeVoice;
			loop.grantConsent();
			await loop.enable();
		});
		const stillOff = await page.evaluate(() => window.homeVoice.loop.micLive);
		check('and opting in anyway still opens no microphone', stillOff === false);
		await page.locator('#voice-panel').screenshot({ path: join(OUT, 'unavailable.png') });
	} finally {
		await browser.close();
	}
}

async function scenarioPermissionDenied() {
	const { browser, page } = await launch(null);
	try {
		// The browser refusing the microphone, which is the one failure the loop
		// cannot route around and must therefore explain.
		await page.addInitScript(() => {
			Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
				configurable: true,
				value: async () => {
					const err = new Error('Permission denied');
					err.name = 'NotAllowedError';
					throw err;
				},
			});
		});
		await bootPage(page);
		await optIn(page);
		await page.waitForFunction(() => window.homeVoice.loop.state === 'permission-denied', null, { timeout: 20000 });
		const recovery = await page.locator('#voice-panel .hv-recovery').textContent();
		check('a denied microphone is a designed state, not a dead end', /Allow|address bar|settings/i.test(recovery), {
			recovery,
		});
		const retry = await page.locator('#voice-panel [data-act="retry"]').count();
		check('and it offers a way back', retry === 1);
		await page.locator('#voice-panel').screenshot({ path: join(OUT, 'permission-denied.png') });
	} finally {
		await browser.close();
	}
}

async function scenarioStateGallery() {
	const { browser, page } = await launch(null);
	try {
		await page.goto(`${BASE}/voice/home`, { waitUntil: 'networkidle' });
		const sections = page.locator('.vh-state');
		const count = await sections.count();
		check('the state gallery renders every one of the twelve states', count === 12, { count });
		for (let i = 0; i < count; i++) {
			const section = sections.nth(i);
			const name = (await section.locator('> h3').textContent()).trim();
			await section.screenshot({ path: join(OUT, `state-${String(i + 1).padStart(2, '0')}-${name}.png`) });
		}
		await page.screenshot({ path: join(OUT, 'page-full.png'), fullPage: true });
	} finally {
		await browser.close();
	}
}

/**
 * The whole point of the feature, proved against hardware-shaped reality: a
 * person says one sentence out loud and a real device in a real Home Assistant
 * changes state.
 *
 * Every leg here is the real one. The speech is synthesized audio played into
 * Chromium's capture device, the wake word is matched by the committed
 * openWakeWord weights in the tab, the transcript comes from the live ASR lane,
 * and the agent turn runs api/chat.js with the real home tools against a real
 * Home Assistant, which really turns the light off. The assertion is not on
 * what the agent SAID it did: it is on the entity state read back out of Home
 * Assistant's own REST API afterwards, because an agent that reports success it
 * did not achieve is the failure this scenario exists to catch.
 *
 * The one piece of scaffolding is topology, not behaviour: the page is served
 * by a Vite whose /api proxy points at a local server instead of production,
 * because a Home Assistant on 127.0.0.1 is not reachable from Cloud Run. The
 * two lanes that need cloud credentials, ASR and TTS, are routed back to
 * production so they stay the real lanes too.
 */
/** The seeded demo light the spoken command names. Its friendly name is "Kitchen Lights". */
const LIVE_LIGHT = 'light.kitchen_lights';
/** The seeded lock the confirmation scenario drives. Its friendly name is "Front Door". */
const LIVE_LOCK = 'lock.front_door';

/**
 * Bring up everything the live scenario needs, and hand back a teardown.
 *
 * A real Home Assistant from the lane's shared harness, a real API server that
 * can reach it, a real session for the QA account, and a real home connection
 * created through the real POST /api/home. The connection row is deleted again
 * on the way out: it points at a loopback URL that means nothing anywhere else,
 * and its token is encrypted with a key generated for this run.
 */
async function liveStack() {
	const sh = (cmd, cmdArgs, opts = {}) =>
		new Promise((resolveRun, rejectRun) => {
			const child = spawn(cmd, cmdArgs, { cwd: process.cwd(), ...opts });
			let out = '';
			child.stdout?.on('data', (d) => (out += d));
			child.stderr?.on('data', (d) => (out += d));
			child.on('error', rejectRun);
			child.on('close', (code) => (code === 0 ? resolveRun(out) : rejectRun(new Error(`${cmd} exited ${code}: ${out.slice(-500)}`))));
		});

	console.log('[live] bringing up a real Home Assistant...');
	const raw = await sh(process.execPath, [
		'scripts/home-test-instance.mjs',
		'--up', '--onboard', '--seed', '--json', '--name', 'voiceloop',
	]);
	const ha = JSON.parse(raw.slice(raw.indexOf('{')));
	console.log(`[live] Home Assistant ${ha.haVersion} at ${ha.baseUrl}`);

	// The API server needs its own signing and encryption keys. They are local to
	// this run: they sign the session it mints and encrypt the row it writes, both
	// of which this function deletes again.
	// Set on THIS process as well as the child's. The confirmation scenario below
	// runs api/_lib/home/tools.js in-process, and it has to decrypt the same
	// connection row this server wrote, with the same key.
	process.env.HOME_ALLOW_LOCAL_INSTANCE = '1';
	process.env.JWT_SECRET ||= randomBytes(32).toString('hex');
	process.env.WALLET_ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
	const env = { ...process.env, PORT: String(LIVE_API_PORT) };
	const api = spawn(process.execPath, ['server/index.mjs'], { env, stdio: 'ignore' });
	const apiBase = `http://localhost:${LIVE_API_PORT}`;
	await waitForHttp(`${apiBase}/api/healthz`, 60000);

	// The same real login the site's own form performs, against the local server
	// so the session is one this server will accept.
	const login = await fetch(`${apiBase}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: process.env.AUDIT_EMAIL, password: process.env.AUDIT_PASSWORD }),
	});
	if (!login.ok) throw new Error(`local login failed: ${login.status} ${(await login.text()).slice(0, 200)}`);
	const cookie = cookieHeader(login);
	if (!/sid=/.test(cookie)) throw new Error('the local server returned no session cookie');

	// Cookie sessions are CSRF-protected, so the token has to be carried the same
	// way the browser carries it: cookie plus matching header.
	const csrfRes = await fetch(`${apiBase}/api/csrf-token`, { headers: { cookie } });
	const csrf = (await csrfRes.json().catch(() => ({})))?.data?.token || '';
	const authed = `${cookie}; ${cookieHeader(csrfRes)}`;
	if (!csrf) throw new Error('the local server issued no CSRF token');

	// Prune any home row whose Home Assistant no longer answers.
	//
	// This teardown can fail (it says so below), the plan covers one home, and a
	// dead row therefore turns every LATER run of this script into a 402 that
	// reads like a billing bug. Observed exactly that on 2026-09-09: a row left
	// by the previous run pointed at a container that had since exited.
	const existing = await fetch(`${apiBase}/api/home`, { headers: { cookie: authed } })
		.then((r) => r.json())
		.catch(() => ({ homes: [] }));
	for (const home of existing.homes || []) {
		const alive = await fetch(`${home.base_url}/api/`, { headers: { authorization: 'Bearer probe' } })
			.then(() => true)
			.catch(() => false);
		if (alive) continue;
		const token = await freshCsrf(apiBase, authed);
		const dropped = await fetch(`${apiBase}/api/home/${home.id}`, {
			method: 'DELETE',
			headers: { cookie: authed, 'x-csrf-token': token },
		}).catch(() => null);
		console.log(`[live] pruned a home whose instance is gone: ${home.base_url} (${dropped?.status ?? 'no response'})`);
	}

	const created = await fetch(`${apiBase}/api/home`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie: authed, 'x-csrf-token': csrf },
		body: JSON.stringify({ baseUrl: ha.baseUrl, token: ha.token }),
	});
	const body = await created.json().catch(() => ({}));
	if (!created.ok) throw new Error(`could not connect the house: ${created.status} ${JSON.stringify(body).slice(0, 300)}`);
	const homeId = body?.home?.id || body?.id;
    if (!homeId) throw new Error(`the connect response carried no home id: ${JSON.stringify(body).slice(0, 300)}`);
	console.log(`[live] connected as home ${homeId}`);

	// A second Vite, whose /api goes to the local server rather than production.
	const vite = spawn('npx', ['vite', '--port', String(LIVE_VITE_PORT)], {
		env: { ...process.env, DEV_API_PROXY: apiBase },
		stdio: 'ignore',
	});
	const viteBase = `http://localhost:${LIVE_VITE_PORT}`;
	await waitForHttp(`${viteBase}/voice/home`, 90000);

	const { sql } = await import('../api/_lib/db.js');
	const [account] = await sql`select id from users where lower(email) = lower(${process.env.AUDIT_EMAIL}) limit 1`;

	return {
		ha,
		homeId,
		cookie: authed,
		apiBase,
		userId: account?.id || null,
		viteBase,
		async teardown() {
			// A fresh token, not the one the POST used: CSRF tokens rotate on a
			// state-changing request, and a stale one makes the DELETE a silent 403
			// that leaves a loopback home connected to the account forever.
			const fresh = await fetch(`${apiBase}/api/csrf-token`, { headers: { cookie: authed } }).catch(() => null);
			const token = fresh ? (await fresh.json().catch(() => ({})))?.data?.token : '';
			const res = await fetch(`${apiBase}/api/home/${homeId}`, {
				method: 'DELETE',
				headers: { cookie: `${authed}; ${fresh ? cookieHeader(fresh) : ''}`, 'x-csrf-token': token || csrf },
			}).catch(() => null);
			if (!res?.ok) console.warn(`[live] could not remove home ${homeId} (${res?.status ?? 'no response'}); remove it from /home before it is forgotten.`);
			else console.log(`[live] removed home ${homeId}.`);
			vite.kill();
			api.kill();
		},
	};
}

/**
 * Mint a CSRF token for the next state-changing request.
 *
 * Tokens rotate on every such request, so a token held across two of them is a
 * silent 403 that reads exactly like a broken endpoint. Every mutating call in
 * the live path takes a fresh one.
 */
async function freshCsrf(apiBase, cookie) {
	const res = await fetch(`${apiBase}/api/csrf-token`, { headers: { cookie } });
	return (await res.json().catch(() => ({})))?.data?.token || '';
}

/** Every cookie a response set, folded into one request-shaped header. */
function cookieHeader(res) {
	const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
	return raw.map((c) => c.split(';')[0]).join('; ');
}

/** Poll a URL until it answers, so a spawned server is never raced. */
async function waitForHttp(url, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const res = await fetch(url).catch(() => null);
		if (res?.ok) return;
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`nothing answered at ${url} within ${timeoutMs} ms`);
}

async function scenarioLive({ ha, viteBase, homeId, cookie }) {
	const state = async (entity) => {
		const res = await fetch(`${ha.baseUrl}/api/states/${entity}`, {
			headers: { authorization: `Bearer ${ha.token}` },
		});
		if (!res.ok) throw new Error(`home assistant ${res.status} reading ${entity}`);
		return (await res.json()).state;
	};
	const call = (domain, service, entity) =>
		fetch(`${ha.baseUrl}/api/services/${domain}/${service}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${ha.token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ entity_id: entity }),
		});

	// Put the light in the state the sentence is going to change, so "off" at the
	// end cannot be the state it was already in.
	await call('light', 'turn_on', LIVE_LIGHT);
	const before = await state(LIVE_LIGHT);
	check('the real light starts on, so turning it off is a change', before === 'on', { before });

	const { browser, page } = await launch(CLIPS.command.path);
	try {
		// ASR and TTS are the only lanes whose credentials live in the cloud, so
		// they go to production while everything else talks to the local server.
		for (const lane of ['**/api/asr', '**/api/tts/speak']) {
			await page.route(lane, async (route) => {
				const req = route.request();
				const res = await fetch(`https://three.ws${new URL(req.url()).pathname}`, {
					method: req.method(),
					headers: { ...req.headers(), host: 'three.ws', ...(SESSION_COOKIE ? { cookie: SESSION_COOKIE } : {}) },
					body: req.method() === 'GET' ? undefined : req.postDataBuffer(),
				});
				await route.fulfill({
					status: res.status,
					headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' },
					body: Buffer.from(await res.arrayBuffer()),
				});
			});
		}
		// launch() put the production session on the context for the ASR and TTS
		// lanes; the page itself now talks to the local server, which needs the
		// local one. The two routes above keep sending production's.
		await page.setExtraHTTPHeaders({ cookie });
		await page.goto(`${viteBase}/voice/home?home=${homeId}`, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(() => !!window.homeVoice, null, { timeout: 30000 });
		await page.evaluate(TAP);
		await optIn(page);

		await waitForEvent(page, 'transcript', 90000);
		const transcript = (await events(page)).find((e) => e.type === 'transcript');
		check('the spoken command is transcribed by the real lane', /kitchen/i.test(transcript?.text || ''), {
			text: transcript?.text,
		});

		// Poll Home Assistant itself. The agent's own reply is not evidence.
		let after = before;
		for (let i = 0; i < 60 && after !== 'off'; i++) {
			await page.waitForTimeout(1000);
			after = await state(LIVE_LIGHT);
		}
		check('the real light is off, read back from Home Assistant', after === 'off', { before, after });

		const done = (await events(page)).find((e) => e.type === 'reply' || e.type === 'turn-done');
		const spoken = await page.evaluate(() => window.homeVoice.loop.stateDetail?.text || '');
		check('and the agent says what it did', !!(spoken || done), { spoken: (spoken || '').slice(0, 120) });
		await page.locator('#voice-panel').screenshot({ path: join(OUT, 'live-real-device.png') });
		return { before, after, transcript: transcript?.text, spoken };
	} finally {
		await browser.close();
	}
}

/**
 * How many tool-calling providers this machine actually has.
 *
 * Every rung of api/_lib/llm-tool-chain.js needs either a provider key or a
 * usable GCP token, so a checkout with no keys in .env and an expired gcloud
 * login has NONE, and the agent turn cannot run at all. That failure surfaces
 * downstream as "the light is still on", which reads like a broken home lane and
 * is not one. Counting the rungs up front turns it into one honest line.
 */
async function agentTurnRungs() {
	const { providerChain } = await import('../api/_lib/llm-tool-chain.js');
	return providerChain().map((p) => p.name);
}

/**
 * The guarded path, against a real Home Assistant and a real minted
 * confirmation. No model is involved on purpose.
 *
 * The two browser guarded scenarios above prove the half that lives in the tab:
 * the sentence is spoken and shown, an ambient "yeah" is refused, the token is
 * accepted, and the redemption request goes out. What they cannot prove with a
 * substituted /api/chat is that the id in that request was real and that
 * redeeming it moves a real deadbolt. This proves exactly that, by driving
 * api/_lib/home/tools.js (the same module api/chat.js runs server-side between
 * its two model passes) and then redeeming through the real endpoint.
 *
 * Splitting it this way is deliberate: the model choosing a tool is the one leg
 * that needs a provider key, and the safety properties do not depend on it.
 */
async function scenarioLiveConfirmation({ ha, homeId, cookie, apiBase, userId }) {
	const state = async (entity) => {
		const res = await fetch(`${ha.baseUrl}/api/states/${entity}`, { headers: { authorization: `Bearer ${ha.token}` } });
		if (!res.ok) throw new Error(`home assistant ${res.status} reading ${entity}`);
		return (await res.json()).state;
	};
	const lock = () =>
		fetch(`${ha.baseUrl}/api/services/lock/lock`, {
			method: 'POST',
			headers: { authorization: `Bearer ${ha.token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ entity_id: LIVE_LOCK }),
		});
	const settle = async (entity, want, tries = 20) => {
		let value = await state(entity);
		for (let i = 0; i < tries && value !== want; i++) {
			await new Promise((r) => setTimeout(r, 500));
			value = await state(entity);
		}
		return value;
	};
	const redeem = async (id) => {
		const token = await freshCsrf(apiBase, cookie);
		const res = await fetch(`${apiBase}/api/home/${homeId}/confirm`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': token },
			body: JSON.stringify({ confirmation_id: id }),
		});
		return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) };
	};

	await lock();
	const before = await settle(LIVE_LOCK, 'locked');
	check('the real door starts locked, so unlocking it is a change', before === 'locked', { before });

	const { runHomeTool } = await import('../api/_lib/home/tools.js');
	const minted = await runHomeTool(
		'home_call',
		{ home_id: homeId, domain: 'lock', service: 'unlock', data: { entity_id: LIVE_LOCK } },
		{ userId, source: 'voice' },
	);
	const confirmation = minted?.structured?.confirmation || null;
	check('a guarded call mints a confirmation instead of acting', minted?.kind === 'pending_confirmation' && !!confirmation?.id, {
		kind: minted?.kind,
		id: confirmation?.id,
		summary: confirmation?.summary,
	});
	check(
		'the confirmation carries the sentence, the entity and the redemption url the loop renders',
		confirmation?.summary === 'This will unlock the Front Door.' &&
			confirmation?.entity_ids?.includes(LIVE_LOCK) &&
			confirmation?.entities?.[0]?.name === 'Front Door' &&
			confirmation?.confirm_url === `/api/home/${homeId}/confirm`,
		{
			summary: confirmation?.summary,
			entity_ids: confirmation?.entity_ids,
			name: confirmation?.entities?.[0]?.name,
			confirm_url: confirmation?.confirm_url,
		},
	);
	check('minting alone does not move the real door', (await state(LIVE_LOCK)) === 'locked', { during: await state(LIVE_LOCK) });

	const accepted = await redeem(confirmation.id);
	const unlocked = await settle(LIVE_LOCK, 'unlocked');
	check('redeeming the minted confirmation really unlocks the real door', accepted.ok && unlocked === 'unlocked', {
		status: accepted.status,
		after: unlocked,
	});

	// Single use, proved against the device rather than against the response: the
	// same id must not be able to open the door a second time.
	await lock();
	await settle(LIVE_LOCK, 'locked');
	const replayed = await redeem(confirmation.id);
	const afterReplay = await settle(LIVE_LOCK, 'unlocked', 6);
	check('and the same confirmation cannot open it twice', !replayed.ok && afterReplay === 'locked', {
		status: replayed.status,
		code: replayed.body?.code || replayed.body?.error,
		afterReplay,
	});

	return { confirmationId: confirmation.id, unlocked, replayStatus: replayed.status };
}

/**
 * Run one scenario, and run it again if a dev-server reload pulled the page out
 * from under it.
 *
 * Concurrent agents edit this worktree while a run is in flight, and any source
 * file they touch makes Vite reload every open page. That wipes the opt-in and
 * the recorded events, so the scenario is not retryable in place: it has to
 * start over, with the checks it already appended dropped, or a half-finished
 * attempt would be reported alongside the real one. Only the navigation error is
 * caught. A failing assertion is a failing assertion and is never retried.
 */
async function run(scenario) {
	const mark = results.length;
	for (let attempt = 0; ; attempt++) {
		try {
			return await scenario();
		} catch (err) {
			const reloaded = /Execution context was destroyed|Target closed|frame was detached/i.test(err?.message || '');
			if (!reloaded || attempt >= 2) throw err;
			results.length = mark;
			console.log(`[retry] the dev server reloaded mid-scenario; starting it again (${attempt + 1}/2).`);
		}
	}
}

// ── run ─────────────────────────────────────────────────────────────────────

async function main() {
	// The live scenarios bring up their own Vite, and live-confirm opens no
	// browser at all, so only a run that includes a browser scenario on the shared
	// dev server needs one to already be listening.
	const LIVE_ONLY_NAMES = ['live', 'live-confirm'];
	const needsSharedServer = ONLY.length === 0 || ONLY.some((name) => !LIVE_ONLY_NAMES.includes(name));
	if (needsSharedServer) {
		const probe = await fetch(`${BASE}/voice/home`).catch(() => null);
		if (!probe?.ok) {
			console.error(`No dev server at ${BASE}. Start one with: npx vite --port ${PORT}`);
			process.exit(2);
		}
	}
	await signIn();
	// The speech clips are what the browser scenarios speak into the fake
	// microphone; a live-confirm run has no microphone and needs none of them.
	if (needsSharedServer) await ensureClips();
	// Synthesize the agent's interrupted answer once, before anything is timed,
	// so the barge-in scenario is as fast on a machine that has never run this
	// script as on one that has.
	if (needsSharedServer) {
		await cachedSpeech(BARGE_IN_ANSWER);
		await warmUp();
	}

	const measured = {};
	const SCENARIOS = {
		'cold-load': scenarioColdLoad,
		happy: async () => (measured.happy = await scenarioHappyPath()),
		barge: async () => (measured.barge = await scenarioBargeIn()),
		'self-trigger': async () => (measured.selfTrigger = await scenarioSelfTrigger()),
		'guarded-yeah': () => scenarioGuarded({ clip: CLIPS.ambientYeah, expectRedeemed: false, label: 'ambient yes' }),
		'guarded-token': () => scenarioGuarded({ clip: CLIPS.confirmToken, expectRedeemed: true, label: 'the token' }),
		mute: async () => (measured.mute = await scenarioMute()),
		unavailable: scenarioUnavailable,
		'permission-denied': scenarioPermissionDenied,
		gallery: scenarioStateGallery,
	};

	const unknown = ONLY.filter((name) => !LIVE_ONLY_NAMES.includes(name) && !SCENARIOS[name]);
	if (unknown.length) throw new Error(`unknown scenario(s): ${unknown.join(', ')}. Known: ${Object.keys(SCENARIOS).join(', ')}, ${LIVE_ONLY_NAMES.join(', ')}`);
	const wanted = (name) => ONLY.length === 0 || ONLY.includes(name);

	for (const [name, scenario] of Object.entries(SCENARIOS)) {
		if (wanted(name)) await run(scenario);
	}

	if (LIVE && (wanted('live') || wanted('live-confirm'))) {
		const stack = await liveStack();
		try {
			// The confirmation scenario first: it needs no provider key, so the
			// guarded proof still lands on a machine where the agent turn cannot.
			if (wanted('live-confirm')) measured.liveConfirm = await run(() => scenarioLiveConfirmation(stack));
			if (wanted('live')) {
				const rungs = await agentTurnRungs();
				console.log(`[live] tool-calling providers available: ${rungs.length ? rungs.join(', ') : 'NONE'}`);
				if (!rungs.length) {
					// Reported as a skip with its cause, never as a passing check and
					// never as a failing home lane. The turn is what is missing here,
					// and the missing piece is a credential, not code.
					measured.live = { skipped: 'no tool-calling provider is configured on this machine' };
					console.log(
						'[live] SKIPPED the spoken end-to-end leg: every rung of api/_lib/llm-tool-chain.js needs a provider\n' +
							'       key or a usable GCP token, and this checkout has neither, so no agent turn can run.\n' +
							'       Set one of GROQ_API_KEY / CEREBRAS_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY, or run\n' +
							'       `gcloud auth application-default login` and export GOOGLE_CLOUD_PROJECT, then run it again.',
					);
				} else {
					measured.live = await run(() => scenarioLive(stack));
				}
			}
		} finally {
			await stack.teardown();
		}
	}

	const failed = results.filter((r) => !r.pass);
	writeFileSync(
		join(OUT, 'report.json'),
		JSON.stringify({ base: BASE, at: new Date().toISOString(), results, measured }, null, 2),
	);
	console.log(`\n${results.length - failed.length}/${results.length} checks passed. Report: ${join(OUT, 'report.json')}`);
	if (failed.length) {
		for (const f of failed) console.log(`  FAILED: ${f.name}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

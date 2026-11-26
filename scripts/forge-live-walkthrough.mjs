#!/usr/bin/env node
/**
 * forge-live-walkthrough.mjs: the one command that answers "is Forge working
 * right now?" the way a visitor would find out.
 *
 * It signs in as the QA account (the Playwright storage state written by
 * `npm run audit:web:login`), loads /forge in a real Chromium, makes a real model
 * from a text prompt and, when asked, from a photo, then checks what came back:
 * the file downloads and is a real GLB with meshes and a sane triangle count, the
 * viewer draws it (the canvas is not blank), the share page and its preview image
 * answer, and the model is listed under the account's creations.
 *
 * Every stage is timed and reported as pass, fail or skipped, with the evidence.
 * Exit code 0 only when every stage that ran passed.
 *
 * Usage:
 *   npm run forge:walkthrough                         # text prompt (a fresh one is picked)
 *   npm run forge:walkthrough -- --text "a brass desk lamp"
 *   npm run forge:walkthrough -- --photo docs/forge-photo-prep/bench/chair/original.jpg
 *   npm run forge:walkthrough -- --text "..." --photo <path-or-url>   # both, one after the other
 *   npm run forge:walkthrough -- --skip-generate      # everything that needs no generation
 *   npm run forge:walkthrough -- --out report.json    # also write a JSON report (+ viewer screenshots)
 *   npm run forge:walkthrough -- --base http://localhost:4105 --headed
 *
 * Budget rules this script keeps on its own: generations run one at a time
 * (and a lock file stops two copies of this script generating at once), a 429 is
 * waited out once for the stated time and retried once, and nothing is ever paid
 * for. The Download button is never clicked, because with pay-to-keep enabled it
 * can open a $THREE payment; the stage fetches the exact URL that button carries.
 *
 * Doc: docs/ops/forge-walkthrough.md
 */

import { chromium } from 'playwright';
import { existsSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const AUTH_STATE = resolve(ROOT, '.auth/audit-state.json');
const LOCK_FILE = join(tmpdir(), 'three-ws-forge-walkthrough.lock');

// A generation is about 150 s on a warm lane and up to about 9 min on a cold
// start, so the wait for a result has to clear the cold case with room to spare.
const GENERATION_TIMEOUT_MS = 12 * 60_000;
// The on-device photo check downloads its model the first time it runs.
const PHOTO_PREP_TIMEOUT_MS = 4 * 60_000;
// Measured 2026-11-26: a 7 MB textured Forge GLB takes 45 to 90 s to load in
// software WebGL, because each frame blocks the main thread. Four minutes clears
// that with room; a real fault is caught sooner by the viewer's own error event.
const VIEWER_LOAD_TIMEOUT_MS = 4 * 60_000;
const HEARTBEAT_MS = 30_000;
// The longest stated wait this script will sit through before calling it a failure.
const MAX_STATED_WAIT_S = 300;
// Used only when a 429 states no wait at all (the page itself falls back to 10 s).
const DEFAULT_WAIT_S = 15;

export const MIN_TRIANGLES = 100;
export const MAX_TRIANGLES = 5_000_000;

const CHROMIUM_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const UA_SUFFIX = 'threews-forge-walkthrough/1.0';

// ── Arguments ────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
	const opts = { base: 'https://three.ws', text: null, photo: null, skipGenerate: false, out: null, headed: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const value = () => {
			const v = argv[i + 1];
			if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
			i += 1;
			return v;
		};
		if (a === '--base') opts.base = value().replace(/\/+$/, '');
		else if (a === '--text') opts.text = value().trim();
		else if (a === '--photo') opts.photo = value();
		else if (a === '--out') opts.out = value();
		else if (a === '--skip-generate') opts.skipGenerate = true;
		else if (a === '--headed') opts.headed = true;
		else if (a === '--help' || a === '-h') opts.help = true;
		else throw new Error(`Unknown argument: ${a}`);
	}
	if (opts.text === '') throw new Error('--text needs a non-empty prompt');
	if (opts.skipGenerate && (opts.text || opts.photo)) throw new Error('--skip-generate cannot be combined with --text or --photo');
	return opts;
}

// Which generations a run makes. No flag at all means one text generation, so
// the bare command is the full proof.
export function plannedGenerations(opts) {
	if (opts.skipGenerate) return [];
	const plan = [];
	if (opts.text || !opts.photo) plan.push('text');
	if (opts.photo) plan.push('photo');
	return plan;
}

// A fresh, ordinary prompt per run. /api/forge keeps a content-addressed result
// cache, so a fixed prompt would come back cached and prove nothing about
// generation (the stage fails loudly if that happens anyway).
const OBJECTS = ['ceramic teapot', 'wooden rocking chair', 'brass desk lamp', 'leather backpack', 'vintage typewriter', 'potted succulent', 'tin toy robot', 'camping lantern', 'acoustic guitar', 'stone garden lantern', 'canvas sneaker', 'enamel coffee mug'];
const FINISHES = ['matte blue glaze', 'weathered oak', 'polished brass', 'worn brown leather', 'glossy red enamel', 'speckled terracotta', 'brushed steel', 'pastel painted wood'];
const LIGHT = ['studio lighting', 'soft daylight', 'clean product shot'];
export function freshPrompt(rand = Math.random) {
	const pick = (list) => list[Math.floor(rand() * list.length)];
	return `a ${pick(OBJECTS)} with ${pick(FINISHES)}, single object, plain background, ${pick(LIGHT)}`;
}

// ── Pure checks (unit-tested in tests/forge-live-walkthrough.test.js) ───────

/** Seconds a 429 asked us to wait: body retry_after, then Retry-After, then RateLimit-Reset. */
export function retryAfterSeconds({ headers = {}, body = null } = {}) {
	const fromBody = Number(body?.retry_after ?? body?.retryAfter);
	if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
	const h = (name) => headers[name] ?? headers[name.toLowerCase()];
	const ra = h('retry-after');
	if (ra != null && String(ra).trim() !== '') {
		const n = Number(ra);
		if (Number.isFinite(n) && n > 0) return Math.ceil(n);
		const at = Date.parse(String(ra));
		if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - Date.now()) / 1000));
	}
	const reset = Number(h('ratelimit-reset'));
	if (Number.isFinite(reset) && reset > 0) return Math.ceil(reset);
	return null;
}

/** A response counts as throttled on HTTP 429 or the API's rate_limited error code. */
export function isThrottled(status, body) {
	return status === 429 || body?.error === 'rate_limited';
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function trianglesFor(primitive, accessors) {
	const mode = primitive.mode ?? 4;
	const count = primitive.indices != null ? accessors[primitive.indices]?.count : accessors[primitive.attributes?.POSITION]?.count;
	if (!Number.isFinite(count)) return 0;
	if (mode === 4) return Math.floor(count / 3);
	if (mode === 5 || mode === 6) return Math.max(0, count - 2);
	return 0; // points and lines draw no surface
}

/**
 * Validate a GLB from its bytes without decoding any compressed buffers: the
 * header, the chunk layout, the JSON, and the mesh and triangle counts the JSON
 * declares (accessor counts survive Draco and meshopt compression). Returns
 * { ok, reason?, ...stats }.
 */
export function inspectGlb(input) {
	const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
	const fail = (reason, extra = {}) => ({ ok: false, reason, bytes: u8.length, ...extra });
	if (u8.length < 20) return fail(`the file is ${u8.length} bytes, too small to be a GLB`);
	const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
	if (dv.getUint32(0, true) !== GLB_MAGIC) {
		const head = new TextDecoder().decode(u8.subarray(0, 16)).replace(/[^\x20-\x7e]/g, '.');
		return fail(`the file starts with "${head}" instead of the glTF magic bytes`);
	}
	const version = dv.getUint32(4, true);
	if (version !== 2) return fail(`GLB version ${version}, expected 2`);
	const declared = dv.getUint32(8, true);
	if (declared !== u8.length) return fail(`the header says ${declared} bytes but the file has ${u8.length} (truncated or padded download)`);
	const jsonLen = dv.getUint32(12, true);
	if (dv.getUint32(16, true) !== CHUNK_JSON) return fail('the first chunk is not the JSON chunk');
	if (20 + jsonLen > u8.length) return fail('the JSON chunk runs past the end of the file');
	let json;
	try {
		json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen)));
	} catch (err) {
		return fail(`the JSON chunk does not parse: ${err.message}`);
	}
	let binLen = 0;
	const binAt = 20 + jsonLen;
	if (binAt + 8 <= u8.length) {
		if (dv.getUint32(binAt + 4, true) !== CHUNK_BIN) return fail('the second chunk is not the BIN chunk');
		binLen = dv.getUint32(binAt, true);
		if (binAt + 8 + binLen > u8.length) return fail('the BIN chunk runs past the end of the file');
	}
	const accessors = json.accessors || [];
	const meshes = json.meshes || [];
	let primitives = 0;
	let triangles = 0;
	let vertices = 0;
	for (const mesh of meshes) {
		for (const p of mesh.primitives || []) {
			primitives += 1;
			triangles += trianglesFor(p, accessors);
			vertices += accessors[p.attributes?.POSITION]?.count || 0;
		}
	}
	// The GLB-bound buffer is buffer 0 with no uri; a meshopt fallback buffer
	// carries no bytes and is exempt.
	const glbBuffer = json.buffers?.[0];
	const glbBound = glbBuffer && glbBuffer.uri === undefined && !glbBuffer.extensions?.EXT_meshopt_compression?.fallback;
	if (glbBound) {
		for (const [i, view] of (json.bufferViews || []).entries()) {
			if ((view.buffer ?? 0) !== 0) continue;
			if ((view.byteOffset || 0) + view.byteLength > binLen) return fail(`buffer view ${i} runs past the end of the binary chunk`);
		}
	}
	const stats = {
		bytes: u8.length,
		meshes: meshes.length,
		primitives,
		triangles,
		vertices,
		materials: (json.materials || []).length,
		images: (json.images || []).length,
		extensions: json.extensionsUsed || [],
	};
	if (meshes.length === 0 || primitives === 0) return fail('the file has no meshes', stats);
	if (triangles < MIN_TRIANGLES) return fail(`only ${triangles} triangles (fewer than ${MIN_TRIANGLES} is not a usable model)`, stats);
	if (triangles > MAX_TRIANGLES) return fail(`${triangles} triangles (more than ${MAX_TRIANGLES.toLocaleString('en-US')} is not a sane Forge output)`, stats);
	return { ok: true, ...stats };
}

/** Judge pixel stats sampled from the viewer canvas. */
export function judgeCanvas(stats) {
	if (!stats || !stats.width || !stats.height) return { blank: true, reason: 'the viewer canvas has no size' };
	if (stats.changedFraction < 0.005) {
		return { blank: true, reason: `only ${(stats.changedFraction * 100).toFixed(2)}% of the canvas differs from the background` };
	}
	if (stats.distinctColors < 8) return { blank: true, reason: `the canvas has only ${stats.distinctColors} distinct colours` };
	return { blank: false };
}

/**
 * Why the viewer did not finish loading, from what it reported about the model it
 * holds now: its own error event, no model at all, or a load still running.
 */
export function explainViewerWait(state, timeoutMs) {
	if (!state) return 'the page has no #viewer element';
	if (!state.src) return 'the viewer was never given a model to load';
	const events = state.events || [];
	const error = events.find((e) => e.type === 'error');
	if (error) return `the viewer reported an error loading ${state.src}: ${error.detail || 'no detail'}`;
	const progress = [...events].reverse().find((e) => e.type === 'progress');
	const pct = progress ? ` (last progress ${Math.round(Number(progress.detail) * 100)}%)` : '';
	return `the viewer was still loading ${state.src} after ${Math.round(timeoutMs / 1000)}s${pct}`;
}

/** Point the saved session cookies at another host (a local dev server proxying /api). */
export function scopeStorageState(state, base) {
	const host = new URL(base).hostname;
	const cookies = (state.cookies || []).filter((c) => c.domain.replace(/^\./, '').endsWith('three.ws'));
	if (host === 'three.ws' || host.endsWith('.three.ws')) return { ...state, cookies };
	return { ...state, cookies: cookies.map((c) => ({ ...c, domain: host })) };
}

export function cookieHeader(state, base) {
	const host = new URL(base).hostname;
	return (state.cookies || [])
		.filter((c) => {
			const d = c.domain.replace(/^\./, '');
			return host === d || host.endsWith(`.${d}`);
		})
		.map((c) => `${c.name}=${c.value}`)
		.join('; ');
}

/** Exit code: 0 only when every stage that ran passed. */
export function exitCodeFor(stages) {
	return stages.some((s) => s.status === 'fail') ? 1 : 0;
}

export function summaryLine(stage) {
	const tag = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[stage.status] || stage.status.toUpperCase();
	const secs = stage.ms != null ? ` (${(stage.ms / 1000).toFixed(1)}s)` : '';
	const detail = stage.summary ? `: ${stage.summary}` : '';
	return `${tag.padEnd(5)} ${stage.label}${secs}${detail}`;
}

// ── Stage bookkeeping ────────────────────────────────────────────────────────

class Report {
	constructor() {
		this.stages = [];
	}
	async run(id, label, fn) {
		const started = Date.now();
		log(`… ${label}`);
		let result;
		try {
			result = await fn();
		} catch (err) {
			result = { status: 'fail', summary: err?.message || String(err), evidence: { stack: err?.stack?.split('\n').slice(0, 4).join(' | ') } };
		}
		const stage = { id, label, status: result.status, ms: Date.now() - started, summary: result.summary || '', evidence: result.evidence || {}, warnings: result.warnings || [] };
		this.stages.push(stage);
		log(summaryLine(stage));
		return { ...stage, data: result.data };
	}
	skip(id, label, why) {
		const stage = { id, label, status: 'skip', ms: null, summary: why, evidence: {}, warnings: [] };
		this.stages.push(stage);
		log(summaryLine(stage));
		return stage;
	}
}

const pass = (summary, evidence = {}, extra = {}) => ({ status: 'pass', summary, evidence, ...extra });
const failed = (summary, evidence = {}, extra = {}) => ({ status: 'fail', summary, evidence, ...extra });

function log(line) {
	process.stderr.write(`${line}\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clip(value, n = 600) {
	const s = typeof value === 'string' ? value : JSON.stringify(value);
	if (s == null) return s;
	return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ── HTTP with the single-retry 429 rule ─────────────────────────────────────

async function httpOnce(url, { cookie, method = 'GET', timeoutMs = 30_000, as = 'json', headers = {} } = {}) {
	const res = await fetch(url, {
		method,
		headers: { 'user-agent': UA_SUFFIX, ...(cookie ? { cookie } : {}), ...headers },
		redirect: 'follow',
		signal: AbortSignal.timeout(timeoutMs),
	});
	const resHeaders = Object.fromEntries(res.headers.entries());
	let body = null;
	if (as === 'json') body = await res.json().catch(() => null);
	else if (as === 'text') body = await res.text().catch(() => '');
	else body = new Uint8Array(await res.arrayBuffer());
	return { status: res.status, ok: res.ok, headers: resHeaders, body, url: res.url };
}

/** One request; on a 429 wait the stated time once and retry once. Never loops. */
async function http(url, opts = {}) {
	const first = await httpOnce(url, opts);
	if (!isThrottled(first.status, opts.as === 'json' || !opts.as ? first.body : null)) return first;
	const wait = retryAfterSeconds(first) ?? DEFAULT_WAIT_S;
	if (wait > MAX_STATED_WAIT_S) {
		const err = new Error(`${url} answered 429 and asked for ${wait}s, longer than the ${MAX_STATED_WAIT_S}s this run will wait`);
		err.responses = [first];
		throw err;
	}
	log(`  ${new URL(url).pathname} answered 429; waiting the stated ${wait}s once, then retrying once`);
	await sleep(wait * 1000);
	const second = await httpOnce(url, opts);
	if (isThrottled(second.status, second.body)) {
		const err = new Error(`${new URL(url).pathname} answered 429 twice (waited ${wait}s between): ${clip(second.body, 200)}`);
		err.responses = [first, second];
		throw err;
	}
	return second;
}

// ── One generation at a time, across copies of this script too ──────────────

function acquireLock() {
	try {
		const fd = openSync(LOCK_FILE, 'wx');
		writeFileSync(fd, String(process.pid));
		closeSync(fd);
		return true;
	} catch (err) {
		if (err.code !== 'EEXIST') throw err;
		const holder = Number(readFileSync(LOCK_FILE, 'utf8'));
		let alive = false;
		try {
			if (holder > 0) {
				process.kill(holder, 0);
				alive = true;
			}
		} catch {
			alive = false;
		}
		if (alive) return false;
		unlinkSync(LOCK_FILE);
		return acquireLock();
	}
}

function releaseLock() {
	try {
		if (Number(readFileSync(LOCK_FILE, 'utf8')) === process.pid) unlinkSync(LOCK_FILE);
	} catch {
		// already gone
	}
}

// ── Browser helpers ──────────────────────────────────────────────────────────

/** Console errors, page errors, failed requests and >= 400 responses, with a cursor per stage. */
function watchPage(page) {
	const events = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') events.push({ kind: 'console', text: clip(msg.text(), 300), at: page.url() });
	});
	page.on('pageerror', (err) => events.push({ kind: 'pageerror', text: clip(err.message, 300) }));
	page.on('requestfailed', (req) => {
		const why = req.failure()?.errorText || 'failed';
		// ERR_ABORTED is the page cancelling its own request (navigation, a
		// superseded fetch), not a server or network failure.
		if (/ERR_ABORTED/.test(why)) return;
		events.push({ kind: 'requestfailed', text: `${req.method()} ${clip(req.url(), 200)}: ${why}` });
	});
	page.on('response', (res) => {
		if (res.status() >= 400) events.push({ kind: 'http', text: `${res.request().method()} ${res.status()} ${clip(res.url(), 200)}` });
	});
	return {
		mark: () => events.length,
		since: (mark) => events.slice(mark),
	};
}

/** Every /api/forge submit and job poll the page makes, for evidence and the 429 rule. */
function captureForgeApi(page) {
	const cap = { posts: [], lastPoll: null };
	page.on('response', async (res) => {
		let u;
		try {
			u = new URL(res.url());
		} catch {
			return;
		}
		if (u.pathname !== '/api/forge') return;
		const method = res.request().method();
		if (method === 'POST') {
			const body = await res.json().catch(() => null);
			cap.posts.push({ status: res.status(), headers: res.headers(), body, at: Date.now() });
		} else if (method === 'GET' && u.searchParams.has('job')) {
			const body = await res.json().catch(() => null);
			cap.lastPoll = { status: res.status(), body, at: Date.now() };
		}
	});
	return cap;
}

async function waitForTerminalState(page, timeoutMs) {
	const handle = await page.waitForFunction(
		() => {
			const shown = (id) => {
				const el = document.getElementById(id);
				return !!el && !el.classList.contains('is-hidden') && el.getClientRects().length > 0;
			};
			if (shown('state-result') && document.getElementById('viewer')?.getAttribute('src')) return 'result';
			if (shown('state-error')) return 'error';
			if (shown('state-unconfigured')) return 'unconfigured';
			return false;
		},
		null,
		{ timeout: timeoutMs, polling: 1000 },
	);
	return handle.jsonValue();
}

async function readErrorPanel(page) {
	return page.evaluate(() => ({
		title: document.getElementById('error-title')?.textContent?.trim() || '',
		message: document.getElementById('error-message')?.textContent?.trim() || '',
		unconfigured: document.getElementById('state-unconfigured')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300) || '',
	}));
}

function startHeartbeat(page, label, startedAt) {
	return setInterval(async () => {
		const status = await page
			.evaluate(() => document.getElementById('state-generating')?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 140) || '')
			.catch(() => '');
		log(`  ${label}: still waiting, ${Math.round((Date.now() - startedAt) / 1000)}s${status ? `. Page says: ${status}` : ''}`);
	}, HEARTBEAT_MS);
}

async function openForge(page, base, query = '') {
	await page.goto(`${base}/forge${query}`, { waitUntil: 'load', timeout: 90_000 });
	await page.locator('#generate').waitFor({ state: 'visible', timeout: 60_000 });
	// The engine picker is built once the catalog answers; until then a click on
	// Generate has no engine to send.
	await page.locator('#engine button').first().waitFor({ state: 'visible', timeout: 60_000 });
}

async function resolvePhoto(photo) {
	if (!/^https?:\/\//i.test(photo)) {
		const p = resolve(process.cwd(), photo);
		if (!existsSync(p)) throw new Error(`photo not found: ${p}`);
		return p;
	}
	const res = await httpOnce(photo, { as: 'bytes', timeoutMs: 60_000 });
	if (!res.ok) throw new Error(`photo URL answered HTTP ${res.status}`);
	const type = (res.headers['content-type'] || '').split(';')[0].trim();
	const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type];
	if (!ext) throw new Error(`photo URL served ${type || 'no content type'}; Forge takes PNG, JPG or WebP`);
	const dir = mkdtempSync(join(tmpdir(), 'forge-walkthrough-'));
	const file = join(dir, `photo${ext}`);
	writeFileSync(file, res.body);
	return file;
}

/** Put the photo into the first view slot, accept the on-device review, wait for the upload. */
async function uploadPhoto(page, file) {
	await page.locator('#tab-image').click();
	await page.locator('#view-file-input').setInputFiles(file);
	const deadline = Date.now() + PHOTO_PREP_TIMEOUT_MS;
	let reviewed = false;
	while (Date.now() < deadline) {
		const state = await page.evaluate(() => {
			const slot = document.querySelector('#image-pane .view-slot[data-state="uploaded"], #image-pane .view-slot[data-state="error"]');
			if (slot) return { slot: slot.dataset.state, message: slot.querySelector('.vs-error-msg')?.textContent?.trim() || '' };
			const use = document.querySelector('.pp-dialog button[value="use"]');
			return { review: !!use && use.getClientRects().length > 0 };
		});
		if (state.slot === 'uploaded') return { reviewed };
		if (state.slot === 'error') throw new Error(`the photo slot shows an error: ${state.message}`);
		if (state.review) {
			await page.locator('.pp-dialog button[value="use"]').click();
			reviewed = true;
		}
		await sleep(1000);
	}
	throw new Error(`the photo was not uploaded within ${PHOTO_PREP_TIMEOUT_MS / 60_000} minutes`);
}

function lastSubmit(cap) {
	return [...cap.posts].reverse().find((p) => p.body && ('job_id' in p.body || 'status' in p.body || 'error' in p.body)) || cap.posts.at(-1) || null;
}

/**
 * Press Generate (already filled in by the caller), wait for the result, and
 * apply the 429 rule: wait the stated time once, press Retry once.
 */
async function generateOnPage(page, cap, label) {
	const startedAt = Date.now();
	const responses = [];
	// Start from a clean capture so a second generation never reads the first
	// one's job or creation id.
	cap.posts.length = 0;
	cap.lastPoll = null;
	await page.locator('#generate').click();
	const beat = startHeartbeat(page, label, startedAt);
	try {
		let outcome = await waitForTerminalState(page, GENERATION_TIMEOUT_MS);
		let submit = lastSubmit(cap);
		if (outcome !== 'result' && submit && isThrottled(submit.status, submit.body)) {
			responses.push({ status: submit.status, body: submit.body });
			const wait = retryAfterSeconds(submit) ?? DEFAULT_WAIT_S;
			if (wait > MAX_STATED_WAIT_S) {
				return failed(`Forge answered 429 and asked for ${wait}s, longer than this run will wait`, { responses });
			}
			log(`  ${label}: Forge answered 429; waiting the stated ${wait}s once, then pressing Try again once`);
			await sleep(wait * 1000 + 1000);
			const postsBefore = cap.posts.length;
			await page.locator('#retry:not([disabled])').waitFor({ state: 'visible', timeout: 30_000 });
			await page.locator('#retry').click();
			// The old error panel stays up until the page switches to generating;
			// reading the outcome before that would just see the first 429 again.
			await page.waitForFunction(() => document.getElementById('state-error')?.classList.contains('is-hidden'), null, { timeout: 30_000 });
			outcome = await waitForTerminalState(page, GENERATION_TIMEOUT_MS);
			submit = cap.posts.length > postsBefore ? lastSubmit(cap) : submit;
			if (outcome !== 'result' && submit && isThrottled(submit.status, submit.body)) {
				responses.push({ status: submit.status, body: submit.body });
				return failed(`Forge answered 429 twice (waited ${wait}s between). The service is throttled right now.`, { responses });
			}
		}
		const evidence = {
			submit_status: submit?.status ?? null,
			job_id: submit?.body?.job_id ?? null,
			backend: cap.lastPoll?.body?.backend ?? submit?.body?.backend ?? null,
			cached: submit?.body?.cached === true,
			...(responses.length ? { throttled_responses: responses } : {}),
		};
		if (outcome !== 'result') {
			const panel = await readErrorPanel(page);
			const shown = outcome === 'unconfigured' ? panel.unconfigured : `${panel.title}. ${panel.message}`;
			return failed(`the page shows "${clip(shown, 220)}"`, {
				...evidence,
				page_state: outcome,
				submit_body: clip(submit?.body, 800),
				last_poll: clip(cap.lastPoll?.body, 800),
			});
		}
		const result = await page.evaluate(() => ({
			download: document.getElementById('download')?.href || '',
			viewerSrc: document.getElementById('viewer')?.getAttribute('src') || '',
		}));
		const done = cap.lastPoll?.body?.status === 'done' ? cap.lastPoll.body : submit?.body || {};
		const creationId = done.creation_id || submit?.body?.creation_id || null;
		const glbUrl = result.download || done.glb_url || result.viewerSrc;
		const data = { creationId, glbUrl, viewerSrc: result.viewerSrc };
		if (evidence.cached) {
			return failed('the result came from the forge cache, so no generation ran. Run again with a new --text prompt.', { ...evidence, creation_id: creationId, glb_url: glbUrl }, { data });
		}
		const secs = Math.round((Date.now() - startedAt) / 1000);
		return pass(`model ready in ${secs}s on ${evidence.backend || 'an unnamed engine'}${creationId ? `, creation ${creationId}` : ''}`, { ...evidence, creation_id: creationId, glb_url: glbUrl }, { data });
	} finally {
		clearInterval(beat);
	}
}

async function checkGlb(base, url) {
	if (!url) return failed('no model URL to download (the Download button has no link)');
	const abs = new URL(url, base).href;
	if (abs.startsWith('blob:')) return failed('the Download button points at a local blob, not a stored file');
	const res = await http(abs, { as: 'bytes', timeoutMs: 120_000 });
	if (!res.ok) return failed(`the model file answered HTTP ${res.status}`, { url: abs });
	const g = inspectGlb(res.body);
	const evidence = { url: abs, content_type: res.headers['content-type'] || '', ...g };
	if (!g.ok) return failed(g.reason, evidence);
	return pass(`${(g.bytes / 1024 / 1024).toFixed(2)} MB GLB, ${g.meshes} mesh${g.meshes === 1 ? '' : 'es'}, ${g.triangles.toLocaleString('en-US')} triangles`, evidence);
}

async function checkViewer(page, screenshotPath) {
	const settled = await page
		.waitForFunction(
			() => {
				const v = document.getElementById('viewer');
				if (v?.loaded === true) return true;
				const src = v?.getAttribute('src');
				return (window.__forgeViewerEvents || []).some((e) => e.type === 'error' && e.src === src);
			},
			null,
			{ timeout: VIEWER_LOAD_TIMEOUT_MS, polling: 1000 },
		)
		.then(() => true, () => false);
	const state = await page.evaluate(() => {
		const v = document.getElementById('viewer');
		if (!v) return null;
		const src = v.getAttribute('src') || '';
		return { src, loaded: v.loaded === true, events: (window.__forgeViewerEvents || []).filter((e) => e.src === src) };
	});
	if (!settled || !state?.loaded) return failed(explainViewerWait(state, VIEWER_LOAD_TIMEOUT_MS), state || {});
	const stats = await page.evaluate(async () => {
		const v = document.getElementById('viewer');
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		const url = v.toDataURL('image/png');
		const img = new Image();
		img.src = url;
		await img.decode();
		const w = 192;
		const h = Math.max(1, Math.round((w * img.height) / Math.max(1, img.width)));
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const ctx = c.getContext('2d');
		ctx.drawImage(img, 0, 0, w, h);
		const d = ctx.getImageData(0, 0, w, h).data;
		const bg = [d[0], d[1], d[2], d[3]];
		let changed = 0;
		const colours = new Set();
		for (let i = 0; i < d.length; i += 4) {
			const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) + Math.abs(d[i + 3] - bg[3]);
			if (diff > 24) changed += 1;
			colours.add(((d[i] >> 4) << 12) | ((d[i + 1] >> 4) << 8) | ((d[i + 2] >> 4) << 4) | (d[i + 3] >> 4));
		}
		return { width: img.width, height: img.height, changedFraction: changed / (w * h), distinctColors: colours.size, src: v.getAttribute('src') };
	});
	if (screenshotPath) await page.locator('#viewer').screenshot({ path: screenshotPath }).catch(() => {});
	const verdict = judgeCanvas(stats);
	const evidence = { ...stats, ...(screenshotPath ? { screenshot: screenshotPath } : {}) };
	if (verdict.blank) return failed(`the viewer looks blank: ${verdict.reason}`, evidence);
	return pass(`model drawn (${(stats.changedFraction * 100).toFixed(0)}% of the canvas, ${stats.distinctColors} colours)`, evidence);
}

async function checkShare(base, creationId) {
	if (!creationId) return failed('no creation id came back, so there is no share link to check');
	const pageUrl = `${base}/forge/share/${encodeURIComponent(creationId)}`;
	const sharePage = await http(pageUrl, { as: 'text' });
	if (sharePage.status !== 200) return failed(`the share page answered HTTP ${sharePage.status}`, { url: pageUrl });
	const og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(sharePage.body)?.[1]?.replace(/&amp;/g, '&');
	if (!og) return failed('the share page has no og:image preview', { url: pageUrl });
	const ogUrl = new URL(og, base).href;
	const ogImg = await http(ogUrl, { as: 'bytes', timeoutMs: 90_000 });
	const ogType = ogImg.headers['content-type'] || '';
	const cardUrl = `${base}/api/forge-og?id=${encodeURIComponent(creationId)}`;
	const card = await http(cardUrl, { as: 'bytes', timeoutMs: 90_000 });
	const cardType = card.headers['content-type'] || '';
	const evidence = {
		share_url: pageUrl,
		og_image: ogUrl,
		og_image_status: ogImg.status,
		og_image_type: ogType,
		og_image_bytes: ogImg.body?.length || 0,
		preview_card: cardUrl,
		preview_card_status: card.status,
		preview_card_type: cardType,
		preview_card_bytes: card.body?.length || 0,
	};
	const isImage = (r, t) => r.ok && /^image\//.test(t) && (r.body?.length || 0) > 1024;
	if (!isImage(ogImg, ogType)) return failed(`the share preview image answered HTTP ${ogImg.status} ${ogType}`, evidence);
	if (!isImage(card, cardType)) return failed(`the preview card (/api/forge-og) answered HTTP ${card.status} ${cardType}`, evidence);
	return pass(`share page 200, preview image ${Math.round(evidence.og_image_bytes / 1024)} KB, preview card ${Math.round(evidence.preview_card_bytes / 1024)} KB`, evidence);
}

async function checkCreations(base, cookie, creationId) {
	const url = `${base}/api/forge/mine?limit=24`;
	// The row is written when the job finalizes; a short second look covers a
	// slow write without ever looping.
	for (let attempt = 1; attempt <= 2; attempt++) {
		const res = await http(url, { cookie });
		if (res.status !== 200 || !Array.isArray(res.body?.models)) {
			return failed(`/api/forge/mine answered HTTP ${res.status}`, { body: clip(res.body, 400) });
		}
		const ids = res.body.models.map((m) => m.id);
		if (!creationId) return pass(`the account's creations list answers with ${ids.length} model${ids.length === 1 ? '' : 's'}`, { count: ids.length });
		if (ids.includes(creationId)) return pass(`creation ${creationId} is listed under the account's models`, { count: ids.length });
		if (attempt === 1) await sleep(10_000);
		else return failed(`creation ${creationId} is not in the account's 24 most recent models`, { newest: ids.slice(0, 5) });
	}
	return failed('unreachable');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const HELP = `Forge live walkthrough. Proves Forge works end to end as a signed-in user.

  --base <url>          site to test (default https://three.ws)
  --text "<prompt>"     make a model from this prompt (default when no flag: a fresh prompt)
  --photo <path|url>    also make a model from this photo (PNG, JPG or WebP)
  --skip-generate       check everything that needs no generation
  --out <file>          write a JSON report there (viewer screenshots go beside it)
  --headed              show the browser

Doc: docs/ops/forge-walkthrough.md`;

async function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`${err.message}\n\n${HELP}`);
		process.exit(2);
	}
	if (opts.help) {
		console.log(HELP);
		return;
	}

	const base = opts.base;
	const report = new Report();
	const startedAt = new Date();
	const shotBase = opts.out ? resolve(process.cwd(), opts.out).replace(/\.json$/i, '') : null;
	if (shotBase) mkdirSync(dirname(shotBase), { recursive: true });
	const plan = plannedGenerations(opts);
	if (plan.includes('text') && !opts.text) opts.text = freshPrompt();

	log(`Forge walkthrough against ${base}${plan.length ? `; generating: ${plan.join(', ')}` : '; no generation'}`);
	const version = await httpOnce(`${base}/api/version`).catch(() => null);
	const commit = version?.body?.commitShort || null;
	if (commit) log(`Site runs commit ${commit} (built ${version.body.builtAt || 'unknown'})`);

	// 1. Session
	let state = null;
	let cookie = '';
	const session = await report.run('session', 'Signed in as the QA user', async () => {
		if (!existsSync(AUTH_STATE)) return failed('no saved QA session. Run: npm run audit:web:login');
		state = JSON.parse(readFileSync(AUTH_STATE, 'utf8'));
		cookie = cookieHeader(state, 'https://three.ws');
		if (!cookie) return failed('the saved session has no three.ws cookie. Run: npm run audit:web:login');
		const me = await http(`${base}/api/auth/me`, { cookie });
		if (me.status !== 200 || !me.body?.user?.id) {
			return failed(`/api/auth/me answered HTTP ${me.status}; the session has expired. Run: npm run audit:web:login`, { body: clip(me.body, 300) });
		}
		return pass(`${me.body.user.email || me.body.user.id}`, { user_id: me.body.user.id, plan: me.body.user.plan });
	});

	// 2. Health and lane stats
	await report.run('health', 'Health and engine stats respond', async () => {
		const [health, stats] = await Promise.all([http(`${base}/api/forge?health=1`, { timeoutMs: 45_000 }), http(`${base}/api/nvidia/stats`, { timeoutMs: 45_000 })]);
		if (health.status !== 200 || !health.body?.backends) return failed(`/api/forge?health=1 answered HTTP ${health.status}`, { body: clip(health.body, 400) });
		if (stats.status !== 200 || !Array.isArray(stats.body?.lanes)) return failed(`/api/nvidia/stats answered HTTP ${stats.status}`, { body: clip(stats.body, 400) });
		const down = Object.values(health.body.backends)
			.filter((b) => b.status === 'down' || b.status === 'degraded')
			.map((b) => `${b.id}: ${b.message}`);
		// The LLM chain rewrites prompts ("direction"); generation still runs
		// without it, so it is a note, not a failure.
		const llm = health.body.llm || {};
		if (llm.overall && llm.overall !== 'ok') {
			const why = Object.entries(llm)
				.filter(([k, v]) => k !== 'overall' && v?.status === 'error')
				.map(([k, v]) => `${k} ${v.error}`)
				.join(', ');
			down.push(`prompt-direction LLM chain is ${llm.overall}${why ? ` (${why})` : ''}`);
		}
		const lanes = stats.body.lanes
			.map((l) => ({ id: l.id, w: l.jobs?.['7d'] }))
			.filter((l) => l.w)
			.map((l) => ({ id: l.id, done: l.w.done || 0, failed: l.w.failed || 0, success_pct: l.w.success_pct ?? null }));
		const busiest = [...lanes].sort((a, b) => b.done + b.failed - (a.done + a.failed))[0];
		return pass(
			`health says "${health.body.status}"${down.length ? `, ${down.length} part${down.length === 1 ? '' : 's'} down (see notes)` : ''}; busiest lane ${busiest ? `${busiest.id} at ${busiest.success_pct ?? 'n/a'}% over 7 days` : 'none'}`,
			{ health_status: health.body.status, down, lanes },
			{ warnings: down },
		);
	});

	const sessionOk = session.status === 'pass';
	const stageIds = (prefix) => [
		[`${prefix}.file`, 'model downloads as a valid 3D file'],
		[`${prefix}.viewer`, 'model shows in the viewer'],
		[`${prefix}.share`, 'share page and preview image work'],
	];

	let browser = null;
	let lockHeld = false;
	try {
		browser = await chromium.launch({ headless: !opts.headed, args: CHROMIUM_ARGS });
		const context = await browser.newContext({
			viewport: { width: 1366, height: 900 },
			...(state ? { storageState: scopeStorageState(state, base) } : {}),
		});
		await context.addInitScript(() => {
			// Record the viewer's own load, progress and error events, tagged with the
			// model they were for, so a timeout can say which of them happened.
			window.__forgeViewerEvents = [];
			const hook = () => {
				const v = document.getElementById('viewer');
				if (!v || v.__forgeWalkthroughHooked) return;
				v.__forgeWalkthroughHooked = true;
				const log = (type, detail) => {
					const list = window.__forgeViewerEvents;
					list.push({ type, detail, src: v.getAttribute('src') || '' });
					if (list.length > 200) list.splice(0, list.length - 200);
				};
				v.addEventListener('load', () => log('load', ''));
				v.addEventListener('error', (e) => log('error', JSON.stringify(e.detail ?? {}).slice(0, 300)));
				v.addEventListener('progress', (e) => log('progress', String(e.detail?.totalProgress ?? '')));
			};
			new MutationObserver(hook).observe(document, { childList: true, subtree: true });
		});
		const page = await context.newPage();
		const watch = watchPage(page);
		const cap = captureForgeApi(page);

		// 3. The page itself
		await report.run('page', 'Forge page loads cleanly', async () => {
			const mark = watch.mark();
			await openForge(page, base);
			await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
			const problems = watch.since(mark);
			if (problems.length) {
				return failed(`${problems.length} problem${problems.length === 1 ? '' : 's'} while loading: ${problems[0].text}`, { problems: problems.slice(0, 20) });
			}
			return pass('no console errors and no failed requests', { url: page.url() });
		});

		// 4. Generations, one at a time
		if (plan.length && !sessionOk) {
			for (const kind of plan) {
				report.skip(`${kind}.generate`, `${kind === 'text' ? 'Text prompt' : 'Photo'} makes a model`, 'skipped: not signed in, and Forge needs an account to generate');
			}
		}
		if (plan.length && sessionOk) {
			lockHeld = acquireLock();
			if (!lockHeld) {
				for (const kind of plan) {
					report.skip(`${kind}.generate`, `${kind === 'text' ? 'Text prompt' : 'Photo'} makes a model`, `skipped: another walkthrough is generating right now (lock ${LOCK_FILE})`);
				}
			}
		}
		const runs = lockHeld ? plan : [];
		for (const kind of runs) {
			const noun = kind === 'text' ? 'Text' : 'Photo';
			const gen = await report.run(`${kind}.generate`, `${noun === 'Text' ? 'Text prompt' : 'Photo'} makes a model`, async () => {
				const mark = watch.mark();
				if (kind === 'text') {
					await openForge(page, base);
					await page.locator('#prompt').fill(opts.text);
					log(`  prompt: ${opts.text}`);
				} else {
					await openForge(page, base);
					const file = await resolvePhoto(opts.photo);
					const up = await uploadPhoto(page, file);
					log(`  photo uploaded${up.reviewed ? ' after the on-device review' : ''}: ${basename(file)}`);
				}
				const out = await generateOnPage(page, cap, noun);
				const problems = watch.since(mark);
				if (problems.length) out.warnings = [...(out.warnings || []), ...problems.slice(0, 10).map((p) => p.text)];
				out.evidence = { ...out.evidence, input: kind === 'text' ? opts.text : opts.photo };
				return out;
			});
			if (gen.status !== 'pass' && !gen.data) {
				for (const [id, label] of stageIds(kind)) report.skip(id, `${noun} ${label}`, 'skipped: no model was made');
				report.skip(`${kind}.creations`, `${noun} model is listed under the account's creations`, 'skipped: no model was made');
				continue;
			}
			const { creationId, glbUrl } = gen.data;
			await report.run(`${kind}.file`, `${noun} model downloads as a valid 3D file`, () => checkGlb(base, glbUrl));
			await report.run(`${kind}.viewer`, `${noun} model shows in the viewer`, () => checkViewer(page, shotBase ? `${shotBase}-${kind}-viewer.png` : null));
			await report.run(`${kind}.share`, `${noun} share page and preview image work`, () => checkShare(base, creationId));
			await report.run(`${kind}.creations`, `${noun} model is listed under the account's creations`, () => checkCreations(base, cookie, creationId));
		}

		// 5. With no generation, check the same result stages on the newest public model.
		if (!plan.length) {
			const feed = await http(`${base}/api/forge-gallery?scope=community&limit=1`).catch((err) => ({ status: 0, body: { error: err.message } }));
			const sample = feed.body?.creations?.[0];
			if (!sample) {
				for (const [id, label] of stageIds('existing')) {
					await report.run(id, `Newest public ${label}`, async () => failed(`the community feed answered HTTP ${feed.status} with no model to check`, { body: clip(feed.body, 300) }));
				}
			} else {
				log(`  checking the newest public model: ${sample.id} (${sample.backend || 'unknown engine'})`);
				await report.run('existing.open', 'Newest public model opens on /forge', async () => {
					await openForge(page, base, `?share=${encodeURIComponent(sample.id)}`);
					const outcome = await waitForTerminalState(page, 90_000);
					if (outcome !== 'result') {
						const panel = await readErrorPanel(page);
						return failed(`the page shows "${clip(`${panel.title}. ${panel.message}`, 200)}"`, { creation_id: sample.id });
					}
					return pass(`creation ${sample.id} opened from its share link`, { creation_id: sample.id, backend: sample.backend });
				});
				const download = await page.evaluate(() => document.getElementById('download')?.href || '').catch(() => '');
				await report.run('existing.file', 'Newest public model downloads as a valid 3D file', () => checkGlb(base, download || sample.glb_url));
				await report.run('existing.viewer', 'Newest public model shows in the viewer', () => checkViewer(page, shotBase ? `${shotBase}-existing-viewer.png` : null));
				await report.run('existing.share', 'Newest public share page and preview image work', () => checkShare(base, sample.id));
			}
			if (sessionOk) await report.run('creations', "The account's creations list responds", () => checkCreations(base, cookie, null));
			else report.skip('creations', "The account's creations list responds", 'skipped: not signed in');
		}
	} finally {
		if (lockHeld) releaseLock();
		await browser?.close().catch(() => {});
	}

	const code = exitCodeFor(report.stages);
	const counts = ['pass', 'fail', 'skip'].map((s) => report.stages.filter((x) => x.status === s).length);
	console.log(`\nForge walkthrough, ${base}${commit ? ` (commit ${commit})` : ''}, ${startedAt.toISOString()}`);
	for (const s of report.stages) {
		console.log(summaryLine(s));
		for (const w of s.warnings) console.log(`      note: ${clip(w, 200)}`);
	}
	console.log(`\n${code === 0 ? 'FORGE OK' : 'FORGE NOT OK'}: ${counts[0]} passed, ${counts[1]} failed, ${counts[2]} skipped, ${((Date.now() - startedAt.getTime()) / 1000).toFixed(0)}s total`);

	if (opts.out) {
		const outPath = resolve(process.cwd(), opts.out);
		writeFileSync(
			outPath,
			`${JSON.stringify({ base, commit, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), ok: code === 0, prompt: opts.text, photo: opts.photo, stages: report.stages }, null, 2)}\n`,
		);
		console.log(`Report: ${outPath}`);
	}
	process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const release = () => releaseLock();
	process.on('SIGINT', () => {
		release();
		process.exit(130);
	});
	main().catch((err) => {
		release();
		console.error(`Forge walkthrough crashed: ${err?.stack || err}`);
		process.exit(1);
	});
}

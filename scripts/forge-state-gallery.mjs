#!/usr/bin/env node
/**
 * forge-state-gallery.mjs: drive /forge into every state it can show, screenshot
 * each one at desktop and phone width, and prove the console stays clean.
 *
 * A page is judged by its worst moment, and most of Forge's moments (throttled,
 * failed, storage down, offline mid-job, a model that will not load) never show
 * up on a happy-path click-through. This script forces each of them without
 * spending a generation: it answers /api/forge inside the browser with the exact
 * response shapes api/forge.js sends (page.route, test instrumentation only, the
 * product code is untouched), and lets every other call reach the real API
 * through the dev server's proxy.
 *
 * Per state and width it records:
 *   - a screenshot of the stage, scrolled into view
 *   - console errors and warnings, uncaught page errors, failed requests
 *   - cumulative layout shift since the page loaded (unexpected jumps only)
 *   - for the states marked `audit`: every visible control that has no visible
 *     :hover or :focus-visible change (forced through the DevTools protocol, so
 *     it reads the real cascade, inline <style> included)
 *
 * Safety: any POST to a generation or editing endpoint that a state did not
 * answer itself is aborted, so a bug in this script can never start a real job
 * or spend the shared editing budget. Nothing is ever paid for.
 *
 * Usage:
 *   npx vite --port 4160 --strictPort &                 # the dev server (any port)
 *   node scripts/forge-state-gallery.mjs                 # every state, 1440 and 390 wide
 *   node scripts/forge-state-gallery.mjs --base http://localhost:4160 --out /tmp/forge-states
 *   node scripts/forge-state-gallery.mjs --only throttled-account,finished
 *   node scripts/forge-state-gallery.mjs --list          # print the state ids and exit
 *   node scripts/forge-state-gallery.mjs --headed
 *
 * Signed-in states use the QA session in .auth/audit-state.json (refresh it with
 * `npm run audit:web:login`). On a localhost base the session cookie is attached
 * to /api requests so the dev proxy forwards it.
 *
 * Exit code 0 only when no state produced a console error, a console warning or
 * an uncaught exception from page code, and every state reached its screen.
 * Output: <out>/<state>@<width>.png plus <out>/report.json.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_STATE = resolve(ROOT, '.auth/audit-state.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = opt('base', 'http://localhost:4160').replace(/\/+$/, '');
const OUT = resolve(opt('out', join(tmpdir(), 'forge-state-gallery')));
const ONLY = opt('only', '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const WIDTHS = opt('widths', '1440,390')
	.split(',')
	.map((n) => Number(n))
	.filter((n) => n > 0);
const HEADED = flag('headed');

// Endpoints that start paid or rate-limited work. A POST to one of these that no
// state answered is aborted (see the header).
const GUARDED_POST = [
	'/api/forge',
	'/api/gpt-forge',
	'/api/forge-stylize',
	'/api/forge-remesh',
	'/api/forge-segment',
	'/api/forge-gameready',
	'/api/forge-iterate',
	'/api/forge-upload',
	'/api/forge-pay',
	'/api/x402',
];

// A real finished model from the public feed, read once at startup.
let FEED_MODEL = null;

// ── Response shapes (mirroring api/forge.js) ────────────────────────────────

const JOB_ID = 'gallery-job-0001';

function queuedSubmit(extra = {}) {
	return {
		job_id: JOB_ID,
		creation_id: null,
		status: 'queued',
		mode: 'text_to_3d',
		path: 'text',
		tier: 'standard',
		backend: 'trellis_selfhost',
		prompt: GALLERY_PROMPT,
		directed_prompt: null,
		reference_image_urls: [],
		cold_start: false,
		eta_seconds: 150,
		...extra,
	};
}

function poll(status, extra = {}) {
	return { status, backend: 'trellis_selfhost', elapsed_seconds: 12, ...extra };
}

const GALLERY_PROMPT = 'a brass desk lamp with a green glass shade, soft studio light';

const json = (status, body, headers = {}) => ({
	status,
	contentType: 'application/json',
	headers,
	body: JSON.stringify(body),
});

// ── Driving helpers ─────────────────────────────────────────────────────────

async function typePromptAndGenerate(page, prompt = GALLERY_PROMPT) {
	await page.fill('#prompt', prompt);
	await page.click('#generate');
}

const visible = (sel) => `${sel}:not(.is-hidden)`;

// ── States ──────────────────────────────────────────────────────────────────
//
// Each state: id, label, auth (signed in?), forge (answers /api/forge by method
// and query), drive (what the visitor does), ready (selector or function that
// proves the screen is up), shot (what to scroll into view), audit (run the
// hover/focus pass), expected (HTTP statuses this state forces on purpose).

const STATES = [
	{
		id: 'first-visit-signed-out',
		label: 'First visit, signed out',
		auth: false,
		ready: async (page) => page.waitForFunction(() => document.documentElement.dataset.forgeAccount === 'out'),
		shot: '.forge-main',
		audit: true,
	},
	{
		id: 'signed-out-generate',
		label: 'Signed out, presses Generate',
		auth: false,
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-error'),
		shot: '#stage',
	},
	{
		id: 'idle-signed-in',
		label: 'Signed in and idle',
		auth: true,
		ready: async (page) => page.waitForFunction(() => document.documentElement.dataset.forgeAccount === 'in'),
		shot: '.forge-main',
		audit: true,
	},
	{
		id: 'prompt-empty-submit',
		label: 'Generate pressed with an empty prompt',
		auth: true,
		drive: (page) => page.click('#generate'),
		ready: '#prompt-coach',
		shot: '#prompt',
	},
	{
		id: 'prompt-too-short',
		label: 'Generate pressed with a two-letter prompt',
		auth: true,
		drive: async (page) => {
			await page.fill('#prompt', 'ab');
			await page.click('#generate');
		},
		ready: '#prompt-coach',
		shot: '#prompt',
	},
	{
		id: 'prompt-at-limit',
		label: 'Prompt at the 1000 character limit',
		auth: true,
		drive: (page) => page.fill('#prompt', `a brass desk lamp ${'with fine engraved detail '.repeat(60)}`.slice(0, 1000)),
		ready: '#prompt-count',
		shot: '#prompt',
	},
	{
		id: 'submitting',
		label: 'Submitting (request still open)',
		auth: true,
		forge: { post: 'hang' },
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-generating'),
		shot: '#stage',
	},
	{
		id: 'stage-queued-cold',
		label: 'Waiting: queued behind a GPU cold start',
		auth: true,
		forge: {
			post: () => json(200, queuedSubmit({ cold_start: true, cold_start_seconds: 240, eta_seconds: 390 })),
			poll: () => json(200, poll('queued', { cold_start: true, cold_start_seconds: 240 })),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: async (page) => page.waitForSelector('#gen-warming:not(.is-hidden)', { timeout: 20_000 }),
		shot: '#stage',
	},
	{
		id: 'stage-queued-busy',
		label: 'Waiting: queued behind earlier jobs',
		auth: true,
		forge: {
			post: () => json(200, queuedSubmit()),
			poll: () => json(200, poll('queued')),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: async (page) => page.waitForSelector('#gen-note:not(.is-hidden)', { timeout: 30_000 }),
		shot: '#stage',
	},
	{
		id: 'stage-running',
		label: 'Waiting: building the mesh',
		auth: true,
		forge: {
			post: () => json(200, queuedSubmit({ status: 'running' })),
			poll: () => json(200, poll('running', { elapsed_seconds: 64 })),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: async (page) =>
			page.waitForFunction(() => document.querySelector('#gen-stages .step[data-state="active"]'), null, {
				timeout: 20_000,
			}),
		shot: '#stage',
	},
	{
		id: 'stage-failover',
		label: 'Waiting: moved to a backup engine',
		auth: true,
		forge: {
			post: () => json(200, queuedSubmit({ backend: 'pixal3d', path: 'image' })),
			poll: () => json(200, poll('running', { backend: 'trellis_selfhost', failover_from: 'hunyuan3d' })),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: async (page) => page.waitForSelector('#gen-note:not(.is-hidden)', { timeout: 20_000 }),
		shot: '#stage',
	},
	{
		id: 'offline-while-waiting',
		label: 'Offline while the job runs',
		auth: true,
		forge: {
			post: () => json(200, queuedSubmit({ status: 'running' })),
			poll: () => json(200, poll('running')),
		},
		drive: async (page, ctx) => {
			await typePromptAndGenerate(page);
			await page.waitForSelector(visible('#state-generating'));
			await ctx.setOffline(true);
		},
		ready: async (page) => page.waitForSelector('#gen-note:not(.is-hidden)', { timeout: 30_000 }),
		shot: '#stage',
		expectOfflineNoise: true,
	},
	{
		id: 'throttled-image-step',
		label: 'Throttled: reference image pacing',
		auth: true,
		expected: [429],
		forge: {
			post: () =>
				json(
					429,
					{
						error: 'rate_limited',
						queued: true,
						retry_after: 45,
						message: 'The reference image step is busy. Your request can run in 45 seconds.',
					},
					{ 'retry-after': '45' },
				),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-error'),
		shot: '#stage',
		audit: true,
	},
	{
		id: 'throttled-account',
		label: 'Throttled: account rate limit',
		auth: true,
		expected: [429],
		forge: {
			post: () =>
				json(
					429,
					{ error: 'rate_limited', message: 'Too many generations in a short time.', retry_after: 600 },
					{ 'ratelimit-limit': '10', 'ratelimit-reset': '600', 'retry-after': '600' },
				),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-error'),
		shot: '#stage',
	},
	{
		id: 'daily-limit',
		label: 'Daily limit reached',
		auth: true,
		expected: [429],
		forge: {
			post: () => json(429, { error: 'daily_limit_reached', message: 'You have used today’s generations.' }),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-error'),
		shot: '#stage',
	},
	{
		id: 'provider-outage',
		label: 'Provider outage (503)',
		auth: true,
		expected: [503],
		forge: {
			post: () =>
				json(503, {
					error: 'generation_unavailable',
					message: 'Every image provider is unavailable right now.',
					retry_after: 120,
				}),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-error'),
		shot: '#stage',
	},
	{
		id: 'storage-down',
		label: 'Object storage unavailable',
		auth: true,
		expected: [503],
		forge: { post: () => json(503, { error: 'storage_unavailable', retry_after: 90 }) },
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-error'),
		shot: '#stage',
	},
	{
		id: 'unconfigured',
		label: 'No engine configured',
		auth: true,
		expected: [503],
		forge: { post: () => json(503, { error: 'unconfigured' }) },
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-unconfigured'),
		shot: '#stage',
	},
	{
		id: 'job-failed',
		label: 'Job failed on the engine',
		auth: true,
		forge: {
			post: () => json(200, queuedSubmit({ status: 'running' })),
			poll: () => json(200, poll('failed', { error: 'The engine could not build a mesh from this image.' })),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: visible('#state-error'),
		shot: '#stage',
	},
	{
		id: 'lane-failed',
		label: 'Engine failed, other engines offered',
		auth: true,
		forge: {
			post: () => json(200, queuedSubmit({ status: 'running' })),
			poll: () =>
				json(
					200,
					poll('failed', {
						error: 'The engine hit a snag.',
						retryable: true,
						retry_backends: ['hunyuan3d', 'triposg'],
					}),
				),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: async (page) => page.waitForSelector('#error-lanes:not(.is-hidden)', { timeout: 30_000 }),
		shot: '#stage',
		audit: true,
	},
	{
		id: 'finished',
		label: 'Finished model in the viewer',
		auth: true,
		forge: {
			post: () => json(200, queuedSubmit({ status: 'running' })),
			poll: () => json(200, poll('done', { glb_url: FEED_MODEL, tier: 'standard', path: 'text' })),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: async (page) =>
			page.waitForFunction(
				() => {
					const s = document.getElementById('viewer-skeleton');
					return !document.getElementById('state-result')?.classList.contains('is-hidden') && s && getComputedStyle(s).opacity === '0';
				},
				null,
				{ timeout: 240_000 },
			),
		shot: '#stage',
		audit: true,
	},
	{
		id: 'viewer-load-failed',
		label: 'Finished, but the model file will not load',
		auth: true,
		expected: [404],
		forge: {
			post: () => json(200, queuedSubmit({ status: 'running' })),
			poll: () =>
				json(200, poll('done', { glb_url: `${BASE}/cdn/forge/gallery-missing-model.glb`, tier: 'standard' })),
		},
		drive: (page) => typePromptAndGenerate(page),
		ready: async (page) =>
			page.waitForFunction(
				() => {
					const e = document.getElementById('viewer-load-error');
					return e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
				},
				null,
				{ timeout: 60_000 },
			),
		shot: '#stage',
	},
];

// ── Instrumentation ─────────────────────────────────────────────────────────

// Layout shifts the visitor did not cause, summed (the CLS definition without
// session windows: stricter, which is what a state gallery wants).
const CLS_INIT = `
	window.__gallery = { cls: 0, shifts: [] };
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) {
				if (e.hadRecentInput) continue;
				window.__gallery.cls += e.value;
				if (e.value >= 0.01) {
					window.__gallery.shifts.push({
						value: Math.round(e.value * 1000) / 1000,
						at: Math.round(e.startTime),
						nodes: (e.sources || []).map((s) => {
							const n = s.node;
							if (!n || !n.nodeType) return '?';
							if (n.nodeType !== 1) return n.parentElement ? describe(n.parentElement) : '#text';
							return describe(n);
						}),
					});
				}
			}
		}).observe({ type: 'layout-shift', buffered: true });
	} catch {}
	function describe(el) {
		return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
	}
`;

// Console noise that is not page code: the software GL driver's performance
// advisories (see docs/ops/page-audit.md) and Chromium's own network log line,
// which is judged by the request it names instead (failed requests below).
function classifyConsole(msg) {
	const text = msg.text();
	if (/GL Driver Message \(OpenGL, Performance/i.test(text)) return 'ignore';
	if (/^Failed to load resource/i.test(text)) return 'network';
	const url = msg.location()?.url || '';
	if (url && !url.startsWith(BASE) && !url.startsWith('https://three.ws')) return 'third-party';
	return 'page';
}

// Every visible control in the Forge main column that shows no change on a
// forced :hover or :focus-visible. Compares the element and its first few
// descendants, because many controls style an icon or label on hover.
async function auditInteractiveStates(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('DOM.enable');
	await cdp.send('CSS.enable');
	const props = [
		'background-color',
		'background-image',
		'color',
		'border-top-color',
		'border-bottom-color',
		'box-shadow',
		'outline-style',
		'outline-color',
		'text-decoration-line',
		'opacity',
		'transform',
		'filter',
		'fill',
		'stroke',
	];
	const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
	const sel =
		'.forge-main button:not([disabled]), .forge-main a[href], .forge-main summary, .forge-main [role="button"], .forge-main [role="tab"], .forge-main input[type="checkbox"], .forge-main select';
	const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: sel });
	const gaps = [];
	const snapshot = async (nodeId) => {
		const out = [];
		const ids = [nodeId];
		try {
			const { nodeIds: kids } = await cdp.send('DOM.querySelectorAll', { nodeId, selector: '*' });
			ids.push(...kids.slice(0, 4));
		} catch {}
		for (const id of ids) {
			try {
				const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId: id });
				const m = Object.fromEntries(computedStyle.map((p) => [p.name, p.value]));
				out.push(props.map((p) => m[p]).join('|'));
			} catch {}
		}
		return out.join('||');
	};
	for (const nodeId of nodeIds) {
		const { object } = await cdp.send('DOM.resolveNode', { nodeId });
		const { result } = await cdp.send('Runtime.callFunctionOn', {
			objectId: object.objectId,
			returnByValue: true,
			functionDeclaration: `function () {
				const r = this.getBoundingClientRect();
				const cs = getComputedStyle(this);
				const shown = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !this.closest('[hidden], .is-hidden');
				const label = (this.getAttribute('aria-label') || this.textContent || this.id || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
				const name = this.tagName.toLowerCase() + (this.id ? '#' + this.id : '') + (this.classList.length ? '.' + [...this.classList].slice(0, 2).join('.') : '');
				return { shown, label, name };
			}`,
		});
		const info = result.value;
		if (!info?.shown) continue;
		const base = await snapshot(nodeId);
		const missing = [];
		for (const state of ['hover', 'focus-visible']) {
			await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [state] });
			const forced = await snapshot(nodeId);
			await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
			if (forced === base) missing.push(state);
		}
		if (missing.length) gaps.push({ control: info.name, label: info.label, missing });
	}
	await cdp.detach();
	return gaps;
}

// ── Runner ──────────────────────────────────────────────────────────────────

function sessionCookieHeader() {
	if (!existsSync(AUTH_STATE)) return null;
	const state = JSON.parse(readFileSync(AUTH_STATE, 'utf8'));
	const cookies = (state.cookies || []).filter((c) => c.domain.includes('three.ws'));
	return cookies.length ? cookies.map((c) => `${c.name}=${c.value}`).join('; ') : null;
}

async function runState(browser, state, width, cookieHeader) {
	const height = width < 600 ? 844 : 900;
	const ctx = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		isMobile: width < 600,
		hasTouch: width < 600,
		...(state.auth && BASE.startsWith('https://three.ws') && existsSync(AUTH_STATE) ? { storageState: AUTH_STATE } : {}),
	});
	await ctx.addInitScript(CLS_INIT);
	const page = await ctx.newPage();
	const record = { state: state.id, label: state.label, width, console: [], pageErrors: [], failed: [], expectedHttp: [] };

	page.on('console', (msg) => {
		const type = msg.type();
		if (type !== 'error' && type !== 'warning') return;
		const kind = classifyConsole(msg);
		if (kind === 'ignore' || kind === 'network') return;
		record.console.push({ type, kind, text: msg.text().slice(0, 400), at: msg.location()?.url || '' });
	});
	page.on('pageerror', (err) => record.pageErrors.push(String(err?.stack || err).slice(0, 600)));
	page.on('requestfailed', (req) => {
		const why = req.failure()?.errorText || '';
		// Aborted by this script's own guard, or a request the browser dropped
		// because the page navigated or the state went offline on purpose.
		if (req.__galleryAborted) return;
		if (state.expectOfflineNoise && /INTERNET_DISCONNECTED/.test(why)) return;
		if (/ERR_ABORTED/.test(why)) return;
		record.failed.push({ url: req.url().slice(0, 200), why });
	});
	page.on('response', (res) => {
		const status = res.status();
		if (status < 400) return;
		const url = res.url();
		const expected = (state.expected || []).includes(status);
		// x402 endpoints answer 402 to a browser that does not pay (page-audit rule).
		const paymentGated = status === 402 && url.includes('/api/');
		(expected || paymentGated ? record.expectedHttp : record.failed).push({ url: url.slice(0, 200), status });
	});

	// Earliest-registered route runs last: the session and the safety guard sit
	// underneath every state's own answers.
	await page.route('**/api/**', async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (req.method() === 'POST' && GUARDED_POST.some((p) => path === p || path.startsWith(`${p}/`))) {
			req.__galleryAborted = true;
			record.console.push({ type: 'guard', kind: 'gallery', text: `blocked an unforced POST ${path}` });
			return route.abort('blockedbyclient');
		}
		if (state.auth && cookieHeader && !BASE.startsWith('https://three.ws')) {
			return route.continue({ headers: { ...req.headers(), cookie: cookieHeader } });
		}
		if (!state.auth && !BASE.startsWith('https://three.ws')) {
			const headers = { ...req.headers() };
			delete headers.cookie;
			return route.continue({ headers });
		}
		return route.continue();
	});

	if (state.forge) {
		await page.route(/\/api\/forge(\?.*)?$/, async (route) => {
			const req = route.request();
			const u = new URL(req.url());
			if (u.pathname !== '/api/forge') return route.fallback();
			if (req.method() === 'POST' && state.forge.post) {
				if (state.forge.post === 'hang') return; // the request stays open: the submitting state
				return route.fulfill(state.forge.post(req));
			}
			if (req.method() === 'GET' && u.searchParams.has('job') && state.forge.poll) {
				return route.fulfill(state.forge.poll(req));
			}
			return route.fallback();
		});
	}

	let reached = true;
	let readyError = null;
	try {
		await page.goto(`${BASE}/forge`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		// The composer is live once the catalog has built the engine buttons and the
		// account probe has answered.
		await page.waitForFunction(
			() => document.querySelector('#engine button') && document.documentElement.dataset.forgeAccount,
			null,
			{ timeout: 45_000 },
		);
		if (state.drive) await state.drive(page, ctx);
		if (typeof state.ready === 'function') await state.ready(page);
		else if (state.ready) await page.waitForSelector(state.ready, { timeout: 30_000 });
		// Let the frame that follows the signal paint (fonts, the stage swap).
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	} catch (err) {
		reached = false;
		readyError = String(err?.message || err).split('\n')[0];
	}

	try {
		const target = page.locator(state.shot || '#stage').first();
		await target.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
		record.screenshot = join(OUT, `${state.id}@${width}.png`);
		await page.screenshot({ path: record.screenshot });
	} catch (err) {
		record.screenshot = null;
		record.screenshotError = String(err?.message || err).split('\n')[0];
	}

	const visibleText = await page
		.evaluate(() => {
			const pick = (id) => {
				const el = document.getElementById(id);
				return el && !el.classList.contains('is-hidden') && !el.closest('.is-hidden') ? el.innerText.trim().replace(/\s+/g, ' ').slice(0, 500) : null;
			};
			return {
				error: pick('state-error'),
				note: pick('gen-note'),
				coach: document.getElementById('prompt-coach')?.textContent?.trim() || null,
				promptInvalid: document.getElementById('prompt')?.getAttribute('aria-invalid') || null,
				count: document.getElementById('prompt-count')?.textContent?.trim() || null,
				generating: pick('state-generating'),
			};
		})
		.catch(() => ({}));
	record.text = visibleText;
	const g = await page.evaluate(() => window.__gallery).catch(() => null);
	record.cls = g ? Math.round(g.cls * 1000) / 1000 : null;
	record.shifts = g?.shifts || [];
	if (state.audit && reached) {
		record.interactiveGaps = await auditInteractiveStates(page).catch((err) => [{ control: 'audit', label: String(err.message), missing: [] }]);
	}
	record.reached = reached;
	if (readyError) record.readyError = readyError;
	await ctx.setOffline(false).catch(() => {});
	await ctx.close();
	return record;
}

async function main() {
	if (flag('list')) {
		for (const s of STATES) console.log(`${s.id.padEnd(26)} ${s.label}`);
		return;
	}
	mkdirSync(OUT, { recursive: true });
	const cookieHeader = sessionCookieHeader();
	if (!cookieHeader) console.warn('No QA session at .auth/audit-state.json: signed-in states will show signed out. Run `npm run audit:web:login`.');

	const feed = await fetch('https://three.ws/api/forged?limit=12').then((r) => r.json());
	FEED_MODEL = (feed.props || []).find((p) => p.status === 'done' && p.glb_url)?.glb_url;
	if (!FEED_MODEL) throw new Error('The public feed returned no finished model to show in the viewer.');

	const browser = await chromium.launch({
		headless: !HEADED,
		args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
	});
	const states = ONLY.length ? STATES.filter((s) => ONLY.includes(s.id)) : STATES;
	const records = [];
	for (const state of states) {
		for (const width of WIDTHS) {
			const r = await runState(browser, state, width, cookieHeader);
			records.push(r);
			const pageNoise = r.console.filter((c) => c.kind === 'page' || c.kind === 'gallery').length + r.pageErrors.length;
			const gaps = r.interactiveGaps?.length ? ` gaps=${r.interactiveGaps.length}` : '';
			console.log(
				`${r.reached ? 'ok  ' : 'MISS'} ${state.id.padEnd(26)} @${String(width).padEnd(4)} console=${pageNoise} failed=${r.failed.length} cls=${r.cls}${gaps}${r.readyError ? `  (${r.readyError})` : ''}`,
			);
		}
	}
	await browser.close();
	writeFileSync(join(OUT, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), model: FEED_MODEL, records }, null, 2));

	const dirty = records.filter((r) => r.console.some((c) => c.kind === 'page' || c.kind === 'gallery') || r.pageErrors.length);
	const missed = records.filter((r) => !r.reached);
	console.log(`\n${records.length} screens in ${OUT}`);
	if (dirty.length) {
		console.log(`\nConsole errors or warnings from page code in ${dirty.length} screen(s):`);
		for (const r of dirty) {
			for (const c of r.console.filter((x) => x.kind === 'page' || x.kind === 'gallery')) console.log(`  ${r.state}@${r.width} ${c.type}: ${c.text}`);
			for (const e of r.pageErrors) console.log(`  ${r.state}@${r.width} pageerror: ${e.split('\n')[0]}`);
		}
	}
	if (missed.length) console.log(`\nScreens that never appeared: ${missed.map((r) => `${r.state}@${r.width}`).join(', ')}`);
	process.exitCode = dirty.length || missed.length ? 1 : 0;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

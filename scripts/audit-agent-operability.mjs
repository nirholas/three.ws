#!/usr/bin/env node
/**
 * Agent-operability audit: can a computer-use agent (Grok Bot, Claude in
 * Chrome, any Playwright-driven model) finish the primary task on our key
 * pages using only what a screen reader exposes?
 *
 * Two layers:
 *
 *   1. Flows. For /create, /forge, /connect, an agent profile and /launch the
 *      script completes the page's primary task through `getByRole` and
 *      `getByLabel` only. The flow helpers below expose no other locator, so a
 *      step that needs a CSS selector, a hover or a coordinate click cannot be
 *      written: it fails, and the failure is the finding. Each long wait is
 *      sampled for a visible status message (role=status/alert, aria-live,
 *      progressbar, aria-busy); a wait with none is a "silent wait".
 *
 *   2. Page scans. Every audited page is scanned for what flows cannot reach:
 *      controls with no accessible name, clickable elements that are neither
 *      semantic nor focusable, menus revealed only by :hover, and canvases
 *      with no text alternative.
 *
 * Read-only: /launch stops at the confirmation screen and asserts it renders,
 * it never signs or submits anything that spends.
 *
 * Usage (dev server must be up: `npm run dev`):
 *   node scripts/audit-agent-operability.mjs                 # print the report
 *   node scripts/audit-agent-operability.mjs --label after   # also record it
 *     in prompts/x-grok/_generated/operability.json under "after"
 *   BASE_URL=https://three.ws node scripts/audit-agent-operability.mjs
 *   --wait-generate <seconds>   how long /forge may take to finish (default 240)
 *   --strict                    exit 1 when any finding remains
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const EVIDENCE = resolve(ROOT, 'prompts/x-grok/_generated/operability.json');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LABEL = opt('label', '');
const STRICT = argv.includes('--strict');
const GENERATE_WAIT_MS = Number(opt('wait-generate', '240')) * 1000;

/**
 * In-page: the first visible status message (live region, alert, progress bar,
 * busy marker) that was not already on screen when the flow started. A page
 * that always shows a static hint in a live region must not make every wait
 * look narrated, so the baseline is subtracted. Returns '' when nothing new
 * is announced.
 */
function readVisibleStatus(baseline) {
	const visible = (el) => {
		const r = el.getBoundingClientRect();
		const s = getComputedStyle(el);
		return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
	};
	const sel =
		'[role=status],[role=alert],[aria-live]:not([aria-live=off]),[role=progressbar],progress,[aria-busy=true]';
	for (const el of document.querySelectorAll(sel)) {
		if (!visible(el)) continue;
		if (el.matches('[role=progressbar],progress')) return 'progressbar';
		const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
		if (text && !baseline.includes(text)) return text;
		if (!text && el.matches('[aria-busy=true]')) return 'busy';
	}
	return '';
}

/** In-page: every status text currently visible, used as the baseline. */
function readAllStatusTexts() {
	const out = [];
	for (const el of document.querySelectorAll('[role=status],[role=alert],[aria-live]:not([aria-live=off])')) {
		const r = el.getBoundingClientRect();
		const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
		if (r.width > 0 && r.height > 0 && text) out.push(text);
	}
	return out;
}

/** In-page scan for what role/label flows cannot see. */
function scanPage() {
	const visible = (el) => {
		const r = el.getBoundingClientRect();
		const s = getComputedStyle(el);
		return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
	};
	const describe = (el) =>
		el.tagName.toLowerCase() +
		(el.id ? `#${el.id}` : '') +
		(typeof el.className === 'string' && el.className.trim()
			? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
			: '');
	const nameOf = (el) => {
		const aria = (el.getAttribute('aria-label') || '').trim();
		if (aria) return aria;
		const by = el.getAttribute('aria-labelledby');
		if (by) {
			const t = by
				.split(/\s+/)
				.map((id) => document.getElementById(id)?.textContent || '')
				.join(' ')
				.trim();
			if (t) return t;
		}
		if (el.labels && el.labels.length) {
			const t = [...el.labels].map((l) => l.textContent).join(' ').trim();
			if (t) return t;
		}
		const text = (el.innerText || el.textContent || '').trim();
		if (text) return text;
		const img = el.querySelector('img[alt]:not([alt=""]),svg title');
		if (img) return img.alt || img.textContent || '';
		return (el.getAttribute('title') || el.getAttribute('alt') || '').trim();
	};
	const inHidden = (el) => !!el.closest('[aria-hidden=true],[inert]');
	const focusable =
		'button,a[href],input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[role=button],[role=link],[role=tab],[role=checkbox],[role=switch],[role=menuitem],[role=radio],[role=combobox],[role=slider]';

	const unnamed = [];
	for (const el of document.querySelectorAll(focusable)) {
		if (!visible(el) || inHidden(el)) continue;
		if (!nameOf(el)) unnamed.push(describe(el));
	}

	// Name quality. A model locates a control by the words it can see, so the visible
	// text must appear inside the accessible name (WCAG 2.5.3), a name must not drift
	// as the user types (a live counter inside a label), and a name needs real words.
	const nameQuality = [];
	const squash = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
	for (const el of document.querySelectorAll(focusable)) {
		if (!visible(el) || inHidden(el)) continue;
		const accessible = nameOf(el);
		if (!accessible) continue;
		const where = `${describe(el)} :: ${accessible.slice(0, 50)}`;
		if (!/[\p{L}\p{N}]/u.test(accessible)) {
			nameQuality.push({ kind: 'symbol-only-name', where });
			continue;
		}
		if (/\b\d+\s*\/\s*\d+\b/.test(accessible) && el.matches('input,textarea,select')) {
			nameQuality.push({ kind: 'volatile-name', where });
		}
		const hasExplicitName = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
		if (!hasExplicitName || el.getAttribute('role') === 'tabpanel') continue;
		// The first visible line is the label a model reads; every word of it must
		// appear in the accessible name (order-free, so a longer description is fine).
		const firstLine = (el.innerText || '').split('\n').map(squash).find(Boolean) || '';
		const nameWords = new Set(squash(accessible).split(' '));
		const missing = firstLine.split(' ').filter((w) => w.length > 1 && !nameWords.has(w));
		if (missing.length) {
			nameQuality.push({ kind: 'label-not-in-name', where: `${where} (visible: ${firstLine.slice(0, 30)}; missing: ${missing.join(' ')})` });
		}
	}

	const pointerOnly = [];
	const skip = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY|OPTION|LABEL|HTML|BODY|SCRIPT|STYLE|CANVAS|VIDEO|IMG|SVG|PATH|G|USE)$/i;
	for (const el of document.querySelectorAll('body *')) {
		if (skip.test(el.tagName) || !visible(el) || inHidden(el)) continue;
		// cursor inherits, so only an element that sets it differently from its parent counts.
		const own = getComputedStyle(el).cursor === 'pointer' && getComputedStyle(el.parentElement).cursor !== 'pointer';
		const clickable = own || el.hasAttribute('onclick');
		if (!clickable) continue;
		if (el.closest(focusable) || el.closest('label')) continue;
		// A pointer shortcut over real controls is fine (the card click mirrors a button
		// inside it). A dismiss or close control alone does not make the surface operable.
		const equivalents = [...el.querySelectorAll(focusable)].filter((c) => !/^(dismiss|close|x|\u00d7)$/i.test(nameOf(c)));
		if (equivalents.length) continue;
		pointerOnly.push(`${describe(el)} :: ${(el.innerText || '').trim().slice(0, 40).replace(/\n/g, ' ')}`);
	}

	const canvases = [];
	for (const c of document.querySelectorAll('canvas')) {
		if (!visible(c) || inHidden(c)) continue;
		if (c.getAttribute('aria-label') || c.getAttribute('role') === 'img' || c.getAttribute('role') === 'presentation') continue;
		if (c.textContent && c.textContent.trim()) continue;
		canvases.push(describe(c));
	}

	// Hover-only reveals: a stylesheet rule that shows something under :hover with
	// no :focus-within / :focus / aria-expanded rule for the same trigger.
	const hoverOnly = [];
	const showing = /(display\s*:\s*(block|flex|grid)|visibility\s*:\s*visible|opacity\s*:\s*1\b|pointer-events\s*:\s*auto)/;
	const allRules = [];
	const walk = (rules) => {
		for (const r of rules) {
			if (r.cssRules && !r.selectorText) walk(r.cssRules);
			else if (r.selectorText) allRules.push(r);
		}
	};
	for (const sheet of document.styleSheets) {
		try {
			walk(sheet.cssRules);
		} catch {
			// cross-origin stylesheet: not ours to audit
		}
	}
	const selectors = allRules.map((r) => r.selectorText);
	for (const r of allRules) {
		if (!r.selectorText.includes(':hover') || !showing.test(r.style.cssText)) continue;
		for (const sel of r.selectorText.split(',')) {
			if (!sel.includes(':hover')) continue;
			const m = sel.trim().match(/^(.*?):hover\s+(.+)$/);
			if (!m) continue; // a self-hover restyle shows nothing new
			const trigger = m[1].trim();
			const keyboardTwin = selectors.some(
				(s) =>
					s.includes(trigger) &&
					/:focus-within|:focus-visible|:focus|\[aria-expanded|\.open|\.is-open|\.active/.test(s),
			);
			if (keyboardTwin) continue;
			try {
				if (!document.querySelector(trigger)) continue;
				const target = document.querySelector(sel.replace(/:hover/g, ''));
				if (!target) continue;
				const cs = getComputedStyle(target);
				const hiddenAtRest = cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
				if (!hiddenAtRest) continue; // a restyle on hover, not a reveal
			} catch {
				continue;
			}
			hoverOnly.push(sel.trim().slice(0, 120));
		}
	}
	return { unnamed, nameQuality, pointerOnly: pointerOnly.slice(0, 20), canvases, hoverOnly: [...new Set(hoverOnly)].slice(0, 20) };
}

/**
 * Flow helper. Exposes role and label locators only; every action is logged so
 * the report shows exactly what a model would have to do.
 */
function makeFlow(page, flow) {
	const log = flow.steps;
	const run = async (label, locatorKind, fn) => {
		const started = Date.now();
		try {
			const out = await fn();
			log.push({ step: label, via: locatorKind, ok: true, ms: Date.now() - started });
			return out;
		} catch (err) {
			const message = String(err.message).split('\n')[0].slice(0, 200);
			log.push({ step: label, via: locatorKind, ok: false, error: message });
			flow.findings.push({ kind: 'step-failed', where: label, detail: message });
			throw err;
		}
	};
	const role = (r, name, o = {}) => page.getByRole(r, { name, ...o }).first();
	return {
		role,
		async click(r, name, o) {
			return run(`click ${r} ${name}`, 'getByRole', () => role(r, name, o).click({ timeout: 8000 }));
		},
		async check(r, name, o) {
			return run(`check ${r} ${name}`, 'getByRole', () => role(r, name, o).check({ timeout: 8000 }));
		},
		async fillByLabel(label, value) {
			return run(`fill label ${label}`, 'getByLabel', () =>
				page.getByLabel(label, { exact: false }).first().fill(value, { timeout: 8000 }),
			);
		},
		async fillRole(r, name, value) {
			return run(`fill ${r} ${name}`, 'getByRole', () => role(r, name).fill(value, { timeout: 8000 }));
		},
		async expectRole(r, name, o) {
			return run(`see ${r} ${name}`, 'getByRole', () =>
				role(r, name, o).waitFor({ state: 'visible', timeout: 10000 }),
			);
		},
		async expectUrl(re) {
			return run(`url matches ${re}`, 'page.url', () => page.waitForURL(re, { timeout: 10000 }));
		},
		async expectStatusAfter(label, action, windowMs = 2500) {
			return run(`status visible after ${label}`, 'aria-live', async () => {
				await action();
				const deadline = Date.now() + windowMs;
				let seen = '';
				while (Date.now() < deadline && !seen) {
					seen = await page.evaluate(readVisibleStatus, flow.baseline);
					if (!seen) await page.waitForTimeout(150);
				}
				if (!seen) {
					flow.findings.push({ kind: 'silent-wait', where: label, detail: `no visible status within ${windowMs}ms` });
					throw new Error(`no visible status message within ${windowMs}ms of ${label}`);
				}
				return seen;
			});
		},
	};
}

/** Sample a long wait: poll for done(), recording stretches with no visible status. */
async function watchLongWait(page, flow, label, done, budgetMs) {
	const started = Date.now();
	let silentSamples = 0;
	let samples = 0;
	let lastStatus = '';
	while (Date.now() - started < budgetMs) {
		if (await done()) break;
		const status = await page.evaluate(readVisibleStatus, flow.baseline);
		samples += 1;
		if (!status) silentSamples += 1;
		else lastStatus = status;
		await page.waitForTimeout(1000);
	}
	const finished = await done();
	flow.waits.push({ label, samples, silentSamples, lastStatus, finished, ms: Date.now() - started });
	if (silentSamples > 2) {
		flow.findings.push({
			kind: 'silent-wait',
			where: label,
			detail: `${silentSamples} of ${samples} one-second samples had no visible status message`,
		});
	}
	return finished;
}

const FLOWS = [
	{
		id: 'create',
		path: '/create',
		task: 'Choose the 3D model path from the creation hub, then the describe-an-avatar path',
		async run(page, f, flow) {
			await f.expectRole('heading', /What do you want to create/i);
			await f.expectRole('link', /Build an AI agent/i);
			await f.expectRole('link', /Launch a token world/i);
			await f.click('link', /Make a 3D avatar/i);
			await f.expectRole('button', /Describe an avatar in words/i);
			await f.expectRole('button', /Upload a GLB file/i);
			await f.click('button', /Describe an avatar in words/i);
			await f.expectUrl(/\/create\/prompt|\/login\?next=%2Fcreate%2Fprompt/);
			await f.expectRole('heading', /./, { level: 1 });
			void flow;
		},
	},
	{
		id: 'forge',
		path: '/forge',
		task: 'Describe an object, press Generate, follow the visible status to a finished model',
		async run(page, f, flow) {
			await f.expectRole('heading', /Forge/i, { level: 1 });
			await f.click('tab', /Describe it/i);
			await f.fillRole('textbox', /Describe the object to generate/i, 'a tall ceramic vase, matte terracotta');
			await f.expectStatusAfter('Generate', () => f.click('button', /^Generate$/));
			const finished = await watchLongWait(
				page,
				flow,
				'forge generation',
				async () => !(await page.getByRole('button', { name: /^Cancel$/ }).first().isVisible().catch(() => false)),
				GENERATE_WAIT_MS,
			);
			const last = await page.evaluate(readVisibleStatus, flow.baseline);
			if (!finished) flow.notes.push(`generation still running at the ${GENERATE_WAIT_MS / 1000}s budget; last status: ${last || 'none'}`);
			else flow.notes.push(`generation settled; last status: ${last || 'none'}`);
		},
	},
	{
		id: 'connect',
		path: '/connect',
		task: 'Pick the free studio server, read its URL, copy it, open the Grok Bot setup, mint a connector URL',
		async run(page, f) {
			await f.expectRole('heading', /One URL/i, { level: 1 });
			await f.check('radio', /3D Studio \(free\)/i);
			await f.expectRole('button', /Copy URL/i);
			await f.expectStatusAfter('Copy URL', () => f.click('button', /Copy URL/i), 2000);
			await f.click('tab', /Grok Bot/i);
			await f.expectRole('tabpanel', /Grok Bot/i);
			await f.expectStatusAfter('Generate my connector URL', () => f.click('button', /Generate my connector URL/i), 6000);
		},
	},
	{
		id: 'agent-profile',
		path: '/agents',
		task: 'Search the agent index, open an agent profile, find its sign-in and create paths',
		async run(page, f) {
			await f.expectRole('heading', /Agent Index/i, { level: 1 });
			await f.expectRole('searchbox', /Search agents/i);
			await f.expectRole('link', /\.agent|Agent #/i);
			await f.fillRole('searchbox', /Search agents/i, 'agent');
			await f.click('link', /\.agent|Agent #/i);
			await f.expectUrl(/\/a\/\d+\/\d+/);
			await f.expectRole('heading', /./, { level: 1 });
			await f.expectRole('link', /Sign in/i);
			await f.expectRole('link', /Generate from text/i);
		},
	},
	{
		id: 'launch',
		path: '/launch',
		task: 'Fill in the coin form and reach the launch confirmation without signing',
		async run(page, f) {
			await f.expectRole('heading', /Launch a coin for your agent/i, { level: 1 });
			await f.click('tab', /My coins/i);
			await f.expectRole('tabpanel', /My coins/i);
			await f.click('tab', /^Create$/i);
			await f.fillRole('textbox', /Coin name/i, 'Operability Test');
			await f.fillRole('textbox', /Ticker/i, 'OPTEST');
			await f.check('radio', /Agent's wallet/i);
			await f.click('button', /0\.5 SOL/i);
			await f.expectRole('button', /0\.5 SOL/i, { pressed: true });
			await f.expectRole('complementary', /Launch preview/i);
			await f.expectRole('button', /Sign in to launch|Launch/i);
		},
	},
];

async function runFlow(browser, def) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await context.newPage();
	if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL)) {
		// `vite dev` proxies /api to production, which would audit the deployed
		// copy strings instead of the working tree. Serve the locale slices from the
		// repo's own handler so the audit sees the labels this checkout ships.
		const { sliceFor } = await import('../api/locale.js');
		await context.route('**/api/locale?*', (route) => {
			const q = new URL(route.request().url()).searchParams;
			const body = sliceFor(q.get('code') || 'en', (q.get('ns') || '').split(',').filter(Boolean));
			return body === null
				? route.continue()
				: route.fulfill({ status: 200, contentType: 'application/json', body });
		});
	}
	const flow = { baseline: [], id: def.id, path: def.path, task: def.task, ok: false, steps: [], waits: [], notes: [], findings: [], consoleErrors: [], failedRequests: [], scan: null };
	page.on('console', (m) => {
		if (m.type() === 'error') flow.consoleErrors.push(m.text().slice(0, 200));
	});
	page.on('response', (r) => {
		if (r.status() >= 400) flow.failedRequests.push(`${r.status()} ${r.url().slice(0, 140)}`);
	});
	page.on('pageerror', (e) => flow.consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
	try {
		await page.goto(BASE_URL + def.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
		await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
		await page.waitForTimeout(2500); // late-mounted widgets (corner chips, nav, footer) settle first
		const scanned = await page.evaluate(scanPage);
		flow.scan = scanned;
		flow.baseline = await page.evaluate(readAllStatusTexts);
		for (const name of scanned.unnamed) flow.findings.push({ kind: 'unnamed-control', where: name, detail: 'visible control with no accessible name' });
		for (const q of scanned.nameQuality) flow.findings.push({ kind: q.kind, where: q.where, detail: 'accessible name does not match what a model reads on screen' });
		for (const name of scanned.pointerOnly) flow.findings.push({ kind: 'pointer-only', where: name, detail: 'clickable element that is not focusable and has no role' });
		for (const name of scanned.hoverOnly) flow.findings.push({ kind: 'hover-only', where: name, detail: 'revealed on :hover with no keyboard or click equivalent' });
		for (const name of scanned.canvases) flow.findings.push({ kind: 'canvas-no-alt', where: name, detail: 'canvas with no aria-label, role or fallback text' });
		const f = makeFlow(page, flow);
		await def.run(page, f, flow);
		flow.ok = true;
	} catch {
		flow.ok = false;
	}
	await page.evaluate(scanPage).then((s) => { flow.scanAfter = s; }).catch(() => {});
	if (flow.consoleErrors.length) flow.findings.push({ kind: 'console-error', where: def.path, detail: `${flow.consoleErrors[0]}${flow.failedRequests.length ? ` (${flow.failedRequests[0]})` : ''}` });
	await context.close();
	return flow;
}

const browser = await chromium.launch();
const flows = [];
for (const def of FLOWS) {
	const r = await runFlow(browser, def);
	flows.push(r);
	console.log(`${r.ok ? 'PASS' : 'FAIL'} ${def.id} ${def.path} (${r.steps.length} steps, ${r.findings.length} findings)`);
	for (const fi of r.findings) console.log(`   - ${fi.kind}: ${fi.where}: ${fi.detail}`);
}
await browser.close();

const summary = {
	flowsPassed: flows.filter((x) => x.ok).length,
	flowsTotal: flows.length,
	findings: flows.reduce((n, x) => n + x.findings.length, 0),
	consoleErrors: flows.reduce((n, x) => n + x.consoleErrors.length, 0),
};
const report = { ranAt: new Date().toISOString(), baseUrl: BASE_URL, summary, flows };
console.log(JSON.stringify(summary));

if (LABEL) {
	mkdirSync(dirname(EVIDENCE), { recursive: true });
	const doc = existsSync(EVIDENCE) ? JSON.parse(readFileSync(EVIDENCE, 'utf8')) : {};
	doc[LABEL] = report;
	// Captured page text can carry dash glyphs the repo bans; evidence stores a hyphen.
	writeFileSync(EVIDENCE, JSON.stringify(doc, null, '\t').replace(/[\u2013\u2014]/g, '-') + '\n');
	console.log(`recorded "${LABEL}" in ${EVIDENCE}`);
}
if (STRICT && (summary.findings > 0 || summary.flowsPassed < summary.flowsTotal)) process.exit(1);

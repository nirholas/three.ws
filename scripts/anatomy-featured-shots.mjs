#!/usr/bin/env node
// Featured Anatomy cutaways in a real browser: renders their 1200x630 share
// cards from the live explorer, screenshots every state (open, tour steps,
// exploded, section, phone), fails on console errors, and measures time to
// interactive on a mid-range phone profile.
//
//   node scripts/anatomy-featured-shots.mjs --base http://localhost:3283 \
//     [--out anatomy-featured-shots] [--og] [--tti] [--only ffsc-engine] [--timeout 180000]
//
// --og writes the cards to public/anatomy/og/<slug>.png (the files
// api/_lib/anatomy/featured/index.js names as ogImage). --tti adds the phone
// measurement: 412x823 at 2x, 4x CPU slowdown and a slow 4G link, the same
// profile Lighthouse uses for mobile.
//
// On a heavily loaded host, software WebGL cannot keep a continuously
// animating canvas and the compositor fed at once, so screenshots time out.
// For the screenshot passes, requestAnimationFrame is paced to a few frames a
// second. The explorer's motion is time based, so every frame is still a true
// frame. The phone timing pass runs unpaced.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

import { featuredDesign, featuredList } from '../api/_lib/anatomy/featured/index.js';

const arg = (name, def = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const base = arg('base', 'http://localhost:3000');
const out = arg('out', 'anatomy-featured-shots');
const timeout = Number(arg('timeout', 180_000)) || 180_000;
const only = arg('only');
const PACE_MS = Number(arg('pace', 250)) || 250;
mkdirSync(out, { recursive: true });

const designs = featuredList()
	.filter((d) => !only || d.slug === only)
	.map((d) => ({ ...d, steps: featuredDesign(d.id).spec.steps.map((s) => s.title) }));
const problems = [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const paceScript = `(() => {
	const raf = window.requestAnimationFrame.bind(window);
	window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), ${PACE_MS});
})();`;

async function newPage(options, { paced = true } = {}) {
	const context = await browser.newContext(options);
	if (paced) await context.addInitScript(paceScript);
	const page = await context.newPage();
	page.setDefaultTimeout(timeout);
	page.setDefaultNavigationTimeout(timeout);
	page.on('console', (msg) => {
		if (msg.type() !== 'error' && msg.type() !== 'warning') return;
		const text = msg.text();
		if (/GPU stall|ReadPixels|WebGL-|swiftshader|favicon/i.test(text)) return;
		problems.push(`[${msg.type()}] ${page.url()}: ${text}`);
	});
	page.on('pageerror', (err) => problems.push(`[pageerror] ${page.url()}: ${err.message}`));
	return { page, context };
}

async function openMachine(page, id) {
	await page.goto(`${base}/anatomy/${id}`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('.anx canvas');
	await page.waitForFunction(() => !document.querySelector('#anpSkeleton') || document.querySelector('#anpSkeleton').hidden);
	await page.waitForTimeout(3000);
}

const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`), timeout });

// ── share cards ────────────────────────────────────────────────────────────

const OG_LEFT = 430;
const OG_CSS = `
	body > *:not(main):not(#ogLabel), .site-header, .anp-bar, .anp-asked, .anp-notice, .anx-side, .anx-toolbar, .anx-hint, .anx-tour, .anx-header, .anx-legend, .anp-toast { display: none !important; }
	html, body { overflow: hidden !important; background: #07080b !important; }
	#anpStage { position: fixed !important; top: 0 !important; bottom: 0 !important; right: 0 !important; left: ${OG_LEFT - 40}px !important; height: 100vh !important; width: auto !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; z-index: 10; }
	.anx { display: block !important; outline: none !important; box-shadow: none !important; }
	.anx, .anx-stage { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; }
	#ogLabel { position: fixed; z-index: 20; left: 0; top: 0; bottom: 0; width: ${OG_LEFT}px; box-sizing: border-box; padding: 56px 24px 52px 56px; display: flex; flex-direction: column; justify-content: space-between;
		background: linear-gradient(to right, rgba(7,8,11,1) 0%, rgba(7,8,11,0.96) 78%, rgba(7,8,11,0) 100%);
		color: #f4f6fa; font-family: 'Geist', 'Inter', system-ui, sans-serif; pointer-events: none; }
	#ogLabel .brand { font-size: 28px; font-weight: 800; letter-spacing: -0.01em; }
	#ogLabel .brand span { margin-left: 12px; font: 600 17px/1 ui-monospace, 'Geist Mono', monospace; letter-spacing: 0.2em; color: #8fa3c7; }
	#ogLabel .eyebrow { font: 600 18px/1 ui-monospace, 'Geist Mono', monospace; letter-spacing: 0.18em; text-transform: uppercase; color: #4fd1ff; margin-bottom: 16px; }
	#ogLabel .title { font-size: 40px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.06; }
	#ogLabel .chips { display: flex; flex-wrap: wrap; gap: 10px; }
	#ogLabel .chips div { font-size: 18px; padding: 7px 14px; border-radius: 999px; background: rgba(143,163,199,0.12); border: 1px solid rgba(143,163,199,0.32); color: #dfe6f2; }
`;

// A tall vehicle is a sliver in a landscape card, so it is framed on the tour
// step that shows it best (the camera focuses that step's parts).
const OG_STEP = { 'launch-stack': 'Hot staging' };

const frames = (page, n) => page.evaluate((count) => new Promise((done) => {
	let left = count;
	const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick));
	requestAnimationFrame(tick);
}), n);

async function renderOgCard(design) {
	const { page, context } = await newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: 'dark' });
	await openMachine(page, design.id);
	const stepTitle = OG_STEP[design.slug];
	if (stepTitle) {
		const index = design.steps.indexOf(stepTitle);
		if (index < 0) throw new Error(`${design.slug}: no tour step titled "${stepTitle}"`);
		await page.evaluate(() => document.querySelector('.anx').focus());
		for (let i = 0; i <= index; i++) await page.keyboard.press('ArrowRight');
		await page.waitForSelector('.anx-tour');
	}
	await page.addStyleTag({ content: OG_CSS });
	await page.evaluate(({ title, stats }) => {
		const node = (cls, text) => Object.assign(document.createElement('div'), { className: cls, textContent: text });
		const label = node('', '');
		label.id = 'ogLabel';
		const brand = node('brand', 'three.ws');
		brand.append(Object.assign(document.createElement('span'), { textContent: 'ANATOMY' }));
		const middle = node('', '');
		middle.append(node('eyebrow', 'How it works'), node('title', title));
		const chips = node('chips', '');
		for (const text of [`${stats.instances} parts`, `${stats.steps} step tour`, 'Interactive cutaway']) chips.append(node('', text));
		label.append(brand, middle, chips);
		document.body.append(label);
		window.dispatchEvent(new Event('resize'));
	}, { title: design.title, stats: design.stats });
	// The canvas clears when it resizes; wait for real frames at the new size.
	await page.waitForFunction((w) => document.querySelector('.anx canvas')?.clientWidth >= w, 1200 - OG_LEFT);
	await frames(page, 12);
	await page.waitForTimeout(1500);
	const file = resolve('public', design.ogImage.replace(/^\//, ''));
	mkdirSync(resolve(file, '..'), { recursive: true });
	await page.screenshot({ path: file, timeout });
	console.log(`og: ${file}`);
	await context.close();
}

// ── states ─────────────────────────────────────────────────────────────────

async function captureStates(design) {
	const tag = design.slug;
	const { page, context } = await newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
	await openMachine(page, design.id);
	const sectionOn = await page.evaluate(() => document.querySelector('.anx select[aria-label="Section cut axis"]')?.value);
	console.log(`${tag}: open, section=${sectionOn || 'off'}`);
	await shot(page, `${tag}-01-open`);

	await page.locator('.anx').focus();
	const steps = design.stats.steps;
	for (const at of [0, Math.floor(steps / 2), steps - 1]) {
		await page.evaluate(() => document.querySelector('.anx').focus());
		await page.keyboard.press('Home').catch(() => {});
		for (let i = 0; i <= at; i++) await page.keyboard.press('ArrowRight');
		await page.waitForSelector('.anx-tour');
		await page.waitForTimeout(2500);
		const head = (await page.textContent('.anx-tour-head'))?.trim();
		console.log(`${tag}: tour ${head}`);
		await shot(page, `${tag}-02-tour-${String(at + 1).padStart(2, '0')}`);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);
	}

	await page.keyboard.press('e');
	await page.waitForTimeout(3000);
	await shot(page, `${tag}-03-exploded`);
	await page.keyboard.press('e');
	await page.waitForTimeout(1500);

	const section = page.locator('.anx select[aria-label="Section cut axis"]');
	const values = await section.locator('option').evaluateAll((o) => o.map((x) => x.value));
	const axis = values.find((v) => v && v !== 'off' && v !== 'none' && v !== sectionOn) || values.find((v) => v && v !== 'off' && v !== 'none');
	await section.selectOption(axis);
	await page.waitForTimeout(2500);
	await shot(page, `${tag}-04-section-${axis}`);

	await page.keyboard.press('x');
	await page.waitForTimeout(1500);
	await shot(page, `${tag}-05-xray`);
	await page.keyboard.press('x');

	// The share panel opens with the design's own token-free text.
	await page.click('#anpShare');
	await page.waitForSelector('[role="dialog"]');
	const dialogText = await page.textContent('[role="dialog"]');
	const xHref = await page.locator('[role="dialog"] a[href*="x.com/intent"], [role="dialog"] a[href*="twitter.com/intent"]').first().getAttribute('href').catch(() => null);
	const sharedText = xHref ? new URL(xHref).searchParams.get('text') || '' : '';
	if (!sharedText.includes(design.shareText.slice(0, 60))) problems.push(`[share] ${tag}: X intent text does not carry the design share text: ${sharedText.slice(0, 120)}`);
	if (/\$|token|coin|price|wallet/i.test(sharedText)) problems.push(`[share] ${tag}: share text mentions money: ${sharedText}`);
	console.log(`${tag}: share panel open, X text: ${sharedText.replace(/\s+/g, ' ').slice(0, 140)}`);
	if (!dialogText) problems.push(`[share] ${tag}: empty share dialog`);
	await shot(page, `${tag}-06-share`);
	await page.keyboard.press('Escape');

	const sources = await page.getAttribute('#anpSources', 'href');
	if (!sources || (await page.locator('#anpSources').isHidden())) problems.push(`[sources] ${tag}: sources link missing`);
	await context.close();

	const phone = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
	await openMachine(phone.page, design.id);
	const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	if (overflow > 1) problems.push(`[layout] ${tag}: phone page scrolls horizontally by ${overflow}px`);
	await shot(phone.page, `${tag}-07-phone`);
	await phone.page.evaluate(() => document.querySelector('.anx').focus());
	await phone.page.keyboard.press('ArrowRight');
	await phone.page.waitForSelector('.anx-tour');
	await phone.page.waitForTimeout(2500);
	await shot(phone.page, `${tag}-08-phone-tour`);
	await phone.context.close();
}

// ── phone time to interactive ──────────────────────────────────────────────

const LONGTASKS = `(() => {
	window.__longtasks = [];
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) window.__longtasks.push([e.startTime, e.startTime + e.duration]);
		}).observe({ type: 'longtask', buffered: true });
	} catch {}
})();`;

async function measureTti(design) {
	const { page, context } = await newPage({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' }, { paced: false });
	await context.addInitScript(LONGTASKS);
	const cdp = await context.newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	await cdp.send('Network.enable');
	await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
	await page.goto(`${base}/anatomy/${design.id}`, { waitUntil: 'domcontentloaded' });
	// Interactive: the explorer has its canvas, the parts list is clickable and
	// the first frame of the machine has been drawn.
	await page.waitForFunction(() => document.querySelector('.anx canvas') && document.querySelectorAll('.anx-side button, .anx-side li').length > 0 && document.querySelector('#anpSkeleton')?.hidden !== false);
	const ready = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now())))));
	// Lighthouse-style TTI: the end of the last long task before a 5 s window
	// with none, never earlier than the explorer being ready.
	await page.waitForTimeout(8000);
	const { tasks, now, dcl, fcp } = await page.evaluate(() => ({
		tasks: window.__longtasks,
		now: performance.now(),
		dcl: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd || null,
		fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || null,
	}));
	let tti = ready;
	for (const [start, end] of tasks.sort((a, b) => a[0] - b[0])) {
		if (end <= tti) continue;
		if (start - tti >= 5000) break;
		tti = end;
	}
	const quiet = now - tti >= 5000;
	const result = { slug: design.slug, fcpMs: fcp && Math.round(fcp), domContentLoadedMs: dcl && Math.round(dcl), explorerReadyMs: Math.round(ready), ttiMs: Math.round(tti), quietWindowObserved: quiet, longTasks: tasks.length };
	console.log(`tti: ${JSON.stringify(result)}`);
	await context.close();
	return result;
}

const results = { base, at: new Date().toISOString(), tti: [] };
for (const design of designs) {
	if (flag('og')) await renderOgCard(design);
	if (!flag('og-only')) await captureStates(design);
	if (flag('tti')) results.tti.push(await measureTti(design));
}
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify({ ...results, problems }, null, 2));

if (problems.length) {
	console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
	process.exit(1);
}
console.log(`\nOK: no console errors. Screenshots and results.json in ${out}/`);

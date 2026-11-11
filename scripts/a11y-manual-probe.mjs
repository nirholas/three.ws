#!/usr/bin/env node
// Instrumentation for the manual accessibility checks (docs/accessibility/walkthroughs.md).
//
// axe cannot judge keyboard order, focus visibility, reflow at high zoom, text
// spacing or Windows High Contrast. This script drives a real Chromium through
// those checks on the same audited set as scripts/audit-a11y.mjs and records
// what it measured, so a person reviewing the walkthrough starts from numbers
// rather than impressions. It does not replace the person: the screen reader
// pass and the screenshots it saves are reviewed by hand.
//
// Per page it measures:
//   keyboard      Tab from the top of the page (up to --tabs stops): every stop,
//                 whether focus is visibly indicated, whether a fixed or sticky
//                 layer hides it entirely (2.4.11), traps (2.1.2) and whether the
//                 first stop is a skip link (2.4.1).
//   reflow        200% and 400% zoom as 640px and 320px CSS viewports (1.4.10):
//                 page-level horizontal scrolling and the elements that cause it.
//   spacing       the 1.4.12 text-spacing overrides: text clipped by overflow.
//   forcedColors  forced-colors: active (Windows High Contrast): focus stops whose
//                 only indicator is a box-shadow, which forced colors removes.
//
// Usage:
//   node scripts/a11y-manual-probe.mjs                 # against http://localhost:3112
//   node scripts/a11y-manual-probe.mjs --only /login --shots /path/to/dir
//
// Writes docs/accessibility/reports/manual-probe.json. Exits 0; the findings are
// read by a person, not gated.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { auditedSet } from './audit-a11y.mjs';
import { settleAndFreeze } from './lib/a11y-settle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'accessibility', 'reports', 'manual-probe.json');

function parseArgs(argv) {
	const args = { base: process.env.A11Y_BASE || 'http://localhost:3112', only: null, tabs: 60, shots: null, concurrency: 3 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--base') args.base = argv[++i];
		else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
		else if (a === '--tabs') args.tabs = Math.max(1, Number(argv[++i]) || 60);
		else if (a === '--shots') args.shots = argv[++i];
		else if (a === '--concurrency') args.concurrency = Math.max(1, Number(argv[++i]) || 1);
	}
	args.base = args.base.replace(/\/$/, '');
	return args;
}

async function openPage(browser, url, { viewport, forcedColors = 'none' }) {
	const context = await browser.newContext({ viewport, colorScheme: 'dark', reducedMotion: 'reduce', forcedColors });
	const page = await context.newPage();
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
	await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => undefined);
	await page.waitForTimeout(800);
	await settleAndFreeze(page);
	return { context, page };
}

// Runs in the page. Describes the focused element and the styles that could
// carry a focus indicator, plus whether anything paints over it.
function focusSnapshot() {
	const el = document.activeElement;
	if (!el || el === document.body || el === document.documentElement) return null;
	let target = el;
	while (target.shadowRoot && target.shadowRoot.activeElement) target = target.shadowRoot.activeElement;
	const cs = getComputedStyle(target);
	const r = target.getBoundingClientRect();
	const name = (target.getAttribute('aria-label') || target.textContent || target.getAttribute('title') || target.getAttribute('alt') || '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60);
	const id = target.id ? `#${target.id}` : '';
	const cls = typeof target.className === 'string' && target.className.trim() ? `.${target.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
	const desc = `${target.tagName.toLowerCase()}${id}${cls}`;
	const points = [
		[r.left + r.width / 2, r.top + r.height / 2],
		[r.left + 2, r.top + 2],
		[r.right - 2, r.top + 2],
		[r.left + 2, r.bottom - 2],
		[r.right - 2, r.bottom - 2],
	];
	const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
	let anyVisible = false;
	if (inView) {
		for (const [x, y] of points) {
			if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
			const root = target.getRootNode();
			const hit = (root.elementFromPoint ? root : document).elementFromPoint(x, y);
			if (hit && (hit === target || target.contains(hit) || hit.contains(target))) {
				anyVisible = true;
				break;
			}
		}
	}
	return {
		key: desc + '|' + name + '|' + Math.round(r.left) + ',' + Math.round(r.top + scrollY),
		desc,
		name,
		zeroSize: r.width < 1 || r.height < 1,
		inView,
		hidden: inView && !anyVisible,
		style: {
			outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` : '',
			boxShadow: cs.boxShadow === 'none' ? '' : cs.boxShadow,
			border: `${cs.borderTopColor} ${cs.borderTopWidth}`,
			background: cs.backgroundColor,
			color: cs.color,
			textDecoration: cs.textDecorationLine,
		},
	};
}

// The same element's styles once focus has moved off it.
function restingStyle(key) {
	const all = document.querySelectorAll('*');
	for (const el of all) {
		const r = el.getBoundingClientRect();
		const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('alt') || '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 60);
		const id = el.id ? `#${el.id}` : '';
		const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
		const k = `${el.tagName.toLowerCase()}${id}${cls}|${name}|${Math.round(r.left)},${Math.round(r.top + scrollY)}`;
		if (k !== key) continue;
		const cs = getComputedStyle(el);
		return {
			outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` : '',
			boxShadow: cs.boxShadow === 'none' ? '' : cs.boxShadow,
			border: `${cs.borderTopColor} ${cs.borderTopWidth}`,
			background: cs.backgroundColor,
			color: cs.color,
			textDecoration: cs.textDecorationLine,
		};
	}
	return null;
}

function indicatorFrom(focused, resting) {
	if (focused.outline) return 'outline';
	if (!resting) return focused.boxShadow ? 'box-shadow' : 'unknown';
	for (const k of ['boxShadow', 'border', 'background', 'color', 'textDecoration']) {
		if (focused[k] !== resting[k]) return k;
	}
	return 'none';
}

// A skip link counts when it exists, is a real link and its target exists.
function skipLinkInfo() {
	for (const a of document.querySelectorAll('a[href^="#"]')) {
		if (!/skip/i.test(a.textContent)) continue;
		const id = decodeURIComponent(a.getAttribute('href').slice(1));
		return { text: a.textContent.replace(/\s+/g, ' ').trim(), target: id, targetExists: !!document.getElementById(id) };
	}
	return null;
}

async function keyboardWalk(page, maxTabs) {
	const initial = await page.evaluate(focusSnapshot);
	const skip = await page.evaluate(skipLinkInfo);
	const stops = [];
	let repeats = 0;
	let wrapped = false;
	let trap = null;
	let prev = null;
	for (let i = 0; i < maxTabs; i++) {
		await page.keyboard.press('Tab');
		const snap = await page.evaluate(focusSnapshot);
		if (prev) {
			const resting = await page.evaluate(restingStyle, prev.key);
			prev.indicator = indicatorFrom(prev.style, resting);
		}
		if (!snap) {
			if (stops.length) wrapped = true;
			break;
		}
		if (stops.length && snap.key === stops[0].key) {
			wrapped = true;
			break;
		}
		if (prev && snap.key === prev.key) {
			repeats++;
			if (repeats >= 3) {
				trap = snap.desc;
				break;
			}
			continue;
		}
		repeats = 0;
		stops.push(snap);
		prev = snap;
	}
	if (prev && !prev.indicator) prev.indicator = prev.style.outline ? 'outline' : prev.style.boxShadow ? 'box-shadow' : 'unknown';
	return {
		count: stops.length,
		wrapped,
		trap,
		initialFocus: initial ? `${initial.desc} "${initial.name}"` : null,
		firstStop: stops[0] ? `${stops[0].desc} "${stops[0].name}"` : null,
		skipLink: !!skip && skip.targetExists,
		skip,
		noIndicator: stops.filter((s) => s.indicator === 'none' && !s.zeroSize).map((s) => `${s.desc} "${s.name}"`),
		hidden: stops.filter((s) => s.hidden).map((s) => `${s.desc} "${s.name}"`),
		invisible: stops.filter((s) => s.zeroSize).map((s) => `${s.desc} "${s.name}"`),
		shadowOnly: stops.filter((s) => !s.style.outline && s.indicator === 'boxShadow').map((s) => `${s.desc} "${s.name}"`),
		order: stops.map((s) => `${s.desc} "${s.name}"`),
	};
}

// Elements that push the page wider than the viewport, outside any
// horizontally scrollable container (tables and code may scroll on their own).
function reflowOverflow() {
	const vw = document.documentElement.clientWidth;
	const pageScroll = document.documentElement.scrollWidth > vw + 1;
	const offenders = [];
	if (pageScroll) {
		for (const el of document.body.querySelectorAll('*')) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.right <= vw + 1) continue;
			let scroller = false;
			for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
				const o = getComputedStyle(p).overflowX;
				if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') {
					scroller = true;
					break;
				}
			}
			if (scroller) continue;
			const cs = getComputedStyle(el);
			if (cs.position === 'fixed' && r.left >= vw) continue;
			const id = el.id ? `#${el.id}` : '';
			const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
			offenders.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(r.right)}`);
			if (offenders.length >= 8) break;
		}
	}
	return { viewport: vw, scrollWidth: document.documentElement.scrollWidth, pageScroll, offenders };
}

const SPACING_CSS = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

function clippedText() {
	const out = [];
	for (const el of document.body.querySelectorAll('*')) {
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden') continue;
		const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
		const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
		if (!clipsY && !clipsX) continue;
		if (cs.textOverflow === 'ellipsis' || parseInt(cs.webkitLineClamp, 10) > 0) continue;
		const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2);
		if (!text) continue;
		const r = el.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) continue;
		if (r.width <= 1 && r.height <= 1) continue;
		const over = (clipsY && el.scrollHeight > el.clientHeight + 2) || (clipsX && el.scrollWidth > el.clientWidth + 2);
		if (!over) continue;
		const id = el.id ? `#${el.id}` : '';
		const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
		out.push(`${el.tagName.toLowerCase()}${id}${cls} "${el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)}"`);
		if (out.length >= 10) break;
	}
	return out;
}

function slug(path) {
	return path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') || 'home';
}

async function probe(browser, base, target, args) {
	const url = base + target.path;
	const result = { path: target.path, group: target.group };
	try {
		{
			const { context, page } = await openPage(browser, url, { viewport: { width: 1366, height: 900 } });
			result.keyboard = await keyboardWalk(page, args.tabs);
			await context.close();
		}
		result.reflow = {};
		for (const [zoom, width, height] of [['200%', 640, 450], ['400%', 320, 256]]) {
			const { context, page } = await openPage(browser, url, { viewport: { width, height } });
			result.reflow[zoom] = await page.evaluate(reflowOverflow);
			if (args.shots) await page.screenshot({ path: join(args.shots, `${slug(target.path)}-zoom${zoom.replace('%', '')}.png`) });
			await context.close();
		}
		{
			const { context, page } = await openPage(browser, url, { viewport: { width: 1366, height: 900 } });
			await page.addStyleTag({ content: SPACING_CSS });
			await page.waitForTimeout(150);
			result.spacing = { clipped: await page.evaluate(clippedText) };
			await context.close();
		}
		{
			const { context, page } = await openPage(browser, url, { viewport: { width: 1366, height: 900 }, forcedColors: 'active' });
			if (args.shots) await page.screenshot({ path: join(args.shots, `${slug(target.path)}-forced.png`) });
			const walk = await keyboardWalk(page, Math.min(args.tabs, 25));
			result.forcedColors = { stops: walk.count, noIndicator: walk.noIndicator, shadowOnly: walk.shadowOnly };
			await context.close();
		}
	} catch (err) {
		result.error = String(err && err.message ? err.message : err).split('\n')[0];
	}
	return result;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.shots) mkdirSync(args.shots, { recursive: true });
	let targets = await auditedSet(args.base);
	if (args.only) targets = targets.filter((t) => args.only.includes(t.path));
	const browser = await chromium.launch();
	const results = new Array(targets.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(args.concurrency, targets.length) }, async () => {
			while (next < targets.length) {
				const i = next++;
				results[i] = await probe(browser, args.base, targets[i], args);
				const r = results[i];
				const k = r.keyboard;
				console.log(
					`${r.path}: ${r.error ? 'ERROR ' + r.error : `tabs=${k.count}${k.wrapped ? ' wrapped' : ''}${k.trap ? ' TRAP ' + k.trap : ''} skip=${k.skipLink} noIndicator=${k.noIndicator.length} hidden=${k.hidden.length} reflow200=${r.reflow['200%'].pageScroll} reflow400=${r.reflow['400%'].pageScroll} clipped=${r.spacing.clipped.length} forcedNoIndicator=${r.forcedColors.noIndicator.length + r.forcedColors.shadowOnly.length}`}`,
				);
			}
		}),
	);
	await browser.close();
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), base: args.base, results }, null, '\t') + '\n');
	console.log('wrote docs/accessibility/reports/manual-probe.json');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

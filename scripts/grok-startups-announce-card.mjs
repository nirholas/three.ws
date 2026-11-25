#!/usr/bin/env node
// Head image for the Grok for Startups announcement thread
// (docs/x-posts/2026-11-25-grok-for-startups-announcement.md).
//
// Renders the live featured rocket-engine cutaway from production at 2x and
// overlays the approved membership line. No xAI, SpaceX or X logo is drawn:
// the plan only allows nominative use of those marks
// (docs/partners/xai-grok-startups-plan.md, "Marks are nominative").
//
//   node scripts/grok-startups-announce-card.mjs [--base https://three.ws] [--design ffsc-engine]

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

import { featuredList } from '../api/_lib/anatomy/featured/index.js';

const arg = (name, def) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : def;
};
const base = arg('base', 'https://three.ws');
const slug = arg('design', 'ffsc-engine');
const outDir = resolve('public/x-media/grok-startups-announce');
const design = featuredList().find((d) => d.slug === slug);
if (!design) throw new Error(`no featured design "${slug}"`);

const W = 1200;
const H = 675;
const LEFT = 560;
const timeout = 240_000;

const CSS = `
	body > *:not(main):not(#card), .site-header, .anp-bar, .anp-asked, .anp-notice, .anx-side, .anx-toolbar, .anx-hint, .anx-tour, .anx-header, .anx-legend, .anp-toast, .anx-label, .anx-labels { display: none !important; }
	html, body { overflow: hidden !important; background: #07080b !important; }
	#anpStage { position: fixed !important; top: 0 !important; bottom: 0 !important; right: -40px !important; left: ${LEFT - 120}px !important; height: 100vh !important; width: auto !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; z-index: 10; }
	.anx { display: block !important; outline: none !important; box-shadow: none !important; }
	.anx, .anx-stage { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; }
	#card { position: fixed; z-index: 20; left: 0; top: 0; bottom: 0; width: ${LEFT}px; box-sizing: border-box; padding: 60px 40px 56px 64px; display: flex; flex-direction: column; justify-content: space-between;
		background: linear-gradient(to right, rgba(7,8,11,1) 0%, rgba(7,8,11,0.97) 80%, rgba(7,8,11,0) 100%);
		color: #f4f6fa; font-family: 'Geist', 'Inter', system-ui, sans-serif; pointer-events: none; }
	#card .brand { font-size: 34px; font-weight: 800; letter-spacing: -0.015em; }
	#card .eyebrow { font: 600 17px/1 ui-monospace, 'Geist Mono', monospace; letter-spacing: 0.2em; text-transform: uppercase; color: #4fd1ff; margin-bottom: 18px; }
	#card .title { font-size: 64px; font-weight: 800; letter-spacing: -0.03em; line-height: 0.98; }
	#card .sub { margin-top: 22px; font-size: 22px; line-height: 1.35; color: #b9c4d8; max-width: 440px; }
	#card .chips { display: flex; flex-wrap: wrap; gap: 10px; }
	#card .chips div { font-size: 17px; padding: 8px 14px; border-radius: 999px; background: rgba(143,163,199,0.12); border: 1px solid rgba(143,163,199,0.32); color: #dfe6f2; }
`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: 'dark' });
await context.addInitScript(`(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 250); })();`);
const page = await context.newPage();
page.setDefaultTimeout(timeout);
const problems = [];
page.on('pageerror', (err) => problems.push(err.message));

await page.goto(`${base}/anatomy/${design.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.anx canvas');
await page.waitForFunction(() => !document.querySelector('#anpSkeleton') || document.querySelector('#anpSkeleton').hidden);
await page.waitForTimeout(3000);
await page.addStyleTag({ content: CSS });
await page.evaluate(() => {
	const node = (cls, text) => Object.assign(document.createElement('div'), { className: cls, textContent: text });
	const card = node('', '');
	card.id = 'card';
	const middle = node('', '');
	middle.append(
		node('eyebrow', 'Now a member of'),
		node('title', 'Grok for Startups'),
		node('sub', 'Grok can make, rig and explain real 3D through three.ws.'),
	);
	const chips = node('chips', '');
	for (const text of ['5,547 tool calls from Grok', 'Used every day for 44 days']) chips.append(node('', text));
	card.append(node('brand', 'three.ws'), middle, chips);
	document.body.append(card);
	window.dispatchEvent(new Event('resize'));
});
await page.waitForFunction((w) => document.querySelector('.anx canvas')?.clientWidth >= w, W - LEFT);
await page.evaluate(() => new Promise((done) => { let n = 12; const t = () => (--n <= 0 ? done() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
await page.waitForTimeout(2000);

mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, `head-${slug}.png`);
await page.screenshot({ path: file, timeout });
await browser.close();
if (problems.length) console.error(`page errors:\n${problems.join('\n')}`);
console.log(`card: ${file}`);

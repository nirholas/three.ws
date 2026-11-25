#!/usr/bin/env node
// Head image for the Grok for Startups announcement thread: the three.ws logo
// beside the membership line, 2400x1350.
//
// The program is named in plain type. xAI, Grok and SpaceX logos are used only
// when permission or a published brand kit covers it
// (docs/partners/xai-grok-startups-plan.md, "Marks are nominative"). With an
// approved logo file in hand, pass it to replace the typed name:
//
//   node scripts/grok-startups-announce-card.mjs [--partner-logo path/to/approved.svg]

import { mkdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : undefined;
};
const dataUri = (path) => {
	const type = { '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(path).toLowerCase()];
	if (!type) throw new Error(`logo must be an .svg or .png file: ${path}`);
	return `data:${type};base64,${readFileSync(path).toString('base64')}`;
};

const partnerLogo = arg('partner-logo');
const partner = partnerLogo
	? `<img class="partner" src="${dataUri(resolve(partnerLogo))}" alt="Grok for Startups">`
	: '<div class="program">Grok for<br>Startups</div>';
const outDir = resolve('public/x-media/grok-startups-announce');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
	body { margin: 0; width: 1200px; height: 675px; background: #07080b; color: #f4f6fa; font-family: 'Inter', system-ui, sans-serif;
		display: grid; grid-template-columns: 1fr 1px 1fr; align-items: center; }
	.side { display: flex; align-items: center; justify-content: center; gap: 22px; }
	.mark { width: 128px; height: 128px; }
	.name, .program { font-size: 60px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; }
	.rule { height: 220px; background: rgba(143,163,199,0.32); }
	.partner { max-width: 400px; max-height: 160px; }
</style>
<div class="side"><img class="mark" src="${dataUri(resolve('public/favicon.svg'))}" alt=""><div class="name">three.ws</div></div>
<div class="rule"></div>
<div class="side">${partner}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, 'head.png');
await page.screenshot({ path: file });
await browser.close();
console.log(`card: ${file}`);

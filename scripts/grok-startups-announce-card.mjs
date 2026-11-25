#!/usr/bin/env node
// Head image for the Grok for Startups announcement: the three.ws logo and the
// Grok logo side by side, 2400x1350.
//
// The Grok logo is public/marks/grok-full-logomark-light.svg, byte for byte the
// Grok_Full_Logomark_Light.svg file from the official kit linked at
// https://x.ai/legal/brand-guidelines (data.x.ai/logos). Those guidelines
// require the logo exactly as provided, so it is drawn unaltered, at its own
// aspect ratio, with nothing placed close enough to read as a combined mark.
//
//   node scripts/grok-startups-announce-card.mjs

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const file = (path, type) => `data:${type};base64,${readFileSync(resolve(path)).toString('base64')}`;
const outDir = resolve('public/x-media/grok-startups-announce');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
	@font-face { font-family: 'Space Grotesk'; font-weight: 300 700; src: url('${file('public/fonts/space-grotesk-latin.woff2', 'font/woff2')}') format('woff2'); }
	body { margin: 0; width: 1200px; height: 675px; background: #07080b; color: #f4f6fa;
		display: flex; align-items: center; justify-content: center; gap: 88px; }
	.ours { display: flex; align-items: center; gap: 20px; }
	.ours img { width: 120px; height: 120px; }
	.ours span { font: 700 64px/1 'Space Grotesk', sans-serif; letter-spacing: -0.035em; }
	.rule { width: 1px; height: 150px; background: rgba(143, 163, 199, 0.3); }
	.grok { height: 120px; width: auto; }
</style>
<div class="ours"><img src="${file('public/favicon.svg', 'image/svg+xml')}" alt=""><span>three.ws</span></div>
<div class="rule"></div>
<img class="grok" src="${file('public/marks/grok-full-logomark-light.svg', 'image/svg+xml')}" alt="Grok">`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(async () => {
	await document.fonts.ready;
	await Promise.all([...document.images].map((img) => img.decode()));
	if (!document.fonts.check("700 64px 'Space Grotesk'")) throw new Error('Space Grotesk did not load');
});
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'head.png');
await page.screenshot({ path: out });
await browser.close();
console.log(`card: ${out}`);

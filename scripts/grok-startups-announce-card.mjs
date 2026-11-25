#!/usr/bin/env node
// Head image for the Grok for Startups announcement, 2400x1350: the three.ws
// lockup and the Grok logo side by side, split by a thin rule, on a flat field.
// No headline. The post carries the words; the image only pairs the two marks,
// the way partner announcements from larger companies do.
//
// Every mark is an official file drawn unaltered at its own aspect ratio:
//   public/brand/three-ws-lockup-on-{light,dark}.png  our press kit lockups
//   public/marks/grok-full-logomark-{dark,light}.svg  byte for byte the
//     Grok_Full_Logomark_{Dark,Light}.svg files from the SpaceXAI_Grok_Assets
//     kit linked at https://x.ai/legal/brand-guidelines (data.x.ai/logos),
//     whose guidelines require the logo exactly as provided.
//
//   node scripts/grok-startups-announce-card.mjs          -> head.png (light)
//   node scripts/grok-startups-announce-card.mjs --dark   -> head-dark.png

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const dark = process.argv.includes('--dark');
const file = (path, type) => `data:${type};base64,${readFileSync(resolve(path)).toString('base64')}`;
const outDir = resolve('public/x-media/grok-startups-announce');

const theme = dark
	? { bg: '#0b0b0d', rule: '#3a3a40', ours: 'public/brand/three-ws-lockup-on-dark.png', grok: 'public/marks/grok-full-logomark-light.svg' }
	: { bg: '#f4f4f6', rule: '#c4c4ca', ours: 'public/brand/three-ws-lockup-on-light.png', grok: 'public/marks/grok-full-logomark-dark.svg' };

// Both files are cropped close to their ink. Heights are set so the two
// wordmarks share one cap height (the "G" is 0.48 of the Grok file's height,
// the "h" ascender 0.52 of the lockup's), which also leaves the cube and the
// Grok symbol the same size, and the rule sits evenly between the marks.
const html = `<!doctype html>
<meta charset="utf-8">
<style>
	body { margin: 0; width: 1200px; height: 675px; overflow: hidden; background: ${theme.bg};
		display: flex; align-items: center; justify-content: center; }
	.pair { display: flex; align-items: center; }
	.ours { height: 112px; width: auto; }
	.rule { width: 2px; height: 132px; background: ${theme.rule}; margin: 0 68px; }
	.grok { height: 122px; width: auto; }
</style>
<div class="pair">
	<img class="ours" src="${file(theme.ours, 'image/png')}" alt="three.ws">
	<div class="rule"></div>
	<img class="grok" src="${file(theme.grok, 'image/svg+xml')}" alt="Grok">
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, dark ? 'head-dark.png' : 'head.png');
await page.screenshot({ path: out });
await browser.close();
console.log(`card: ${out}`);

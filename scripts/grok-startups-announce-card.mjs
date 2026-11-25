#!/usr/bin/env node
// Head image for the Grok for Startups announcement: the three.ws logo and the
// Grok logo side by side over the membership headline, 2400x1350.
//
// The Grok logo is public/marks/grok-full-logomark-light.svg, byte for byte the
// Grok_Full_Logomark_Light.svg file from the official SpaceXAI_Grok_Assets kit
// linked at https://x.ai/legal/brand-guidelines (data.x.ai/logos), and
// public/marks/spacexai-wordmark-white-transparent.svg is that kit's
// "spacexai - wordmark - white - transparent.svg". Those guidelines
// require the logo exactly as provided, so it is drawn unaltered, at its own
// aspect ratio. The headline sits centered under the whole lockup, well clear
// of the Grok logo, so nothing beside it reads as a combined mark.
//
//   node scripts/grok-startups-announce-card.mjs            -> head.png
//   node scripts/grok-startups-announce-card.mjs --company  -> head-company.png
//     (adds the SpaceXAI wordmark above the headline)

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const company = process.argv.includes('--company');
const file = (path, type) => `data:${type};base64,${readFileSync(resolve(path)).toString('base64')}`;
const outDir = resolve('public/x-media/grok-startups-announce');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
	@font-face { font-family: 'Space Grotesk'; font-weight: 300 700; src: url('${file('public/fonts/space-grotesk-latin.woff2', 'font/woff2')}') format('woff2'); }
	body { margin: 0; width: 1200px; height: 675px; overflow: hidden; position: relative; color: #f4f6fa;
		background:
			radial-gradient(ellipse 620px 340px at 50% 40%, rgba(122, 108, 255, 0.20), transparent 70%),
			radial-gradient(ellipse 900px 420px at 50% 115%, rgba(79, 209, 255, 0.16), transparent 70%),
			#06070a; }
	.grid { position: absolute; left: -50%; right: -50%; bottom: -40px; height: 330px;
		background-image: linear-gradient(rgba(143, 163, 199, 0.30) 1px, transparent 1px), linear-gradient(90deg, rgba(143, 163, 199, 0.30) 1px, transparent 1px);
		background-size: 56px 56px; transform: perspective(420px) rotateX(62deg); transform-origin: 50% 100%;
		-webkit-mask-image: linear-gradient(to top, #000 25%, transparent 95%); }
	main { position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
	.lockup { display: flex; align-items: center; gap: 80px; }
	.ours { display: flex; align-items: center; gap: 20px; }
	.ours img { width: 116px; height: 116px; filter: drop-shadow(0 10px 30px rgba(122, 108, 255, 0.35)); }
	.ours span { font: 700 62px/1 'Space Grotesk', sans-serif; letter-spacing: -0.035em; }
	.rule { width: 1px; height: 140px; background: linear-gradient(transparent, rgba(143, 163, 199, 0.45), transparent); }
	.grok { height: 116px; width: auto; }
	.copy { margin-top: 84px; text-align: center; }
	.company { display: block; height: 22px; width: auto; margin: 0 auto 26px; }
	.headline { font: 600 40px/1.1 'Space Grotesk', sans-serif; letter-spacing: -0.02em;
		background: linear-gradient(90deg, #f4f6fa, #c9d4ff 50%, #9fe3ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
</style>
<div class="grid"></div>
<main>
	<div class="lockup">
		<div class="ours"><img src="${file('public/favicon.svg', 'image/svg+xml')}" alt=""><span>three.ws</span></div>
		<div class="rule"></div>
		<img class="grok" src="${file('public/marks/grok-full-logomark-light.svg', 'image/svg+xml')}" alt="Grok">
	</div>
	<div class="copy">
		${company ? `<img class="company" src="${file('public/marks/spacexai-wordmark-white-transparent.svg', 'image/svg+xml')}" alt="SpaceXAI">` : ''}
		<div class="headline">Now part of Grok for Startups</div>
	</div>
</main>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(async () => {
	await document.fonts.ready;
	await Promise.all([...document.images].map((img) => img.decode()));
	if (!document.fonts.check("700 62px 'Space Grotesk'")) throw new Error('Space Grotesk did not load');
});
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, company ? 'head-company.png' : 'head.png');
await page.screenshot({ path: out });
await browser.close();
console.log(`card: ${out}`);

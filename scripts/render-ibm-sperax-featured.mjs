#!/usr/bin/env node
// Renders the featured image for the IBM Community post: the three partner logos
// on white, nothing else.
//
// IBM Community's featured-image guidance asks for a landscape image of at least
// 1200x600 and warns against text, because the card crops differently across the
// site. Logos are the exception the author asked for; everything else stays out,
// and the composition is centred so a tighter crop loses only white space.
//
// Sources, all local:
//   IBM       cropped from docs/media/ibm-x-threews-lockup.png (the group's own lockup)
//   three.ws  public/brand/three-ws-lockup-on-light.png
//   Sperax    the SperaxOS repo's public/sperax.svg, inlined and forced to black
//
//   node scripts/render-ibm-sperax-featured.mjs
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/media');
mkdirSync(outDir, { recursive: true });

const SPERAX_SVG = '/workspaces/sperax-fix/repo/public/sperax.svg';
if (!existsSync(SPERAX_SVG)) {
	throw new Error(
		`Sperax logo not found at ${SPERAX_SVG}. It lives in the SperaxOS checkout, not this repo; ` +
			'clone it or point this constant at another copy before rendering.',
	);
}

// The IBM mark is cropped out of the group's existing lockup so this script never
// needs a separate trademark asset checked in.
const ibmMark = await sharp(resolve(root, 'docs/media/ibm-x-threews-lockup.png'))
	.extract({ left: 260, top: 440, width: 816, height: 320 })
	.png()
	.toBuffer();

const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const threeWs = readFileSync(resolve(root, 'public/brand/three-ws-lockup-on-light.png'));
// Two fixes to the Sperax file. Its mark is drawn in currentColor, so one colour
// declaration blackens it. And its width/height attributes (500.6 x 500, square)
// contradict its viewBox (183 x 39, wide), which makes any CSS height render the
// artwork at a fraction of the box it reserves. Strip both and let the viewBox
// drive the aspect ratio.
const sperax = readFileSync(SPERAX_SVG, 'utf8')
	.replace(/\s(width|height)="[^"]*"/g, '')
	.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" style="color:#161616" ');

const W = 2400;
const H = 1200;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;background:#fff;overflow:hidden}
  .row{width:100%;height:100%;display:flex;align-items:center;justify-content:center;gap:120px;padding:0 200px}
  .slot{display:flex;align-items:center;justify-content:center}
  .slot img,.slot svg{display:block;width:auto}
  /* Each lockup has a different ink-to-box ratio, so heights are tuned for equal
     optical weight rather than set to one shared number. */
  .sperax svg{height:108px}
  .tws img{height:168px}
  .ibm img{height:126px}
  .sep{width:2px;height:140px;background:#e0e0e0;flex:0 0 2px}
</style></head><body>
  <div class="row">
    <div class="slot sperax">${sperax}</div>
    <div class="sep"></div>
    <div class="slot tws"><img src="${b64(threeWs)}" alt=""></div>
    <div class="sep"></div>
    <div class="slot ibm"><img src="${b64(ibmMark)}" alt=""></div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: resolve(outDir, 'ibm-sperax-featured.png') });
await browser.close();

console.log(`wrote docs/media/ibm-sperax-featured.png  (${W}x${H})`);

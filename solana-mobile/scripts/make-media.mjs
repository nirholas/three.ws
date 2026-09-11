#!/usr/bin/env node
// Generates the buildable dApp Store listing assets into publish/media/:
//   icon.png            512x512    flattened app icon (from /public/pwa-512x512.png)
//   banner.png          1200x600   brand lockup, drawn in a browser with the site fonts
//   feature.png         1024x500   live capture of a real agent in the three.ws viewer
//   editors-choice.png  1200x1200  square card for the portal's Editor's Choice slot
// The five 1080x1920 screenshots are NOT generated here: reviewers require
// real Seeker device captures (see ../docs/ASSETS.md).
//
// Usage: node solana-mobile/scripts/make-media.mjs [agent-page-url]
//        node solana-mobile/scripts/make-media.mjs --target=play
//
// The --target=play run writes ONE file, publish-play/media/feature-1024x500-alpha.png:
// the brand lockup on a genuinely transparent ground, for surfaces that composite
// it over their own background. It is deliberately NOT the Play upload. Play's
// feature graphic slot takes a 24-bit PNG or JPEG with no alpha channel, so the
// flattened feature-1024x500.png beside it is the file that goes in the console;
// uploading an alpha PNG there is rejected at the form.

import sharp from 'sharp';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGET = process.argv.includes('--target=play') ? 'play' : 'dapp';
const OUT = path.join(ROOT, TARGET === 'play' ? 'solana-mobile/publish-play/media' : 'solana-mobile/publish/media');
const BG = '#080814';
mkdirSync(OUT, { recursive: true });

/** Fail here rather than shipping a file the Publisher Portal will bounce. */
async function writeAsset(name, buffer, width, height, note) {
  const meta = await sharp(buffer).metadata();
  if (meta.width !== width || meta.height !== height) {
    throw new Error(`[make-media] ${name} is ${meta.width}x${meta.height}, the listing slot requires ${width}x${height}`);
  }
  if (meta.hasAlpha) throw new Error(`[make-media] ${name} carries an alpha channel; the listing slot requires an opaque PNG`);
  const file = path.join(OUT, name);
  await sharp(buffer).toFile(file);
  console.log(`[make-media] ${name}  ${width}x${height}  ${Math.round(buffer.length / 1024)} KB  (${note})`);
}

/** A store slot that wants transparency is the exception, so it gets its own
    writer rather than a flag on the opaque one: the guards are opposites and a
    shared writer would have to trust the caller to pick the right side. */
async function writeAlphaAsset(name, buffer, width, height, note) {
  const meta = await sharp(buffer).metadata();
  if (meta.width !== width || meta.height !== height) {
    throw new Error(`[make-media] ${name} is ${meta.width}x${meta.height}, expected ${width}x${height}`);
  }
  if (!meta.hasAlpha) throw new Error(`[make-media] ${name} has no alpha channel; a transparent asset that is opaque is a silent failure`);
  await sharp(buffer).toFile(path.join(OUT, name));
  console.log(`[make-media] ${name}  ${width}x${height}  ${Math.round(buffer.length / 1024)} KB  (${note})`);
}

if (TARGET === 'dapp') {
  await writeAsset(
    'icon.png',
    await sharp(path.join(ROOT, 'public/pwa-512x512.png'))
      .flatten({ background: BG }).resize(512, 512).removeAlpha().png({ compressionLevel: 9 }).toBuffer(),
    512, 512, 'shipped app mark on the brand ground',
  );
}

/* Banner: the brand lockup on the brand ground, drawn in a real browser against
   the same Space Grotesk and Inter files the site serves. An SVG rendered by
   sharp cannot see those faces and silently substitutes a system one, which
   ships a store banner whose type does not match the product. The faces are
   inlined as data URIs so the render never depends on a running server. */
const FONT_FACES = [
  ['Space Grotesk', '300 700', 'space-grotesk-latin.woff2'],
  ['Inter', '300 800', 'inter-latin.woff2'],
].map(([family, weight, file]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(path.join(ROOT, 'public/fonts', file)).toString('base64')}) format('woff2');}`).join('\n');

const MARK_URI = `data:image/png;base64,${readFileSync(path.join(ROOT, 'public/pwa-512x512.png')).toString('base64')}`;
/* The banner says exactly what the listing's short description says, read from
   the same file, so the two can never drift. */
const SHORT_DESC = readFileSync(
  path.join(ROOT, TARGET === 'play' ? 'solana-mobile/publish-play/listing/short-description.txt' : 'solana-mobile/publish/listing/short-description.txt'),
  'utf8',
).trim();
const [TAGLINE_A, TAGLINE_B] = SHORT_DESC.split(/(?<=\.)\s+/);

async function renderBanner(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
${FONT_FACES}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:600px;overflow:hidden;background:${BG};
  background-image:radial-gradient(80% 120% at 28% 50%, #141438 0%, #0b0b1e 45%, ${BG} 100%);
  display:flex;align-items:center;gap:64px;padding:0 104px;color:#fff;
  font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
img{width:320px;height:320px;flex:none;border-radius:64px;
  box-shadow:0 24px 80px rgba(80,140,255,.28)}
h1{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:104px;
  letter-spacing:-.045em;line-height:1}
p{font-size:30px;line-height:1.45;margin-top:28px}
p b{font-weight:500;color:#b8e8ff;display:block}
p span{color:#8899bb}
</style><body><img src="${MARK_URI}" alt=""><div><h1>three.ws</h1>
<p><b>${TAGLINE_A}</b><span>${TAGLINE_B}</span></p></div>`, { waitUntil: 'load' });

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 104px "Space Grotesk"') && document.fonts.check('400 30px "Inter"');
  });
  if (!loaded) throw new Error('[make-media] brand fonts did not load; the banner would render in a fallback face');

  const shot = await page.screenshot({ type: 'png' });
  await page.close();
  return sharp(shot).flatten({ background: BG }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

/* Editor's Choice card: a square slot in the dApp Store's featured carousel,
   shown small and alongside a separate 50-character headline. It carries the
   lockup and nothing else, so the headline is never duplicated inside the
   artwork and nothing important is lost when the card is scaled down. */
async function renderEditorsChoice(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
${FONT_FACES}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:1200px;overflow:hidden;background:${BG};
  background-image:radial-gradient(70% 70% at 50% 38%, #17173c 0%, #0c0c22 52%, ${BG} 100%);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px;
  color:#fff;font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
img{width:440px;height:440px;border-radius:96px;
  box-shadow:0 40px 120px rgba(80,140,255,.30)}
h1{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:132px;
  letter-spacing:-.045em;line-height:1}
.chip{margin-top:-18px;padding:16px 34px;border:1px solid rgba(184,232,255,.34);border-radius:999px;
  font-size:28px;letter-spacing:.22em;text-transform:uppercase;color:#b8e8ff}
</style><body><img src="${MARK_URI}" alt=""><h1>three.ws</h1>
<span class="chip">Built for Seeker</span></body>`, { waitUntil: 'load' });

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 132px "Space Grotesk"') && document.fonts.check('400 28px "Inter"');
  });
  if (!loaded) throw new Error("[make-media] brand fonts did not load; the Editor's Choice card would render in a fallback face");

  const shot = await page.screenshot({ type: 'png' });
  await page.close();
  return sharp(shot).flatten({ background: BG }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

// Default hero: first agent returned by the live marketplace API, so the
// capture always reflects real, current product UI.
let agentUrl = process.argv[2] === `--target=${TARGET}` ? undefined : process.argv[2];
if (TARGET === 'dapp' && !agentUrl) {
  const res = await fetch('https://three.ws/api/marketplace/agents?limit=1');
  const body = await res.json();
  const first = body?.data?.items?.[0];
  if (!first) throw new Error('[make-media] marketplace API returned no agents to capture');
  agentUrl = `https://three.ws/agents/${first.id}`;
}

/**
 * The feature graphic's lockup on a transparent ground.
 *
 * `omitBackground` is what makes the alpha real: the page paints no ground at
 * all, so the PNG carries the mark, the wordmark and the tagline over nothing,
 * and whatever composites it supplies its own background.
 *
 * Type colour cannot be transparent, which is the trap in every "just make it
 * transparent" asset: a white wordmark over nothing is invisible the moment
 * someone drops it on a light ground, and the render gives no warning because
 * on the designer's dark canvas it looks perfect. So this renders twice, once
 * per ink, and the caller picks by the ground it is compositing over.
 */
async function renderFeatureAlpha(browser, ink) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
${FONT_FACES}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent}
body{width:1024px;height:500px;overflow:hidden;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:34px;color:${ink.title};
  font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
.lockup{display:flex;align-items:center;gap:30px}
.lockup img{width:132px;height:132px}
h1{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:96px;
  letter-spacing:-.045em;line-height:1}
p{max-width:860px;text-align:center;font-size:29px;line-height:1.4;color:${ink.body}}
</style><body>
<div class="lockup"><img src="${MARK_URI}" alt=""><h1>three.ws</h1></div>
<p>${SHORT_DESC}</p>
</body>`, { waitUntil: 'load' });

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 96px "Space Grotesk"') && document.fonts.check('400 29px "Inter"');
  });
  if (!loaded) throw new Error('[make-media] brand fonts did not load; the feature graphic would render in a fallback face');

  const shot = await page.screenshot({ type: 'png', omitBackground: true });
  await page.close();
  return shot;
}

const INKS = [
  ['on-dark', { title: '#ffffff', body: '#9fb0d0' }, 'white type, for dark grounds'],
  ['on-light', { title: '#0b0c1a', body: '#4a5570' }, 'dark type, for light grounds'],
];

if (TARGET === 'play') {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl'] });
  const rendered = [];
  try {
    for (const [name, ink, note] of INKS) rendered.push([name, await renderFeatureAlpha(browser, ink), note]);
  } finally {
    await browser.close();
  }
  for (const [name, buf, note] of rendered) {
    await writeAlphaAsset(`feature-1024x500-alpha-${name}.png`, buf, 1024, 500, `${note}, NOT the Play upload`);
  }
  console.log("[make-media] Play's feature graphic slot rejects alpha; upload the flattened feature-1024x500.png instead.");
  process.exit(0);
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl'] });
let feature;
try {
  await writeAsset('banner.png', await renderBanner(browser), 1200, 600, 'brand lockup in Space Grotesk');
  await writeAsset("editors-choice.png", await renderEditorsChoice(browser), 1200, 1200, "square card for the Editor's Choice carousel");

  console.log(`[make-media] capturing ${agentUrl}`);
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.goto(agentUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(9000);
  feature = await page.screenshot({ type: 'png' });
} finally {
  await browser.close();
}

const means = (await sharp(feature).stats()).channels.map((c) => Number(c.mean.toFixed(1)));
if (means.every((m) => m < 12)) {
  throw new Error(`[make-media] feature.png looks blank (channel means ${means.join(',')}): WebGL likely failed to render; retry or pass a different agent URL`);
}
await writeAsset(
  'feature.png',
  await sharp(feature).flatten({ background: BG }).removeAlpha().png({ compressionLevel: 9 }).toBuffer(),
  1024, 500, `live agent capture, channel means ${means.join(',')}`,
);

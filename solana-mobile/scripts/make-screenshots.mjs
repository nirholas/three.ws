#!/usr/bin/env node
/**
 * Builds the five dApp Store preview images as ONE continuous carousel.
 *
 * The Publisher Portal shows previews as a horizontally scrolling strip, so the
 * five 1080x1920 panels are not designed one at a time: a single 5400x1920
 * composition is drawn in a browser and then sliced. Four of the nine phones
 * are centred exactly ON a seam, so each upload carries one whole screen plus
 * the two halves it shares with its neighbours, and the glow, beam, and floor
 * run the length of the strip. Swiping the listing reads as one photograph of a
 * shelf of devices rather than five unrelated stills.
 *
 * Every phone in the strip holds a REAL capture of the shipping product. Two
 * sources, in priority order per screen:
 *   1. publish/media/device/screen-N.png, a genuine Seeker capture, if present.
 *   2. A live capture of https://three.ws at Seeker viewport, taken here.
 * Nothing is mocked or drawn to look like product UI.
 *
 * Usage:
 *   node solana-mobile/scripts/make-screenshots.mjs                        # dApp Store panels
 *   node solana-mobile/scripts/make-screenshots.mjs --target=play           # Google Play phone panels
 *   node solana-mobile/scripts/make-screenshots.mjs --target=play-tablet    # Play 10-inch + 7-inch panels
 *   node solana-mobile/scripts/make-screenshots.mjs --origin=http://localhost:3000
 *   node solana-mobile/scripts/make-screenshots.mjs --keep-raw   # also write the raw captures
 */
import sharp from 'sharp';
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const ORIGIN = String(args.origin || 'https://three.ws').replace(/\/$/, '');

/* Two stores, two sets of panels, one capture and composition pipeline.
   The dApp Store listing may talk about Seeker and Seed Vault because it only
   ever installs on one; the Play listing must not, because it installs on every
   Android phone and Play rejects screenshots advertising a flow the user cannot
   reach. Everything below the panel definitions is shared. */
const TARGET = String(args.target || 'dapp');
const MEDIA_DIRS = {
  dapp: 'solana-mobile/publish/media',
  play: 'solana-mobile/publish-play/media/phone',
  'play-tablet': 'solana-mobile/publish-play/media/tablet',
};
if (!MEDIA_DIRS[TARGET]) throw new Error(`--target must be one of ${Object.keys(MEDIA_DIRS).join(', ')}; got ${TARGET}`);
/* The tablet strip is the Play strip in a tablet's clothes: same five stories,
   same shelf, but each device holds the layout three.ws serves to a 768 px
   viewport, which is a different composition from the phone one and the whole
   reason Play asks for the upload separately. */
const IS_TABLET = TARGET === 'play-tablet';
const IS_PLAY = TARGET === 'play' || IS_TABLET;
const MEDIA = path.join(ROOT, MEDIA_DIRS[TARGET]);
const DEVICE = path.join(MEDIA, 'device');
const RAW = path.join(MEDIA, 'raw');

/** Panel geometry. The phone slot is 1080x1920; the tablet slot is the same
    9:16 at 1440x2560, which is the smallest size clearing Play's 1,080 px
    minimum on BOTH sides of a 10-inch shot and still downscales exactly to the
    1260x2240 the 7-inch upload takes. */
const W = IS_TABLET ? 1440 : 1080;
const H = IS_TABLET ? 2560 : 1920;
const COUNT = 5;
const BG = '#080814';
/* Every composition constant below was tuned against the 1080 px phone panel,
   so the tablet strip scales them instead of re-tuning them by hand. Frame
   radii are the one thing that does not scale linearly: a tablet's corners are
   tighter relative to its body than a phone's, so scaling 54 px straight up
   would draw a comically rounded slab. */
const S = W / 1080;
const px = (n) => Math.round(n * S);
const rad = (n) => Math.round(n * S * (IS_TABLET ? 0.6 : 1));

/* Seeker renders 1080 CSS-independent pixels wide. Capturing 432 CSS px at
   2.5x device pixel ratio yields exactly 1080x1920 of real product UI. A tablet
   frame holds the tablet layout instead: 768x1024 CSS is what Android reports
   for a 10-inch portrait viewport, and 2x gives a 1536x2048 capture. */
const SHOT_CSS = IS_TABLET ? { width: 768, height: 1024 } : { width: 432, height: 768 };
const SHOT_DPR = IS_TABLET ? 2 : 2.5;
const SHOT_W = SHOT_CSS.width * SHOT_DPR;
const SHOT_H = SHOT_CSS.height * SHOT_DPR;

/**
 * The five panels. `path` is captured live when no device capture exists.
 * Headlines describe what the panel actually shows; nothing here promises a
 * feature the frame does not display.
 */
const DAPP_PANELS = [
  {
    file: 'screen-1.png',
    path: '/seeker',
    title: 'Your agent studio,\non Seeker',
    sub: 'One tap in with Seed Vault. No password, no seed phrase typed on a phone.',
  },
  {
    file: 'screen-2.png',
    path: '/marketplace',
    scrollTo: '#market-grid',
    scrollBy: 620,
    title: 'Browse agents\nbuilt by everyone',
    sub: 'Every listing is a real 3D character you can open, inspect, and own.',
  },
  {
    file: 'screen-3.png',
    path: null, // resolved to a currently listed agent
    title: 'Real 3D,\nrunning on device',
    sub: 'Rigged, animated glTF in your hand. Not a video, not a pre-rendered clip.',
  },
  {
    file: 'screen-4.png',
    path: '/create',
    title: 'Make one\nin a minute',
    sub: 'Describe it, speak it, or start from a selfie. The model is generated for you.',
  },
  {
    file: 'screen-5.png',
    path: '/seeker',
    scrollTo: '#verify',
    title: 'Signed by\nyour Seed Vault',
    sub: 'Prove you own a Seeker and sign on Solana. Keys never leave the secure element.',
  },
];

/**
 * The four phones that sit ON the seams, split down the middle by the crease
 * between two store panels. They carry no headline: their job is to make the
 * five uploads read as one photograph of a shelf of devices rather than five
 * unrelated stills, so each one has to be a screen the hero panels do not
 * already show.
 */
const DAPP_SEAMS = [
  { id: 'seam-1', path: '/chat' },
  /* /portal rather than /forge: the forge screen puts third-party engine names
     on chips, and ../docs/ASSETS.md keeps vendor branding out of store frames. */
  { id: 'seam-2', path: '/portal' },
  { id: 'seam-3', path: '/create/selfie' },
  { id: 'seam-4', path: '/animations' },
];

/**
 * The Play panels. Same product, different audience: this listing installs on
 * any Android phone, so nothing here may promise Seeker hardware or Seed Vault
 * sign-in. The model lane leads, because the listing is now named for it.
 */
const PLAY_PANELS = [
  {
    file: 'screen-1.png',
    path: '/create',
    title: 'A 3D model\nfrom a prompt',
    sub: 'Describe an object and get a textured glTF back. Free, and no account to try it.',
  },
  {
    file: 'screen-2.png',
    path: '/marketplace',
    scrollTo: '#market-grid',
    scrollBy: 620,
    title: 'Browse what\neveryone built',
    sub: 'Every listing is a real 3D model or character you can open, inspect, and own.',
  },
  {
    file: 'screen-3.png',
    path: null, // resolved to a currently listed agent
    title: 'Real 3D,\non your phone',
    /* The tablet strip is the same five stories on a device that is not a
       phone, so any panel naming the hardware needs its own line. Play shows
       these uploads only to tablet users; a headline promising "on your phone"
       there is the listing telling the reader it was not made for them. */
    tabletTitle: 'Real 3D,\non your tablet',
    sub: 'Rigged, animated glTF in your hand. Not a video, not a pre-rendered clip.',
  },
  {
    file: 'screen-4.png',
    path: '/create/selfie',
    title: 'A selfie into\na rigged avatar',
    sub: 'One photo becomes an animation-ready 3D character in about a minute.',
  },
  {
    /* The agent's own chat view, not /chat. The assistant hub renders
       trading-flavoured quick actions ("find new gems", "rug check") that read
       as promoting potential earnings, which Play's blockchain policy forbids
       in listing metadata. This view also actually shows what the headline
       promises: the 3D character and the conversation in one frame. */
    file: 'screen-5.png',
    path: null,
    view: 'chat',
    title: 'Give it a mind,\nthen talk to it',
    sub: 'Attach a personality, a voice and skills. The agent answers you in 3D.',
  },
];

/* Seam screens for the Play strip: four surfaces none of the five hero panels
   already shows, so the shelf reads as one photograph rather than a repeat. */
const PLAY_SEAMS = [
  { id: 'seam-1', path: '/animations' },
  { id: 'seam-2', path: '/portal' },
  { id: 'seam-3', path: '/discover' },
  { id: 'seam-4', path: '/agents' },
];

const PANELS = IS_PLAY ? PLAY_PANELS : DAPP_PANELS;
const SEAMS = IS_PLAY ? PLAY_SEAMS : DAPP_SEAMS;

/* Floating product widgets that are useful in the app and noise in a store
   frame: the corner stack (onboarding pill, language picker, claim card), the
   walking companion and its trail, and the marketplace sidebar handle. Hidden
   for the capture only; nothing about the page underneath changes. */
const OVERLAY_SELECTORS = [
  '#tws-corner-stack',
  '.twx-i18n-fab',
  '.walk-companion',
  '.walk-c2w-fx',
  '.walk-trail-layer',
  '#market-sidebar-toggle',
];

const FONT_FACES = [
  ['Space Grotesk', '300 700', 'space-grotesk-latin.woff2'],
  ['Inter', '300 800', 'inter-latin.woff2'],
].map(([family, weight, file]) => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(path.join(ROOT, 'public/fonts', file)).toString('base64')}) format('woff2');}`).join('\n');

const MARK_URI = `data:image/png;base64,${readFileSync(path.join(ROOT, 'public/pwa-512x512.png')).toString('base64')}`;

/* Listed agents whose stored render faces the camera, so the hero panel shows a
   character looking at the reader rather than the back of its head. Pass
   --agent=<id> to override; if none of these is still listed the first agent the
   marketplace returns is used. */
const PREFERRED_AGENTS = [
  '34706ed9-6277-4e84-8963-4fe5aca9c9c7',
  '20ecfcc6-849e-4c12-b618-4c7c344cbc43',
];

/**
 * The agents whose pages fill the panels that carry no path of their own.
 * Returns as many distinct ids as asked for, preferring the vetted ones and
 * falling back to whatever the marketplace currently lists. Two panels showing
 * the same character in the same viewer reads as a duplicate slide, so each
 * gets its own.
 */
async function resolveAgentIds(count) {
  const res = await fetch(`${ORIGIN}/api/marketplace/agents?limit=24`);
  const items = (await res.json())?.data?.items ?? [];
  const listed = items.map((a) => a?.id).filter(Boolean);
  if (listed.length === 0) throw new Error('[screenshots] marketplace API returned no agents to capture');
  const wanted = args.agent ? [String(args.agent)] : PREFERRED_AGENTS;
  const picked = [...wanted.filter((id) => listed.includes(id)), ...listed.filter((id) => !wanted.includes(id))];
  if (picked.length < count) {
    throw new Error(`[screenshots] need ${count} distinct agents to capture, the marketplace lists ${picked.length}`);
  }
  return picked.slice(0, count);
}

/**
 * Capture one screen at Seeker resolution, or reuse a real device capture.
 * `spec.file` is set for hero panels only, which is also what makes a hand-made
 * device capture substitutable: publish/media/device/screen-N.png wins if it
 * exists.
 */
async function sourceShot(ctx, spec) {
  const label = spec.file ?? spec.id;
  const device = spec.file ? path.join(DEVICE, spec.file) : null;
  if (device && existsSync(device)) {
    const meta = await sharp(device).metadata();
    if (meta.width !== SHOT_W || meta.height !== SHOT_H) {
      throw new Error(`[screenshots] ${device} is ${meta.width}x${meta.height}, a device capture must be ${SHOT_W}x${SHOT_H}`);
    }
    console.log(`[screenshots] ${label}: device capture ${path.relative(ROOT, device)}`);
    return sharp(device).png().toBuffer();
  }

  const page = await ctx.newPage();
  const url = ORIGIN + spec.path;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  } catch {
    /* networkidle never settles on a page holding an open socket; the render is
       still complete by the time the settle below elapses. */
  }
  await page.addStyleTag({ content: `${OVERLAY_SELECTORS.join(',')}{display:none!important}` });
  if (spec.scrollTo || spec.scrollBy) {
    await page.evaluate(({ sel, by }) => {
      const el = sel ? document.querySelector(sel) : null;
      if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (by) window.scrollBy({ top: by, behavior: 'instant' });
    }, { sel: spec.scrollTo ?? null, by: spec.scrollBy ?? 0 });
  }
  /* Let WebGL scenes, lazy images, and entrance transitions finish. */
  await page.waitForTimeout(9000);
  const buf = await page.screenshot({ type: 'png' });
  await page.close();
  if (args['keep-raw']) {
    mkdirSync(RAW, { recursive: true });
    writeFileSync(path.join(RAW, `${label.replace(/\.png$/, '')}.png`), buf);
  }

  const meta = await sharp(buf).metadata();
  if (meta.width !== SHOT_W || meta.height !== SHOT_H) {
    throw new Error(`[screenshots] capture of ${url} is ${meta.width}x${meta.height}, expected ${SHOT_W}x${SHOT_H}`);
  }
  const means = (await sharp(buf).stats()).channels.map((c) => c.mean);
  if (means.every((m) => m < 6)) {
    throw new Error(`[screenshots] capture of ${url} is effectively blank (channel means ${means.map((m) => m.toFixed(1)).join(',')})`);
  }
  console.log(`[screenshots] ${label}: live capture ${url}`);
  return buf;
}

/* Composition geometry, in strip pixels. A hero phone is centred in its own
   panel; a seam phone is centred exactly ON the crease between two panels, so
   each upload carries one whole screen plus the two halves it shares with its
   neighbours. That overlap is the whole point: the five uploads have to read as
   one photograph of a shelf of devices, not five separate stills. */
const HERO_W = Math.round(W * (IS_TABLET ? 0.76 : 0.611));
const HERO_CY = IS_TABLET ? 1700 : 1258;
const SEAM_W = Math.round(W * (IS_TABLET ? 0.47 : 0.398));
const SEAM_CY = IS_TABLET ? 1460 : 1074;

/**
 * Draw the whole strip in one browser page, then slice it into store panels.
 * Everything that crosses a seam does so deliberately: the glow field, the
 * light beam, the floor, and the four seam phones.
 */
async function composeStrip(browser, heroShots, seamShots) {
  const stripW = W * COUNT;
  const page = await browser.newPage({ viewport: { width: stripW, height: H }, deviceScaleFactor: 1 });

  /* Heroes rise toward the middle of the strip and settle again, so swiping the
     carousel reads as one arc rather than five identical layouts. */
  const heroLift = [0, -26, -46, -26, 0].map(px);
  const heroes = heroShots.map((buf, i) => `<div class="phone hero" style="left:${W * i + W / 2}px;top:${HERO_CY + heroLift[i]}px;width:${HERO_W}px">
      <img src="data:image/png;base64,${buf.toString('base64')}" alt="">
    </div>`).join('');

  const seams = seamShots.map((buf, i) => `<div class="phone seam" style="left:${W * (i + 1)}px;top:${SEAM_CY + (i % 2 ? px(24) : -px(24))}px;width:${SEAM_W}px;--tilt:${i % 2 ? 4 : -4}deg">
      <img src="data:image/png;base64,${buf.toString('base64')}" alt="">
    </div>`).join('');

  const headers = PANELS.map((s, i) => `<header style="left:${W * i}px">
      <h2>${((IS_TABLET && s.tabletTitle) || s.title).replace(/\n/g, '<br>')}</h2>
      <p>${s.sub}</p>
    </header>`).join('');

  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
${FONT_FACES}
*{margin:0;padding:0;box-sizing:border-box}
body{width:${stripW}px;height:${H}px;background:${BG};color:#fff;overflow:hidden;position:relative;
  font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
/* One glow field for the entire strip: it ignores every seam. */
.glow{position:absolute;inset:0;
  background:
    radial-gradient(38% 46% at 6% 18%, rgba(96,140,255,.30), transparent 70%),
    radial-gradient(34% 44% at 32% 78%, rgba(150,90,255,.24), transparent 72%),
    radial-gradient(40% 50% at 58% 12%, rgba(64,196,255,.22), transparent 70%),
    radial-gradient(34% 46% at 82% 74%, rgba(120,110,255,.26), transparent 72%),
    linear-gradient(180deg, #0a0a1c 0%, #080814 60%, #06060f 100%)}
/* A single light beam swept across all five panels. */
.beam{position:absolute;left:-6%;right:-6%;top:40%;height:${px(360)}px;transform:rotate(-3.4deg);
  background:linear-gradient(90deg, transparent, rgba(150,200,255,.15) 16%, rgba(190,220,255,.26) 50%, rgba(150,200,255,.15) 84%, transparent);
  filter:blur(${px(60)}px)}
/* A continuous floor the whole shelf of devices stands on. */
.floor{position:absolute;left:0;right:0;bottom:0;height:${px(520)}px;
  background:linear-gradient(180deg, transparent, rgba(4,5,16,.78))}
header{position:absolute;top:${px(150)}px;width:${W}px;padding:0 ${px(78)}px;text-align:center}
h2{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:${px(80)}px;line-height:1.06;
  letter-spacing:-.035em}
header p{margin-top:${px(28)}px;font-size:${px(32)}px;line-height:1.42;color:#93a4c6}
.phone{position:absolute;transform:translate(-50%,-50%) rotate(var(--tilt,0deg));
  border-radius:${rad(54)}px;padding:${px(12)}px;background:linear-gradient(160deg,#2f3350,#12131f 58%,#262a40);
  box-shadow:0 ${px(46)}px ${px(130)}px rgba(3,4,14,.8), 0 0 0 1px rgba(255,255,255,.07) inset}
.phone img{display:block;width:100%;border-radius:${rad(44)}px;background:${BG}}
.seam{border-radius:${rad(40)}px;padding:${px(9)}px;opacity:.94}
.seam img{border-radius:${rad(33)}px}
/* Lockup on the first panel, so the strip opens with the brand. */
.lockup{position:absolute;left:${px(80)}px;bottom:${px(64)}px;display:flex;align-items:center;gap:${px(24)}px}
.lockup img{width:${px(78)}px;height:${px(78)}px;border-radius:${rad(21)}px}
.lockup span{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:${px(50)}px;letter-spacing:-.045em}
</style><body>
<div class="glow"></div><div class="beam"></div><div class="floor"></div>
${headers}${seams}${heroes}
<div class="lockup"><img src="${MARK_URI}" alt=""><span>three.ws</span></div>
</body>`, { waitUntil: 'load' });

  const loaded = await page.evaluate(async ([head, body]) => {
    await document.fonts.ready;
    return document.fonts.check(`600 ${head}px "Space Grotesk"`) && document.fonts.check(`400 ${body}px "Inter"`);
  }, [px(80), px(32)]);
  if (!loaded) throw new Error('[screenshots] brand fonts did not load; the strip would render in a fallback face');

  const strip = await page.screenshot({ type: 'png' });
  await page.close();
  return strip;
}

mkdirSync(MEDIA, { recursive: true });
/* Panels with no path of their own ride on one currently listed agent, so the
   hero and its chat view are the same character rather than two strangers. */
const pending = PANELS.filter((spec) => !spec.path);
if (pending.length) {
  const ids = await resolveAgentIds(pending.length);
  pending.forEach((spec, i) => {
    spec.path = `/agents/${ids[i]}` + (spec.view ? `?view=${spec.view}` : '');
  });
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl'] });
let strip;
try {
  const ctx = await browser.newContext({
    viewport: SHOT_CSS,
    deviceScaleFactor: SHOT_DPR,
    isMobile: !IS_TABLET,
    hasTouch: true,
    /* Holds every entrance transition and the avatar turntable still, so the
       same page captured twice yields the same frame. */
    reducedMotion: 'reduce',
    userAgent: IS_TABLET
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      : `Mozilla/5.0 (Linux; Android 14; ${TARGET === 'play' ? 'Pixel 8' : 'Seeker'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36`,
  });
  const heroShots = [];
  for (const spec of PANELS) heroShots.push(await sourceShot(ctx, spec));
  const seamShots = [];
  for (const spec of SEAMS) seamShots.push(await sourceShot(ctx, spec));
  await ctx.close();

  if (args['keep-raw']) console.log(`[screenshots] raw captures written to ${path.relative(ROOT, RAW)}/`);

  strip = await composeStrip(browser, heroShots, seamShots);
} finally {
  await browser.close();
}

writeFileSync(path.join(MEDIA, 'carousel.png'), strip);
for (const [i, spec] of PANELS.entries()) {
  const panel = await sharp(strip)
    .extract({ left: i * W, top: 0, width: W, height: H })
    .flatten({ background: BG })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  /* The dApp Store portal caps a preview at 3 MB; Play allows 8 MB. */
  const capMb = IS_PLAY ? 8 : 3;
  if (panel.length > capMb * 1024 * 1024) {
    throw new Error(`[screenshots] ${spec.file} is ${(panel.length / 1024 / 1024).toFixed(2)} MB, the ceiling is ${capMb} MB`);
  }
  if (IS_TABLET) {
    /* Play takes the two tablet sizes as separate uploads with different
       floors: a 10-inch shot must be at least 1,080 px on every side, a 7-inch
       one only 320. One composition serves both, because 1440x2560 divides
       exactly into the 1260x2240 the smaller slot wants and a downscale of a
       clean render beats a second render tuned to nothing. */
    for (const [dir, width] of [['10-inch', W], ['7-inch', 1260]]) {
      const out = path.join(MEDIA, dir);
      mkdirSync(out, { recursive: true });
      const sized = width === W ? panel : await sharp(panel).resize({ width, kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
      await sharp(sized).toFile(path.join(out, spec.file));
      const meta = await sharp(sized).metadata();
      console.log(`[screenshots] ${dir}/${spec.file}  ${meta.width}x${meta.height}  ${Math.round(sized.length / 1024)} KB`);
    }
    continue;
  }
  await sharp(panel).toFile(path.join(MEDIA, spec.file));
  console.log(`[screenshots] ${spec.file}  ${W}x${H}  ${Math.round(panel.length / 1024)} KB`);
}
console.log(`[screenshots] full strip: ${path.relative(ROOT, path.join(MEDIA, 'carousel.png'))} (${W * COUNT}x${H}, upload the panels, not this)`);

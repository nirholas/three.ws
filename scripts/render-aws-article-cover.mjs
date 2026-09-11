#!/usr/bin/env node
/**
 * Renders the cover image for the AWS Builder Center article
 * (docs/aws-builder-center-before-the-signature.md).
 *
 * AWS Builder Center asks for 1200x675, under 2 MB, and states that text in
 * images is not recommended, because the card crops differently across the site
 * and the title already sits above it. So this composition carries no words at
 * all: it draws the article's argument instead.
 *
 * What the picture says, left to right:
 *   two entry paths (an enterprise subscription and an agent wallet) converge
 *   into one authorization path, which then passes through six gates that
 *   brighten as the checks get closer to the money, and terminates in a sealed
 *   node. Nothing continues past the seal, because the irreversible action is
 *   only reached once every gate has passed.
 *
 * Drawn as SVG and rasterized with sharp, so there is no browser, no font
 * loading and no dev server to collide with a concurrent agent's Playwright run.
 * Glow is layered strokes of decreasing opacity rather than a Gaussian filter,
 * which librsvg renders inconsistently.
 *
 * Usage:
 *   node scripts/render-aws-article-cover.mjs
 *   node scripts/render-aws-article-cover.mjs --out=/tmp/cover.png
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		return m ? [m[1], m[2] ?? true] : [a, true];
	}),
);

// Rendered at 2x and downscaled, so every edge stays crisp at 1200x675.
const W = 2400;
const H = 1350;

const BG = '#05060c';
const VIOLET = '#c4b5fd';
const VIOLET_STRONG = '#a78bfa';
const CORE = '#ede9fe';

// One-point perspective. The vanishing point sits right of centre and slightly
// high, so the corridor has a direction rather than sitting square to the frame.
const VPX = W * 0.635;
const VPY = H * 0.46;

// Seven gates, drawn as apertures receding toward the core. The nearest is
// almost the size of the frame; the last is a slot around the core itself.
const GATES = 7;

/** Rounded-rect aperture path at depth t, 0 nearest the viewer and 1 at the core. */
function aperture(t) {
	const k = Math.pow(1 - t, 1.55); // non-linear so depth accelerates
	const halfW = 130 + k * 1500;
	const halfH = 80 + k * 760;
	const r = 26 + k * 90;
	const cx = VPX - (VPX - W * 0.30) * k * 0.42; // centres drift as they recede
	const cy = VPY + (H * 0.5 - VPY) * k * 0.55;
	return { x: cx - halfW, y: cy - halfH, w: halfW * 2, h: halfH * 2, r };
}

// Each gate is a thick stroked frame. Width falls and brightness rises with
// depth, which is what gives the corridor its pull toward the core.
const gates = Array.from({ length: GATES }, (_, i) => {
	const t = i / (GATES - 1);
	const a = aperture(t);
	const sw = 26 - t * 17;
	const op = 0.13 + Math.pow(t, 1.6) * 0.82;
	return `<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${a.r}"
	  fill="none" stroke="url(#rim)" stroke-opacity="${op.toFixed(3)}" stroke-width="${sw.toFixed(1)}"/>`;
}).join('\n  ');

// The two front doors enter at the left edge and merge at a point in open space
// short of the corridor: an enterprise subscription above, an agent wallet below.
// The merge point is explicit rather than derived from the outermost aperture,
// whose left edge sits off-canvas and made the curves swing backwards.
const MERGE_X = W * 0.17;
const doorTop = `M -20 ${H * 0.17} L ${W * 0.055} ${H * 0.17} C ${W * 0.125} ${H * 0.17}, ${W * 0.115} ${VPY}, ${MERGE_X} ${VPY}`;
const doorBottom = `M -20 ${H * 0.76} L ${W * 0.055} ${H * 0.76} C ${W * 0.125} ${H * 0.76}, ${W * 0.115} ${VPY}, ${MERGE_X} ${VPY}`;

// The merged path: one authorization path tapering into the core. Drawn as a
// polygon rather than a stroke so it narrows with distance, and laid under the
// gates so it reads as passing through each aperture.
const beam = `<path d="M ${MERGE_X} ${VPY - 22} L ${VPX} ${VPY - 4} L ${VPX} ${VPY + 4} L ${MERGE_X} ${VPY + 22} Z" fill="url(#beam)"/>`;

const core = `
  <circle cx="${VPX}" cy="${VPY}" r="150" fill="${VIOLET_STRONG}" fill-opacity="0.10"/>
  <circle cx="${VPX}" cy="${VPY}" r="78" fill="${VIOLET_STRONG}" fill-opacity="0.22"/>
  <circle cx="${VPX}" cy="${VPY}" r="46" fill="${CORE}" fill-opacity="0.96"/>
  <circle cx="${VPX}" cy="${VPY}" r="46" stroke="${CORE}" stroke-opacity="0.35" stroke-width="22" fill="none"/>`;

// The wash is rasterized separately and blurred before compositing. Two earlier
// attempts failed the same way: a large SVG radial gradient posterizes into
// rings over this much flat near-black, and stacked low-alpha ellipses keep
// their hard edges. Only a real blur is smooth.
const haloSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <ellipse cx="${VPX}" cy="${VPY}" rx="900" ry="620" fill="${VIOLET_STRONG}" fill-opacity="0.20"/>
  <ellipse cx="${VPX}" cy="${VPY}" rx="430" ry="330" fill="${CORE}" fill-opacity="0.34"/>
  <ellipse cx="${W * 0.12}" cy="${H * 0.9}" rx="700" ry="420" fill="#2a1f5e" fill-opacity="0.35"/>
</svg>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${VIOLET}" stop-opacity="0.55"/>
      <stop offset="45%" stop-color="${CORE}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${VIOLET_STRONG}" stop-opacity="0.6"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${VIOLET}" stop-opacity="0.30"/>
      <stop offset="70%" stop-color="${CORE}" stop-opacity="0.80"/>
      <stop offset="100%" stop-color="${CORE}" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="door" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${VIOLET}" stop-opacity="0"/>
      <stop offset="30%" stop-color="${VIOLET}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${CORE}" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <path d="${doorTop}" stroke="url(#door)" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="${doorBottom}" stroke="url(#door)" stroke-width="7" fill="none" stroke-linecap="round"/>
  <circle cx="${W * 0.055}" cy="${H * 0.17}" r="26" fill="${BG}" stroke="${VIOLET}" stroke-width="7" stroke-opacity="0.85"/>
  <rect x="${W * 0.055 - 24}" y="${H * 0.76 - 24}" width="48" height="48" rx="6" fill="${BG}" stroke="${VIOLET}" stroke-width="7" stroke-opacity="0.85"/>
  ${beam}
  ${gates}
  ${core}
</svg>`;

const mark = readFileSync(resolve(root, 'public/brand/three-ws-mark.png'));
const markResized = await sharp(mark)
	.resize({ height: 110 })
	.modulate({ brightness: 1.6 })
	.png()
	.toBuffer();
const markMeta = await sharp(markResized).metadata();

const wash = await sharp(Buffer.from(haloSvg)).blur(170).png().toBuffer();
const composed = await sharp(wash)
	.composite([
		{ input: Buffer.from(svg), left: 0, top: 0, blend: 'over' },
		{ input: markResized, left: 110, top: H - 110 - 100, blend: 'over' },
	])
	.toBuffer();

const outDir = resolve(root, 'docs/media');
mkdirSync(outDir, { recursive: true });
const out = args.out ? resolve(String(args.out)) : resolve(outDir, 'aws-builder-center-cover.png');

const png = await sharp(composed).resize(1200, 675, { fit: 'fill' }).png({ compressionLevel: 9 }).toBuffer();
await sharp(png).toFile(out);
await sharp(png).toFile(resolve(root, 'aws-article-cover.png'));

console.log(`cover  ${out}  1200x675  ${(png.length / 1024).toFixed(0)} KB`);
console.log(`mark   ${markMeta.width}x${markMeta.height} at 2x`);

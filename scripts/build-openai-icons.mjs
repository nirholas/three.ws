#!/usr/bin/env node
// Render the four icons the OpenAI Plugin Directory submission requires, in the
// light and dark variants its Info tab asks for separately.
//
//   node scripts/build-openai-icons.mjs
//
// Why four and not one: the portal has two icon slots, each with a light and a
// dark upload, and leaving any of them empty is an incomplete submission. The
// 1.0.0 submission was rejected within six minutes with all four unset.
//
//   Directory icon  >= 256x256 square, shown in the plugins directory
//   Composer icon   >= 48x48 square, shown in the ChatGPT composer on mention
//
// The mark is identical across variants so it stays recognizable; only the tile
// behind it changes. A near-black tile disappears into ChatGPT's dark chrome, so
// the dark-mode variant puts the same cube on a light tile. Geometry, gradients
// and stroke are shared, which is what keeps the two readable as one brand.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prompts', 'store-submissions', '_generated', 'assets', 'openai');

// The cube is lifted verbatim from assets/icon.svg so the directory icon and the
// site icon cannot drift apart.
const CUBE = `
  <g stroke="#0B0E13" stroke-width="1.25" stroke-linejoin="round">
    <path d="M32 11 L51 21.5 L32 32 L13 21.5 Z" fill="url(#top)"/>
    <path d="M13 21.5 L32 32 L32 53 L13 42.5 Z" fill="url(#left)"/>
    <path d="M51 21.5 L32 32 L32 53 L51 42.5 Z" fill="url(#right)"/>
  </g>`;

const GRADIENTS = `
    <linearGradient id="top" x1="32" y1="10" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7DD3FC"/><stop offset="1" stop-color="#38BDF8"/>
    </linearGradient>
    <linearGradient id="left" x1="14" y1="22" x2="32" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2563EB"/><stop offset="1" stop-color="#1E40AF"/>
    </linearGradient>
    <linearGradient id="right" x1="50" y1="22" x2="32" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0EA5E9"/><stop offset="1" stop-color="#0369A1"/>
    </linearGradient>`;

const TILES = {
	// Shown on a light UI: the dark tile carries the most contrast.
	light: `
    <linearGradient id="bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0E1116"/><stop offset="1" stop-color="#1B2330"/>
    </linearGradient>`,
	// Shown on a dark UI: a near-black tile would vanish into the chrome.
	dark: `
    <linearGradient id="bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#F8FAFC"/><stop offset="1" stop-color="#DCE3EC"/>
    </linearGradient>`,
};

function svg(mode) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="three.ws 3D AI Studio">
  <defs>${TILES[mode]}${GRADIENTS}</defs>
  <rect width="64" height="64" rx="14" fill="url(#bg)"/>${CUBE}
</svg>`;
}

const TARGETS = [
	{ file: 'directory-icon-light-512.png', mode: 'light', size: 512 },
	{ file: 'directory-icon-dark-512.png', mode: 'dark', size: 512 },
	{ file: 'composer-icon-light-256.png', mode: 'light', size: 256 },
	{ file: 'composer-icon-dark-256.png', mode: 'dark', size: 256 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const t of TARGETS) {
	const page = await browser.newPage({
		viewport: { width: t.size, height: t.size },
		deviceScaleFactor: 1,
	});
	// A transparent page background would let the viewer's chrome show through
	// the tile's rounded corners, which is the point of the corner radius.
	await page.setContent(
		`<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${svg(t.mode)}`,
	);
	const buf = await page.screenshot({ omitBackground: true, type: 'png' });
	writeFileSync(join(OUT, t.file), buf);
	await page.close();
	console.log(`  ${t.size}x${t.size}  ${(buf.length / 1024).toFixed(1).padStart(6)} KB  ${t.file}`);
}

await browser.close();
console.log(`\nwrote ${TARGETS.length} icon(s) to ${relative(ROOT, OUT)}`);

#!/usr/bin/env node
// Head images for the Grok for Startups announcement. Two looks:
//
//   Program card (default), in the format SpaceXSI members post: our lockup
//   top left, a fine line-art figure, and the program badge bottom left (the
//   SpaceXSI symbol, "Super Intelligence", a rule, "Grok for Startups"). The
//   figure is an original wireframe torus drawn here from its parametric
//   equation, so it reads as 3D, which is what three.ws does.
//     head.png         1200x675 (16:9, the X timeline crop)
//     head-square.png  1080x1080
//
//   Logo pairing, in the format of Grok's integration announcements: our
//   lockup and the Grok logo split by a thin rule, nothing else.
//     pair.png         1200x675 on light
//     pair-dark.png    1200x675 on dark
//
// All four render at 2x. Every mark is an official file drawn unaltered at its
// own aspect ratio:
//   public/brand/three-ws-lockup-on-{light,dark}.png  our press kit lockups
//   public/marks/grok-full-logomark-{dark,light}.svg and
//   public/marks/spacexai-symbol-white-transparent.svg  byte for byte the
//     matching files of the SpaceXAI_Grok_Assets kit linked at
//     https://x.ai/legal/brand-guidelines, which require logos exactly as
//     provided.
//
//   node scripts/grok-startups-announce-card.mjs   -> all four PNGs

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const file = (path, type) => `data:${type};base64,${readFileSync(resolve(path)).toString('base64')}`;
const outDir = resolve('public/x-media/grok-startups-announce');
const inter = file('public/fonts/inter-latin.woff2', 'font/woff2');

// Wireframe torus: one closed meridian ring per step around the tube, tilted
// toward the viewer and projected orthographically. Rings nearer the viewer
// are drawn brighter, so the figure has depth with no fill or shading.
function torus({ width, height, rings = 40, tilt = 1.02, turn = 0.16 }) {
	const R = 1;
	const r = 0.4;
	const scale = Math.min(width / (2 * (R + r)), height / (2 * (R + r))) * 0.98;
	const project = (x, y, z) => {
		const y1 = y * Math.cos(tilt) - z * Math.sin(tilt);
		const z1 = y * Math.sin(tilt) + z * Math.cos(tilt);
		const x2 = x * Math.cos(turn) + z1 * Math.sin(turn);
		const z2 = -x * Math.sin(turn) + z1 * Math.cos(turn);
		return [width / 2 + x2 * scale, height / 2 + y1 * scale, z2];
	};
	const paths = [];
	for (let i = 0; i < rings; i++) {
		const u = (i / rings) * Math.PI * 2;
		let d = '';
		let depth = 0;
		const steps = 96;
		for (let j = 0; j <= steps; j++) {
			const v = (j / steps) * Math.PI * 2;
			const [px, py, pz] = project((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v));
			d += `${j ? 'L' : 'M'}${px.toFixed(2)} ${py.toFixed(2)}`;
			depth += pz;
		}
		const near = (depth / (steps + 1) + R + r) / (2 * (R + r));
		paths.push(`<path d="${d}Z" stroke-opacity="${(0.1 + near * 0.42).toFixed(3)}"/>`);
	}
	return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" stroke="#fff" stroke-width="1.1">${paths.join('')}</svg>`;
}

const badge = `
	<div class="badge">
		<img class="x" src="${file('public/marks/spacexai-symbol-white-transparent.svg', 'image/svg+xml')}" alt="SpaceXSI">
		<span>Super<br>Intelligence</span>
		<i></i>
		<span>Grok for<br>Startups</span>
	</div>`;

const base = `
	@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${inter}') format('woff2'); }
	body { margin: 0; overflow: hidden; color: #fff; font-family: 'Inter', sans-serif; }
	.badge { display: flex; align-items: center; }
	.badge .x { width: auto; }
	.badge span { font-weight: 400; letter-spacing: -0.01em; }
	.badge i { width: 1.5px; background: rgba(255, 255, 255, 0.75); }`;

const ours = (theme) => `<img class="ours" src="${file(`public/brand/three-ws-lockup-on-${theme}.png`, 'image/png')}" alt="three.ws">`;

const cards = {
	'head.png': {
		size: [1200, 675],
		html: `<style>${base}
			body { width: 1200px; height: 675px; background: #050507; position: relative; }
			.figure { position: absolute; right: -70px; top: 50%; transform: translateY(-50%); }
			.left { position: absolute; left: 88px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 92px; }
			.ours { height: 84px; width: auto; align-self: flex-start; }
			.badge { gap: 24px; font-size: 25px; line-height: 1.18; }
			.badge .x { height: 30px; margin-right: -4px; }
			.badge i { height: 54px; }
		</style>
		<div class="figure">${torus({ width: 700, height: 640 })}</div>
		<div class="left">${ours('dark')}${badge}</div>`,
	},
	'head-square.png': {
		size: [1080, 1080],
		html: `<style>${base}
			body { width: 1080px; height: 1080px; background: #050507; position: relative; }
			.ours { position: absolute; left: 80px; top: 76px; height: 78px; width: auto; }
			.figure { position: absolute; left: 0; right: 0; top: 196px; display: flex; justify-content: center; }
			.badge { position: absolute; left: 80px; bottom: 76px; gap: 24px; font-size: 26px; line-height: 1.18; }
			.badge .x { height: 31px; margin-right: -4px; }
			.badge i { height: 56px; }
		</style>
		${ours('dark')}
		<div class="figure">${torus({ width: 1000, height: 700 })}</div>
		${badge}`,
	},
	'pair.png': pair({ bg: '#f4f4f6', rule: '#c4c4ca', ours: 'light', grok: 'dark' }),
	'pair-dark.png': pair({ bg: '#0b0b0d', rule: '#3a3a40', ours: 'dark', grok: 'light' }),
};

// The two wordmarks share one cap height (the "G" is 0.48 of the Grok file's
// height, the "h" ascender 0.52 of the lockup's), which also leaves the cube
// and the Grok symbol the same size; the rule sits evenly between the marks.
function pair(theme) {
	return {
		size: [1200, 675],
		html: `<style>
			body { margin: 0; width: 1200px; height: 675px; overflow: hidden; background: ${theme.bg};
				display: flex; align-items: center; justify-content: center; }
			.ours { height: 112px; width: auto; }
			.rule { width: 2px; height: 132px; background: ${theme.rule}; margin: 0 68px; }
			.grok { height: 122px; width: auto; }
		</style>
		${ours(theme.ours)}
		<div class="rule"></div>
		<img class="grok" src="${file(`public/marks/grok-full-logomark-${theme.grok}.svg`, 'image/svg+xml')}" alt="Grok">`,
	};
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
for (const [name, { size, html }] of Object.entries(cards)) {
	const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 2 });
	await page.setContent(`<!doctype html><meta charset="utf-8">${html}`, { waitUntil: 'load' });
	await page.evaluate(async (needsInter) => {
		await document.fonts.ready;
		await Promise.all([...document.images].map((img) => img.decode()));
		if (needsInter && !document.fonts.check("400 25px 'Inter'")) throw new Error('Inter did not load');
	}, html.includes('class="badge"'));
	const out = resolve(outDir, name);
	await page.screenshot({ path: out });
	await page.close();
	console.log(`card: ${out}`);
}
await browser.close();

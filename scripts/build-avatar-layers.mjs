// Generate the starter texture-layer catalog for the Parametric avatar.
//
//   node scripts/build-avatar-layers.mjs
//
// Output: public/avatars/layers/<id>.png plus index.json. Every sprite is drawn
// here from procedural SVG (seeded PRNG, no external art), so the catalog is
// self-authored and CC0; see public/avatars/layers/LICENSES.
//
// Sprites are authored upright. Face sprites carry uv.rotation -90 in the index
// because the Parametric base unwraps the head sideways: world up is image-left
// (decreasing u) and the avatar's right side is image-up (decreasing v). The
// landmark offsets below were measured from the base GLB: the mouth centre
// (teeth mesh) maps to uv (0.901, 0.517), the eye centres (eyes mesh) to
// (0.84, 0.482/0.552), the nose tip to (0.873, 0.517).

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/avatars/layers');

function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const svg = (w, h, body, defs = '') =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
const soft = (id, stops) =>
	`<radialGradient id="${id}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;

const FACE = { rotation: -90 };
const entries = [];

function add(id, kind, label, w, h, body, defs, defaults) {
	entries.push({ id, kind, label, w, h, svg: svg(w, h, body, defs), defaults });
}

// ── Complexion: full-texture ramps, sampled with bilinear filtering ─────────
add('sun-kissed', 'complexion', 'Sun-kissed', 256, 256,
	'<rect width="256" height="256" fill="url(#g)"/>',
	'<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb066"/><stop offset="1" stop-color="#ffd2a1"/></linearGradient>',
	{ region: 'all', blend: 'multiply', opacity: 0.45, uv: { offset: [0.5, 0.5], scale: 1, rotation: 0 } });
add('porcelain', 'complexion', 'Porcelain', 256, 256,
	'<rect width="256" height="256" fill="#d8e6ff"/>', '',
	{ region: 'all', blend: 'multiply', opacity: 0.3, uv: { offset: [0.5, 0.5], scale: 1, rotation: 0 } });
add('ruddy', 'complexion', 'Ruddy', 256, 256,
	'<rect width="256" height="256" fill="#e0524a"/>', '',
	{ region: 'all', blend: 'overlay', opacity: 0.28, uv: { offset: [0.5, 0.5], scale: 1, rotation: 0 } });
add('flushed-face', 'complexion', 'Flushed face', 256, 256,
	'<rect width="256" height="256" fill="url(#g)"/>',
	soft('g', [[0, '#ff7a8a', 0.9], [0.6, '#ff7a8a', 0.35], [1, '#ff7a8a', 0]]),
	{ region: 'scalp', blend: 'normal', opacity: 0.35, uv: { offset: [0.82, 0.517], scale: 0.3, ...FACE } });

// ── Makeup: white shapes, coloured by `tint` ────────────────────────────────
add('lips', 'makeup', 'Lipstick', 256, 128,
	'<path d="M20 66 C54 34 96 30 128 52 C160 30 202 34 236 66 C206 100 164 112 128 104 C92 112 50 100 20 66 Z" fill="#fff"/>', '',
	{ region: 'scalp', blend: 'normal', opacity: 0.85, tint: '#b02a4a', uv: { offset: [0.903, 0.517], scale: 0.056, ...FACE } });
add('blush', 'makeup', 'Blush', 512, 256,
	'<ellipse cx="96" cy="132" rx="92" ry="70" fill="url(#g)"/><ellipse cx="416" cy="132" rx="92" ry="70" fill="url(#g)"/>',
	soft('g', [[0, '#fff', 0.9], [1, '#fff', 0]]),
	{ region: 'scalp', blend: 'normal', opacity: 0.5, tint: '#ff6f8f', uv: { offset: [0.868, 0.517], scale: 0.2, ...FACE } });
add('eyeshadow', 'makeup', 'Eyeshadow', 512, 160,
	'<ellipse cx="108" cy="90" rx="96" ry="50" fill="url(#g)"/><ellipse cx="404" cy="90" rx="96" ry="50" fill="url(#g)"/>',
	soft('g', [[0, '#fff', 0.95], [1, '#fff', 0]]),
	{ region: 'scalp', blend: 'multiply', opacity: 0.6, tint: '#7a4f9a', uv: { offset: [0.826, 0.517], scale: 0.18, ...FACE } });
add('eyeliner', 'makeup', 'Eyeliner', 512, 128,
	'<path d="M32 78 C70 40 130 36 176 70" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><path d="M336 70 C382 36 442 40 480 78" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>', '',
	{ region: 'scalp', blend: 'normal', opacity: 0.9, tint: '#1b1416', uv: { offset: [0.842, 0.517], scale: 0.16, ...FACE } });
{
	const r = rng(7);
	let dots = '';
	for (let i = 0; i < 90; i++) {
		const side = i % 2 ? 1 : -1;
		const x = 256 + side * (30 + r() * 190);
		const y = 40 + r() * 150;
		const d = 3 + r() * 5;
		dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${d.toFixed(1)}" fill="#fff" fill-opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
	}
	add('freckles', 'makeup', 'Freckles', 512, 224, dots, '',
		{ region: 'scalp', blend: 'multiply', opacity: 0.7, tint: '#8a5230', uv: { offset: [0.862, 0.517], scale: 0.17, ...FACE } });
}
add('war-stripes', 'makeup', 'Face stripes', 512, 256,
	'<path d="M20 70 L170 110" stroke="#fff" stroke-width="20" stroke-linecap="round"/><path d="M28 120 L178 160" stroke="#fff" stroke-width="20" stroke-linecap="round"/><path d="M492 70 L342 110" stroke="#fff" stroke-width="20" stroke-linecap="round"/><path d="M484 120 L334 160" stroke="#fff" stroke-width="20" stroke-linecap="round"/>', '',
	{ region: 'scalp', blend: 'normal', opacity: 0.85, tint: '#e9e2d0', uv: { offset: [0.865, 0.517], scale: 0.21, ...FACE } });

// ── Tattoos: ink shapes, coloured by `tint`, body regions only ──────────────
{
	let z = '';
	for (let i = 0; i < 6; i++) z += `<path d="M24 ${40 + i * 70} L96 ${5 + i * 70} L168 ${40 + i * 70} L96 ${75 + i * 70} Z" fill="#fff"/>`;
	add('tribal-band', 'tattoo', 'Tribal band', 192, 460,
		`<rect x="8" y="0" width="12" height="460" fill="#fff"/><rect x="172" y="0" width="12" height="460" fill="#fff"/>${z}`, '',
		{ region: 'upperArms', blend: 'multiply', opacity: 0.85, tint: '#1d2230', uv: { offset: [0.215, 0.215], scale: 0.05, rotation: 0 } });
}
{
	let rays = '';
	for (let i = 0; i < 16; i++) {
		const a = (i / 16) * Math.PI * 2;
		rays += `<path d="M${256 + Math.cos(a - 0.09) * 120} ${256 + Math.sin(a - 0.09) * 120} L${256 + Math.cos(a) * 230} ${256 + Math.sin(a) * 230} L${256 + Math.cos(a + 0.09) * 120} ${256 + Math.sin(a + 0.09) * 120} Z" fill="#fff"/>`;
	}
	add('sun-mandala', 'tattoo', 'Sun mandala', 512, 512,
		`<circle cx="256" cy="256" r="104" fill="none" stroke="#fff" stroke-width="14"/><circle cx="256" cy="256" r="56" fill="#fff"/>${rays}`, '',
		{ region: 'torso', blend: 'multiply', opacity: 0.8, tint: '#1d2230', uv: { offset: [0.38, 0.17], scale: 0.1, rotation: 0 } });
}
add('wave-band', 'tattoo', 'Wave band', 192, 460,
	'<path d="M30 0 C130 40 130 80 30 120 C130 160 130 200 30 240 C130 280 130 320 30 360 C130 400 130 440 30 460" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/><path d="M80 0 C170 40 170 80 80 120 C170 160 170 200 80 240 C170 280 170 320 80 360 C170 400 170 440 80 460" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"/>', '',
	{ region: 'lowerLegs', blend: 'multiply', opacity: 0.8, tint: '#1d3a4a', uv: { offset: [0.19, 0.76], scale: 0.05, rotation: 0 } });
{
	const r = rng(21);
	let s = '';
	for (let i = 0; i < 9; i++) {
		const x = 40 + r() * 400, y = 40 + r() * 400, k = 14 + r() * 26;
		let p = '';
		for (let j = 0; j < 10; j++) {
			const a = (j / 10) * Math.PI * 2 - Math.PI / 2, rr = j % 2 ? k * 0.4 : k;
			p += `${j ? 'L' : 'M'}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)} `;
		}
		s += `<path d="${p}Z" fill="#fff"/>`;
	}
	add('star-scatter', 'tattoo', 'Star scatter', 480, 480, s, '',
		{ region: 'upperLegs', blend: 'multiply', opacity: 0.8, tint: '#241a3a', uv: { offset: [0.25, 0.6], scale: 0.1, rotation: 0 } });
}

// ── Decals: full-colour stickers ────────────────────────────────────────────
add('star-badge', 'decal', 'Star badge', 256, 256,
	'<path d="M128 14 L158 88 L238 94 L176 146 L196 224 L128 182 L60 224 L80 146 L18 94 L98 88 Z" fill="#ffc83d" stroke="#8a5a00" stroke-width="8" stroke-linejoin="round"/>', '',
	{ region: 'torso', blend: 'normal', opacity: 1, uv: { offset: [0.45, 0.17], scale: 0.05, rotation: 0 } });
add('heart', 'decal', 'Heart', 256, 256,
	'<path d="M128 224 C20 150 20 60 80 44 C108 38 126 56 128 74 C130 56 148 38 176 44 C236 60 236 150 128 224 Z" fill="#e0344f" stroke="#7a0f22" stroke-width="8" stroke-linejoin="round"/>', '',
	{ region: 'upperArms', blend: 'normal', opacity: 1, uv: { offset: [0.566, 0.215], scale: 0.04, rotation: 0 } });
add('bolt', 'decal', 'Lightning bolt', 192, 256,
	'<path d="M120 8 L28 150 L88 150 L66 248 L168 100 L104 100 Z" fill="#ffe14a" stroke="#7a5a00" stroke-width="8" stroke-linejoin="round"/>', '',
	{ region: 'upperLegs', blend: 'normal', opacity: 1, uv: { offset: [0.52, 0.6], scale: 0.04, rotation: 0 } });

await mkdir(OUT, { recursive: true });
const index = [];
for (const e of entries) {
	const file = `${e.id}.png`;
	await sharp(Buffer.from(e.svg)).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
	index.push({ id: e.id, kind: e.kind, label: e.label, file, width: e.w, height: e.h, defaults: e.defaults });
}
await writeFile(path.join(OUT, 'index.json'), `${JSON.stringify({ version: 1, layers: index }, null, '\t')}\n`);
await writeFile(
	path.join(OUT, 'LICENSES'),
	'Every sprite in this directory is generated by scripts/build-avatar-layers.mjs from procedural SVG\nwith a seeded PRNG. No third-party art is used. Released under CC0 1.0 (public domain dedication).\n',
);
console.log(`wrote ${index.length} layers to ${OUT}`);

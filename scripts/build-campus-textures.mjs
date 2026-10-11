#!/usr/bin/env node
/**
 * Build the campus surface textures: the ground, paving, walls, floors, roof
 * and rock the homepage world (src/desktop/world/campus.js) is made of.
 *
 * Every set comes from Poly Haven (CC0, public domain, no attribution needed)
 * and is downscaled here so the committed files stay small: the colour map at
 * 1024 or 768 px, the normal and ARM (ambient occlusion / roughness / metal)
 * maps at 512 px, all JPEG. The ledger of what was built, and from where, is
 * written to public/campus/manifest.json and read by the world at runtime.
 *
 * Reproducible: `node scripts/build-campus-textures.mjs` rebuilds everything;
 * `--only=<name>` rebuilds one set.
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'campus');
const TEX = join(OUT, 'textures');
const DL = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k';
const UA = { 'User-Agent': 'three.ws-campus-textures/1.0' };

/** The sets the campus uses, what each is for, and how large the colour map may be. */
export const SETS = [
	{ name: 'leafy_grass', role: 'ground', diffuse: 1024, metresPerTile: 3 },
	{ name: 'patterned_paving', role: 'plaza', diffuse: 1024, metresPerTile: 3 },
	{ name: 'concrete_pavement_03', role: 'path', diffuse: 1024, metresPerTile: 2.5 },
	{ name: 'plastered_wall_04', role: 'wall', diffuse: 768, metresPerTile: 3 },
	{ name: 'brick_wall_10', role: 'brick', diffuse: 1024, metresPerTile: 2.5 },
	{ name: 'wood_floor', role: 'floor-wood', diffuse: 1024, metresPerTile: 2.5 },
	{ name: 'marble_01', role: 'floor-marble', diffuse: 768, metresPerTile: 3 },
	{ name: 'concrete_floor_01', role: 'floor-concrete', diffuse: 768, metresPerTile: 3 },
	{ name: 'rock_wall_03', role: 'rock', diffuse: 1024, metresPerTile: 4 },
	{ name: 'grey_roof_01', role: 'roof', diffuse: 768, metresPerTile: 2.5 },
];

const MAPS = [
	{ key: 'diff', suffix: 'diff', size: (s) => s.diffuse, quality: 78 },
	{ key: 'nor', suffix: 'nor_gl', size: () => 512, quality: 82 },
	{ key: 'arm', suffix: 'arm', size: () => 512, quality: 80 },
];

async function fetchBuf(url) {
	const r = await fetch(url, { headers: UA });
	if (!r.ok) throw new Error(`${r.status} ${url}`);
	return Buffer.from(await r.arrayBuffer());
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const { default: sharp } = await import('sharp');
mkdirSync(TEX, { recursive: true });

const manifest = { license: 'CC0', source: 'https://polyhaven.com', sets: {} };
for (const set of SETS) {
	if (only && set.name !== only) continue;
	const files = {};
	let bytes = 0;
	for (const map of MAPS) {
		const src = await fetchBuf(`${DL}/${set.name}/${set.name}_${map.suffix}_1k.jpg`);
		const file = `${set.name}_${map.key}.jpg`;
		const out = join(TEX, file);
		await sharp(src).resize(map.size(set), map.size(set), { fit: 'fill' }).jpeg({ quality: map.quality, mozjpeg: true }).toFile(out);
		const size = statSync(out).size;
		bytes += size;
		files[map.key] = `/campus/textures/${file}`;
	}
	manifest.sets[set.name] = { role: set.role, metresPerTile: set.metresPerTile, bytes, ...files, page: `https://polyhaven.com/a/${set.name}` };
	process.stdout.write(`${set.name.padEnd(22)} ${(bytes / 1024).toFixed(0).padStart(5)} KB\n`);
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
const total = Object.values(manifest.sets).reduce((n, s) => n + s.bytes, 0);
console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}`);

#!/usr/bin/env node
/**
 * Ingest Kenney's Graveyard Kit (CC0, https://kenney.nl/assets/graveyard-kit) into
 * the three.ws object library.
 *
 * Kenney ships each GLB with an external Textures/colormap.png. This script
 * downloads the kit through Kenney's own download button flow (or reads a zip you
 * already have), inlines the shared texture so every model is one self-contained
 * file, measures it, and writes
 *   public/objects/kenney-graveyard/glb/<slug>.glb
 *   public/objects/kenney-graveyard/catalog.json   (same shape as the other object sources)
 * The same relative path doubles as the R2 key, so scripts/build-object-library.mjs
 * can publish the models alongside Poly Haven and SimReady with no special case.
 *
 * Re-runnable: output is deterministic for a given kit version.
 *
 * Usage:
 *   node scripts/ingest-kenney-graveyard.mjs                  # download + build
 *   node scripts/ingest-kenney-graveyard.mjs --zip=./kit.zip  # use a local copy
 *   node scripts/ingest-kenney-graveyard.mjs --upload         # also PUT the GLBs to R2 (needs R2 creds)
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { unzipSync } from 'fflate';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'public', 'objects', 'kenney-graveyard');
const GLB_DIR = join(OUT, 'glb');

const PAGE = 'https://kenney.nl/assets/graveyard-kit';
const DOWNLOAD_ID = '6173736574732f6772617665796172642d6b6974'; // hex of "assets/graveyard-kit"
const UA = 'Mozilla/5.0 three.ws-asset-ingest/1.0';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
	const m = a.match(/^--([^=]+)(?:=(.*))?$/);
	return m ? [m[1], m[2] ?? true] : [a, true];
}));

async function downloadKit() {
	const link = await fetch(`https://kenney.nl/download-link/${DOWNLOAD_ID}`, { headers: { 'User-Agent': UA, Referer: PAGE, Accept: 'application/json' } });
	if (!link.ok) throw new Error(`Kenney download-link answered ${link.status}`);
	const { url } = await link.json();
	if (!url) throw new Error('Kenney download-link returned no url');
	const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: PAGE } });
	if (!res.ok) throw new Error(`Kenney zip answered ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

const CATEGORY_RULES = [
	[/^character-/, ['halloween', 'characters']],
	[/^pumpkin/, ['halloween', 'pumpkins']],
	[/^(candle|lantern|lightpost|fire-basket)/, ['halloween', 'lighting']],
	[/^(crypt)/, ['halloween', 'architecture']],
	[/^(grave|gravestone|coffin|cross|altar|urn)/, ['halloween', 'graves']],
	[/^(fence|iron-fence|stone-wall|brick-wall|border-pillar|column|pillar)/, ['halloween', 'walls-and-fences']],
	[/^(pine|trunk|rocks|hay-bale)/, ['halloween', 'nature']],
];
const categoriesFor = (slug) => (CATEGORY_RULES.find(([re]) => re.test(slug)) || [null, ['halloween', 'props']])[1];

const titleCase = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

function triangleCount(doc) {
	let n = 0;
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			const idx = prim.getIndices();
			const pos = prim.getAttribute('POSITION');
			n += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
		}
	}
	return Math.round(n);
}

const zipBytes = args.zip ? new Uint8Array(readFileSync(resolve(String(args.zip)))) : await downloadKit();
const files = unzipSync(zipBytes, { filter: (f) => /^Models\/GLB format\//.test(f.name) || f.name === 'License.txt' });

const license = files['License.txt'] ? Buffer.from(files['License.txt']).toString('utf8') : '';
if (!/Creative Commons Zero|CC0/i.test(license)) throw new Error('Kit license is not CC0; refusing to ingest.');
const version = (license.match(/Graveyard Kit \(([\d.]+)\)/) || [])[1] || 'unknown';

const scratch = mkdtempSync(join(tmpdir(), 'kenney-'));
try {
	for (const [name, bytes] of Object.entries(files)) {
		if (!name.startsWith('Models/GLB format/') || name.endsWith('/')) continue;
		const dest = join(scratch, name.slice('Models/GLB format/'.length));
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, bytes);
	}
	mkdirSync(GLB_DIR, { recursive: true });

	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const models = {};
	const glbNames = Object.keys(files).filter((n) => /^Models\/GLB format\/[^/]+\.glb$/.test(n)).sort();
	if (!glbNames.length) throw new Error('No GLB models found in the kit; its layout may have changed.');

	for (const name of glbNames) {
		const slug = basename(name, '.glb');
		const doc = await io.read(join(scratch, `${slug}.glb`));
		const bytes = await io.writeBinary(doc);
		writeFileSync(join(GLB_DIR, `${slug}.glb`), bytes);
		const bounds = getBounds(doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]);
		const size = bounds.max.map((v, i) => +(v - bounds.min[i]).toFixed(4));
		const animations = doc.getRoot().listAnimations().map((a) => a.getName()).filter(Boolean);
		const cats = categoriesFor(slug);
		models[slug] = {
			slug,
			name: titleCase(slug),
			status: 'done',
			source: 'kenney-graveyard',
			license: 'CC0',
			authors: ['Kenney'],
			attribution: `Graveyard Kit ${version} by Kenney (kenney.nl), CC0, ${PAGE}`,
			categories: cats,
			tags: [...new Set([...cats, ...slug.split('-')])].filter((t) => t.length > 1),
			glb_file: `objects/kenney-graveyard/glb/${slug}.glb`,
			glb_bytes: bytes.byteLength,
			triangles: triangleCount(doc),
			meshes: doc.getRoot().listMeshes().length,
			materials: doc.getRoot().listMaterials().length,
			size_m: size,
			...(animations.length ? { animations } : {}),
		};
	}

	const catalog = {
		source: { name: 'Kenney Graveyard Kit', version, url: PAGE, license: 'CC0 1.0 Universal', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
		license: 'CC0',
		models,
	};
	writeFileSync(join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
	console.log(`Kenney Graveyard Kit ${version}: ${Object.keys(models).length} models -> ${GLB_DIR}`);

	if (args.upload) {
		const { putObject } = await import('./lib/asset-r2.mjs');
		for (const m of Object.values(models)) {
			await putObject(m.glb_file, readFileSync(join(GLB_DIR, `${m.slug}.glb`)), 'model/gltf-binary');
		}
		console.log(`Uploaded ${Object.keys(models).length} GLBs to R2.`);
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
if (!existsSync(join(OUT, 'catalog.json'))) process.exit(1);

// Proves Restyle Studio edits one part of a part-separated GLB without
// touching the others, on real output (e.g. a model-partcrafter or
// workers/segment GLB). Drives the real page in Chromium: loads the file,
// selects one part from the Parts panel, applies a material preset, returns
// to whole-model mode, exports, then diffs every part node of the exported
// GLB against the source file.
// Usage: node scripts/verify-restyle-parts.mjs <part-separated.glb> [part index] [preset label] [page url]
// Exit 0 when only the chosen part's material changed and every part kept its
// name and vertex count; exit 1 otherwise.
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { NodeIO } from '@gltf-transform/core';

const [glbArg, indexArg = '1', presetLabel = 'Gold', url = 'http://localhost:3000/restyle'] = process.argv.slice(2);
if (!glbArg) {
	console.error('usage: node scripts/verify-restyle-parts.mjs <part-separated.glb> [part index] [preset label] [page url]');
	process.exit(2);
}
const glbPath = resolve(glbArg);
const partIndex = Number(indexArg);

// Top-level node name -> { material signature, vertex count } for a GLB.
async function describeParts(bytes) {
	const doc = await new NodeIO().readBinary(new Uint8Array(bytes));
	const out = {};
	const visit = (node, top) => {
		const mesh = node.getMesh();
		if (mesh) {
			for (const prim of mesh.listPrimitives()) {
				const m = prim.getMaterial();
				const entry = (out[top] ||= { materials: [], vertices: 0 });
				entry.vertices += prim.getAttribute('POSITION')?.getCount() ?? 0;
				entry.materials.push(
					m
						? JSON.stringify({
								color: m.getBaseColorFactor().map((v) => +v.toFixed(4)),
								metal: +m.getMetallicFactor().toFixed(4),
								rough: +m.getRoughnessFactor().toFixed(4),
							})
						: 'none',
				);
			}
		}
		for (const c of node.listChildren()) visit(c, top);
	};
	// Exporters may wrap the parts in a single mesh-less root node (trimesh's
	// "world", three's "Scene"); the parts are the first level with siblings.
	let tops = doc.getRoot().getDefaultScene().listChildren();
	while (tops.length === 1 && !tops[0].getMesh()) tops = tops[0].listChildren();
	for (const t of tops) visit(t, t.getName());
	return out;
}

const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
const problems = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.setInputFiles('#file', glbPath);
await page.waitForSelector('#parts-card:not([hidden]) #parts-list button', { timeout: 60000 });
const partNames = await page.$$eval('#parts-list button', (els) => els.map((e) => e.textContent.trim()));
console.log('parts panel:', partNames);
if (!(partIndex >= 0 && partIndex < partNames.length)) throw new Error(`part index ${partIndex} out of range`);

await page.click(`#parts-list button[data-part-index="${partIndex}"]`);
console.log('note:', (await page.textContent('#parts-note')).trim());
await page.click(`#presets button:has-text("${presetLabel}")`);
await page.click('#part-deselect');

const dir = await mkdtemp(join(tmpdir(), 'restyle-parts-'));
const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#export')]);
const exportedPath = join(dir, 'restyled.glb');
await download.saveAs(exportedPath);
await browser.close();

const before = await describeParts(await readFile(glbPath));
const after = await describeParts(await readFile(exportedPath));
const edited = partNames[partIndex];
let ok = true;
for (const name of Object.keys(before)) {
	const a = before[name];
	const b = after[name];
	if (!b) {
		console.log(`FAIL ${name}: missing from the export`);
		ok = false;
		continue;
	}
	const sameGeometry = a.vertices === b.vertices;
	const sameMaterial = JSON.stringify(a.materials) === JSON.stringify(b.materials);
	const expectChange = name === edited;
	const pass = sameGeometry && (expectChange ? !sameMaterial : sameMaterial);
	ok &&= pass;
	console.log(
		`${pass ? 'ok  ' : 'FAIL'} ${name}: vertices ${a.vertices} -> ${b.vertices}, material ${sameMaterial ? 'unchanged' : 'changed'}${expectChange ? ' (edited part)' : ''}`,
		sameMaterial ? '' : `\n       ${a.materials[0]}\n    -> ${b.materials[0]}`,
	);
}
console.log(problems.length ? `console:\n${problems.join('\n')}` : 'console: clean');
process.exit(ok ? 0 : 1);

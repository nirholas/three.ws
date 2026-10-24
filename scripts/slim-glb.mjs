#!/usr/bin/env node
/**
 * Bring a GLB under a triangle budget, in place, staying inside standard glTF 2.0.
 *
 * scripts/decimate-glb.mjs takes a fixed ratio; a library of CAD-derived assets needs
 * a fixed budget instead, because one folder holds a 4k-triangle stool and a
 * 460k-triangle IV pole. The ratio is derived per file: budget / triangles, capped at 1,
 * so anything already under budget is only deduped, welded and pruned. Textures are
 * left alone (the converter already downsized them).
 *
 *   node scripts/slim-glb.mjs <file.glb> [--tris=80000] [--error=0.002]
 *
 * Prints one JSON line: { tris_before, tris_after, bytes }.
 */
import { statSync } from 'node:fs';
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
	const hit = args.find((a) => a.startsWith(`--${name}=`));
	return hit ? Number(hit.split('=')[1]) : fallback;
};
if (!file) {
	console.error('usage: node scripts/slim-glb.mjs <file.glb> [--tris=80000] [--error=0.002]');
	process.exit(1);
}

const budget = flag('tris', 80000);
const error = flag('error', 0.002);

const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE).registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

const doc = await io.read(file);
const triangles = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
	.reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

const before = triangles();
const steps = [dedup(), weld()];
if (before > budget) {
	steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: budget / before, error, lockBorder: false }));
}
steps.push(prune());
await doc.transform(...steps);
await io.write(file, doc);
console.log(JSON.stringify({ tris_before: before, tris_after: triangles(), bytes: statSync(file).size }));

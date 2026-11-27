#!/usr/bin/env node
// Run every in-browser Forge export format on real models and read each file
// back with an independent parser written from the format's spec, plus the
// Khronos glTF validator for the GLB download.
//
// The conversion code is the page's own (src/forge-export-core.js and
// src/forge-export-files.js); only the image codec differs, because Node has
// no canvas, so the GLB's WebP-to-PNG step uses sharp here and the browser's
// decoder on the page. USDZ is written without textures in Node for the same
// reason (the exporter draws textures through a canvas); the textured path is
// exercised in the browser.
//
// Usage:
//   node scripts/forge/validate-exports.mjs [url-or-path ...]
// With no arguments it runs the three public reference models: an untextured
// older NVIDIA output, a textured self-hosted TRELLIS output (and its
// meshopt-compressed delivery variant), and a rigged avatar.

import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import validator from 'gltf-validator';

globalThis.self ??= globalThis; // GLTFLoader probes `self`; Node has none.

const core = await import('../../src/forge-export-core.js');
const files = await import('../../src/forge-export-files.js');

const DEFAULT_MODELS = [
	['plain', 'https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb'],
	['textured', 'https://three.ws/cdn/forge/ca86288c9687/92389c8c-64ff-4820-b968-41a3be4e1c1e.glb'],
	['textured, delivery variant', 'https://three.ws/cdn/forge/ca86288c9687/92389c8c-64ff-4820-b968-41a3be4e1c1e.web.glb'],
	[
		'rigged',
		'https://storage.googleapis.com/three-ws-avatar-reconstructions/rigged-meshes/19428125-02b5-434a-9c10-c04a48a7f9d9.glb',
	],
];

async function load(src) {
	if (/^https?:/.test(src)) {
		const res = await fetch(src);
		if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	}
	return new Uint8Array(await readFile(src));
}

const transcode = async (bytes) => new Uint8Array(await sharp(Buffer.from(bytes)).png().toBuffer());

function readStl(b) {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const n = dv.getUint32(80, true);
	if (b.byteLength !== 84 + n * 50) throw new Error(`STL size ${b.byteLength} != 84 + 50 x ${n}`);
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let t = 0; t < n; t++) {
		for (let v = 0; v < 3; v++) {
			for (let a = 0; a < 3; a++) {
				const x = dv.getFloat32(84 + t * 50 + 12 + v * 12 + a * 4, true);
				if (!Number.isFinite(x)) throw new Error('STL has a non-finite coordinate');
				min[a] = Math.min(min[a], x);
				max[a] = Math.max(max[a], x);
			}
		}
	}
	return { triangles: n, size: max.map((x, i) => x - min[i]), minZ: min[2] };
}

function readObj(text) {
	let v = 0;
	let vn = 0;
	let vt = 0;
	let f = 0;
	for (const line of text.split('\n')) {
		if (line.startsWith('v ')) v++;
		else if (line.startsWith('vn ')) vn++;
		else if (line.startsWith('vt ')) vt++;
		else if (line.startsWith('f ')) {
			const refs = line.trim().split(/\s+/).slice(1);
			for (const r of refs) {
				const i = Number(r.split('/')[0]);
				if (!(i >= 1 && i <= v)) throw new Error(`OBJ face index ${i} out of range`);
			}
			f += refs.length - 2;
		}
	}
	return { vertices: v, normals: vn, uvs: vt, triangles: f };
}

function readPly(b) {
	const end = Buffer.from(b).indexOf('end_header\n');
	const head = Buffer.from(b.subarray(0, end)).toString('latin1');
	if (!/format binary_little_endian 1\.0/.test(head)) throw new Error('PLY is not binary little-endian');
	const vertices = Number(head.match(/element vertex (\d+)/)[1]);
	const faces = Number(head.match(/element face (\d+)/)[1]);
	const props = [...head.matchAll(/^property (float|uchar) (\w+)$/gm)];
	const stride = props.reduce((s, m) => s + (m[1] === 'float' ? 4 : 1), 0);
	const expected = end + 11 + vertices * stride + faces * 13;
	if (b.byteLength !== expected) throw new Error(`PLY size ${b.byteLength} != ${expected}`);
	return { vertices, faces, props: props.map((m) => m[2]).join(' ') };
}

function readUsdz(b) {
	const entries = unzipSync(b);
	const names = Object.keys(entries);
	const root = strFromU8(entries[names[0]]);
	let points = 0;
	for (const n of names.slice(1)) {
		if (!n.endsWith('.usda')) continue;
		const m = strFromU8(entries[n]).match(/point3f\[\] points = \[([^\]]*)\]/);
		if (m) points += m[1].split('),').length;
	}
	return { upY: /upAxis = "Y"/.test(root), metersPerUnit: /metersPerUnit = 1/.test(root), points, files: names.length };
}

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const mm = (s) => s.map((x) => x.toFixed(1)).join(' x ');

const targets = process.argv.length > 2 ? process.argv.slice(2).map((s) => [s, s]) : DEFAULT_MODELS;
let failures = 0;
for (const [label, src] of targets) {
	console.log(`\n${label}: ${src}`);
	const check = async (name, fn) => {
		try {
			console.log(`  ok   ${name}: ${await fn()}`);
		} catch (err) {
			failures++;
			console.log(`  FAIL ${name}: ${err.message}`);
		}
	};
	const bytes = await load(src);
	let baked;
	await check('read', async () => {
		baked = core.collectMeshes(await core.parseGlb(bytes));
		return `${fmt(baked.triangles)} triangles, ${fmt(baked.vertices)} vertices, ${baked.meshes.length} mesh(es), ${(bytes.byteLength / 1e6).toFixed(2)} MB`;
	});
	await check('GLB download', async () => {
		const before = await validator.validateBytes(bytes);
		const needs = files.glbDecodersNeeded(bytes);
		const out = await files.makeGlbPortable(bytes, { transcode });
		const after = await validator.validateBytes(new Uint8Array(out.bytes));
		const left = files.glbDecodersNeeded(out.bytes);
		if (after.issues.numErrors) throw new Error(`${after.issues.numErrors} validator errors`);
		if (!out.reason && left.length) throw new Error(`still needs ${left.join(', ')}`);
		return `needed [${needs.join(', ') || 'nothing'}], re-encoded ${out.transcoded} image(s)${out.reason ? ` (kept as is: ${out.reason})` : ''}, now needs [${left.join(', ') || 'nothing'}], validator errors ${before.issues.numErrors} -> ${after.issues.numErrors}, ${(out.bytes.byteLength / 1e6).toFixed(2)} MB`;
	});
	if (!baked) continue;
	await check('OBJ', async () => {
		const o = readObj(new TextDecoder().decode(await core.writeGeometryFormat('obj', baked.meshes)));
		if (o.triangles !== baked.triangles || o.vertices !== baked.vertices) throw new Error(`counts ${o.triangles}/${o.vertices}`);
		return `${fmt(o.triangles)} triangles, ${fmt(o.vertices)} v, ${fmt(o.normals)} vn, ${fmt(o.uvs)} vt`;
	});
	await check('STL', async () => {
		const s = readStl(await core.writeGeometryFormat('stl', baked.meshes));
		if (s.triangles !== baked.triangles) throw new Error(`${s.triangles} triangles`);
		if (Math.abs(s.minZ) > 1e-3) throw new Error(`lowest point at Z ${s.minZ}`);
		return `${fmt(s.triangles)} triangles, ${mm(s.size)} mm (X x Y x Z), on the bed`;
	});
	await check('PLY', async () => {
		const p = readPly(await core.writeGeometryFormat('ply', baked.meshes));
		if (p.faces !== baked.triangles || p.vertices !== baked.vertices) throw new Error(`counts ${p.faces}/${p.vertices}`);
		return `${fmt(p.faces)} faces, ${fmt(p.vertices)} vertices, properties ${p.props}`;
	});
	await check('USDZ (geometry; textures run in the browser)', async () => {
		const u = readUsdz(await core.writeUsdz(await core.parseGlb(files.withoutTextures(bytes))));
		if (!u.upY || !u.metersPerUnit) throw new Error('missing upAxis Y / metersPerUnit 1');
		return `${fmt(u.points)} points, Y-up, metersPerUnit 1, ${u.files} file(s) in the package`;
	});
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;

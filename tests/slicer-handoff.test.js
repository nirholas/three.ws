// Slicer handoff: the deep-link builder, the bed placement, and the real
// /api/slicer route serving a GLB built in this file as STL and 3MF.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';
import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	SLICERS,
	buildSlicerLink,
	creationIdFromGlbUrl,
	slicerModelUrl,
} from '../src/slicer-handoff.js';
import { placeOnBed, resolvePrintSize } from '../api/_lib/print/slicer.js';
import { loadMesh } from '../api/_lib/print/mesh-io.js';
import { readStlHeader } from '../api/_lib/print/export-stl.js';
import { createSlicerModelHandler } from '../api/slicer/model.js';

const ID = '5b1e8c21-6516-4741-ab2b-1efc838c0cdc';

describe('slicer link builder', () => {
	it('builds a path-only model URL that ends in model.<ext>', () => {
		expect(slicerModelUrl('https://three.ws/', ID)).toBe(`https://three.ws/api/slicer/${ID}/model.stl`);
		expect(slicerModelUrl('https://three.ws', ID.toUpperCase(), { format: '3mf', sizeMm: 80 })).toBe(
			`https://three.ws/api/slicer/${ID}/80mm/model.3mf`,
		);
		expect(() => slicerModelUrl('https://three.ws', 'not-a-uuid')).toThrow(TypeError);
		expect(() => slicerModelUrl('https://three.ws', ID, { format: 'obj' })).toThrow(TypeError);
	});

	it('percent-encodes the whole file URL into the slicer scheme', () => {
		const file = slicerModelUrl('https://three.ws', ID);
		const orca = buildSlicerLink('orca', file);
		expect(orca).toBe(`orcaslicer://open?file=https%3A%2F%2Fthree.ws%2Fapi%2Fslicer%2F${ID}%2Fmodel.stl`);
		expect(decodeURIComponent(orca.split('file=')[1])).toBe(file);
		expect(buildSlicerLink(SLICERS.bambu, file)).toMatch(/^bambustudio:\/\/open\?file=https%3A/);
	});

	it('refuses URLs a slicer would mis-name or cannot fetch', () => {
		expect(() => buildSlicerLink('orca', `https://three.ws/api/slicer/model?id=${ID}`)).toThrow(/query/);
		expect(() => buildSlicerLink('orca', 'blob:https://three.ws/abc')).toThrow(/http/);
		expect(() => buildSlicerLink('prusa', 'https://three.ws/model.stl')).toThrow(/unknown slicer/);
	});

	it('reads the creation id out of forge storage URLs', () => {
		const base = 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/ab12cd';
		expect(creationIdFromGlbUrl(`${base}/${ID}.glb`)).toBe(ID);
		expect(creationIdFromGlbUrl(`${base}/${ID.toUpperCase()}.web.glb`)).toBe(ID);
		expect(creationIdFromGlbUrl('blob:https://three.ws/1234')).toBeNull();
		expect(creationIdFromGlbUrl(null)).toBeNull();
	});
});

describe('bed placement', () => {
	it('keeps believable real-world sizes and rescales the rest to 100 mm', () => {
		expect(resolvePrintSize(0.05)).toEqual({ longestMm: 50, mode: 'real' });
		expect(resolvePrintSize(1)).toEqual({ longestMm: 100, mode: 'auto' });
		expect(resolvePrintSize(0.001)).toEqual({ longestMm: 100, mode: 'auto' });
		expect(resolvePrintSize(1, 80)).toEqual({ longestMm: 80, mode: 'requested' });
		expect(() => resolvePrintSize(1, 900)).toThrow(RangeError);
	});

	it('turns Y-up into Z-up, rests on Z = 0 and centres in XY', () => {
		// A 1 x 2 x 0.5 m box offset from the origin, tallest along glTF +Y.
		const p = [];
		for (const x of [3, 4]) for (const y of [1, 3]) for (const z of [-1, -0.5]) p.push(x, y, z);
		const placed = placeOnBed(Float64Array.from(p));
		expect(placed.mode).toBe('auto');
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < placed.positions.length; i += 3) {
			for (let a = 0; a < 3; a += 1) {
				min[a] = Math.min(min[a], placed.positions[i + a]);
				max[a] = Math.max(max[a], placed.positions[i + a]);
			}
		}
		expect(min[2]).toBeCloseTo(0, 9);
		expect(max[2]).toBeCloseTo(100, 9); // glTF height became slicer height
		expect(max[0] - min[0]).toBeCloseTo(50, 9);
		expect(max[1] - min[1]).toBeCloseTo(25, 9);
		expect(min[0] + max[0]).toBeCloseTo(0, 9);
		expect(min[1] + max[1]).toBeCloseTo(0, 9);
		expect(placed.sizeMm.map((n) => Math.round(n))).toEqual([50, 25, 100]);
	});
});

/** A closed, coloured tetrahedron as real GLB bytes: 4 triangles, 0.2 m tall. */
async function tetraGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const positions = new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0, 0.1, 0.03, 0.2, 0.03]);
	const indices = new Uint16Array([0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0]);
	const material = doc.createMaterial('red').setBaseColorFactor([1, 0, 0, 1]);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
		.setMaterial(material);
	doc.createScene('s').addChild(doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)));
	return new NodeIO().writeBinary(doc);
}

describe('GET /api/slicer/:id/model.stl', () => {
	let server;
	let base;
	let loads = 0;

	beforeAll(async () => {
		const glb = await tetraGlb();
		const handler = createSlicerModelHandler({
			loadSource: async (id, { color }) => {
				if (id !== ID) return null;
				loads += 1;
				return { mesh: await loadMesh(glb, { color }), title: 'A red test tetrahedron' };
			},
		});
		server = createServer((req, res) => handler(req, res));
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		base = `http://127.0.0.1:${server.address().port}`;
	});

	afterAll(() => new Promise((r) => server.close(r)));

	it('serves a binary STL in millimetres, Z-up, on the bed, with cache headers', async () => {
		const res = await fetch(`${base}/api/slicer/model?id=${ID}&format=stl`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('model/stl');
		expect(res.headers.get('cache-control')).toMatch(/s-maxage=86400/);
		expect(res.headers.get('etag')).toMatch(/^"slc-[0-9a-f]{32}"$/);
		expect(res.headers.get('content-disposition')).toBe('attachment; filename="a-red-test-tetrahedron.stl"');
		expect(res.headers.get('x-slicer-scale')).toBe('real');
		const body = Buffer.from(await res.arrayBuffer());
		expect(Number(res.headers.get('content-length'))).toBe(body.length);
		const header = readStlHeader(body);
		expect(header.triangles).toBe(4);
		expect(body.length).toBe(84 + 4 * 50);
		// Every vertex: Z >= 0 with the apex at 200 mm (the glTF 0.2 m height).
		let minZ = Infinity;
		let maxZ = -Infinity;
		for (let t = 0; t < 4; t += 1) {
			for (let v = 0; v < 3; v += 1) {
				const z = body.readFloatLE(84 + t * 50 + 12 + v * 12 + 8);
				minZ = Math.min(minZ, z);
				maxZ = Math.max(maxZ, z);
			}
		}
		expect(minZ).toBeCloseTo(0, 4);
		expect(maxZ).toBeCloseTo(200, 3);
	});

	it('honours a requested size and answers a matching ETag with 304 from cache', async () => {
		const first = await fetch(`${base}/api/slicer/model?id=${ID}&format=stl&size=80`);
		expect(first.status).toBe(200);
		expect(first.headers.get('x-slicer-size-mm').split(' x ').map(Number).sort((a, b) => b - a)[0]).toBe(80);
		await first.arrayBuffer();
		const before = loads;
		const again = await fetch(`${base}/api/slicer/model?id=${ID}&format=stl&size=80`, {
			headers: { 'if-none-match': first.headers.get('etag') },
		});
		expect(again.status).toBe(304);
		expect(loads).toBe(before);
	});

	it('serves a coloured 3MF package', async () => {
		const res = await fetch(`${base}/api/slicer/model?id=${ID}&format=3mf`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('model/3mf');
		const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
		const xml = strFromU8(files['3D/3dmodel.model']);
		expect((xml.match(/<triangle /g) || []).length).toBe(4);
		expect(xml).toMatch(/A red test tetrahedron/);
		expect(xml).toMatch(/#FF0000/i);
	});

	it('rejects bad ids, formats and sizes, and 404s an unknown creation', async () => {
		expect((await fetch(`${base}/api/slicer/model?id=nope&format=stl`)).status).toBe(400);
		expect((await fetch(`${base}/api/slicer/model?id=${ID}&format=obj`)).status).toBe(400);
		expect((await fetch(`${base}/api/slicer/model?id=${ID}&format=stl&size=4`)).status).toBe(400);
		const missing = await fetch(`${base}/api/slicer/model?id=00000000-0000-4000-8000-000000000000&format=stl`);
		expect(missing.status).toBe(404);
		expect((await missing.json()).error).toBe('creation_not_found');
	});

	it('is reachable at the pretty path through the vercel.json route table', () => {
		const routes = JSON.parse(readFileSync(resolve(import.meta.dirname, '../vercel.json'), 'utf8')).routes;
		const rewrite = (path) => {
			for (const r of routes) {
				if (!r.src?.startsWith('/api/slicer/')) continue;
				const m = new RegExp(`^${r.src}$`).exec(path);
				if (m) return r.dest.replace(/\$(\d)/g, (_, i) => m[Number(i)]);
			}
			return null;
		};
		expect(rewrite(`/api/slicer/${ID}/model.stl`)).toBe(`/api/slicer/model?id=${ID}&format=stl`);
		expect(rewrite(`/api/slicer/${ID}/120mm/model.3mf`)).toBe(`/api/slicer/model?id=${ID}&size=120&format=3mf`);
		expect(rewrite(`/api/slicer/${ID}/model.obj`)).toBeNull();
	});
});

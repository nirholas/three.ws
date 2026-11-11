// GET /api/forge/export-pptx: the real handler behind a real HTTP server,
// fed a GLB built in this file. The production loader fetches the creation
// from Postgres and the GLB from storage, and its fetcher refuses loopback
// hosts, so the test hands the factory a loader that returns the same shape;
// everything after that (Office pass, CPU poster render, deck writer, caching,
// headers, error mapping) is the production code path.

import { createServer } from 'node:http';

import { Document, NodeIO } from '@gltf-transform/core';
import { normals } from '@gltf-transform/functions';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	createExportPptxHandler,
	makePoster,
	POSTER_HEIGHT,
	POSTER_WIDTH,
	slideTitle,
	slug,
} from '../api/forge/export-pptx.js';
import { FetchModelError } from '../api/_lib/fetch-model.js';
import { PPTX_MIME } from '../api/_lib/pptx-writer.js';

const ID = '7d3f2a10-4c5b-4e8a-9b21-0c6d5e4f3a21';
const TOO_BIG = '7d3f2a10-4c5b-4e8a-9b21-0c6d5e4f3a22';
const BROKEN = '7d3f2a10-4c5b-4e8a-9b21-0c6d5e4f3a23';
const OFFLINE = '7d3f2a10-4c5b-4e8a-9b21-0c6d5e4f3a24';

/** A red tetrahedron, 0.2 m tall, standing off the origin, with normals. */
async function tetraGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const p = new Float32Array([1, 0, 1, 1.2, 0, 1, 1.1, 0, 1.17, 1.1, 0.2, 1.06]);
	const idx = new Uint16Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
	const prim = doc
		.createPrimitive()
		.setAttribute(
			'POSITION',
			doc.createAccessor().setType('VEC3').setArray(p).setBuffer(buffer),
		)
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
		.setMaterial(doc.createMaterial('red').setBaseColorFactor([0.8, 0.1, 0.1, 1]));
	const scene = doc.createScene();
	scene.addChild(doc.createNode('tetra').setMesh(doc.createMesh().addPrimitive(prim)));
	doc.getRoot().setDefaultScene(scene);
	// Lit like a real generated model, so the poster check can see its colour.
	await doc.transform(normals());
	return new NodeIO().writeBinary(doc);
}

describe('export-pptx helpers', () => {
	it('titles a slide from the prompt, not from a pipeline label', () => {
		expect(slideTitle('a low-poly brass lantern')).toBe('A low-poly brass lantern');
		expect(slideTitle('auto-rig')).toBe('Rigged 3D character');
		expect(slideTitle('image-to-3d')).toBe('3D model from an image');
		expect(slideTitle('   ')).toBe('3D model');
		const long = slideTitle('word '.repeat(40));
		expect(long.length).toBeLessThanOrEqual(83);
		expect(long.endsWith('word...')).toBe(true);
	});

	it('makes a filename-safe slug', () => {
		expect(slug('A low-poly brass lantern!')).toBe('a-low-poly-brass-lantern');
		expect(slug('???')).toBe('three-ws-model');
	});

	it('falls back to a titled card when the model will not render and there is no thumbnail', async () => {
		const poster = await makePoster({ glb_url: null }, 'A test card', new Uint8Array(64));
		expect(poster.source).toBe('card');
		const meta = await sharp(Buffer.from(poster.png)).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual([
			'png',
			POSTER_WIDTH,
			POSTER_HEIGHT,
		]);
	});
});

describe('GET /api/forge/export-pptx', () => {
	let server;
	let base;
	let loads = 0;

	beforeAll(async () => {
		const glb = await tetraGlb();
		const handler = createExportPptxHandler({
			loadSource: async (id) => {
				loads += 1;
				if (id === TOO_BIG)
					throw new FetchModelError('file exceeds 100 MB', 'file_too_large');
				if (id === OFFLINE) throw new FetchModelError('upstream 503', 'upstream_error');
				if (id === BROKEN)
					return {
						creation: { id, prompt: 'broken', glb_url: null },
						glb: new TextEncoder().encode('not a model at all, just some words'),
					};
				if (id !== ID) return null;
				return {
					creation: {
						id,
						prompt: 'a red test tetrahedron',
						creator_username: 'tester',
						glb_url: null,
					},
					glb,
				};
			},
		});
		server = createServer((req, res) => handler(req, res));
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		base = `http://127.0.0.1:${server.address().port}`;
	});

	afterAll(() => new Promise((r) => server.close(r)));

	it('streams a deck with the 3D model, a rendered poster and a good filename', async () => {
		const res = await fetch(`${base}/api/forge/export-pptx?id=${ID}`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe(PPTX_MIME);
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="a-red-test-tetrahedron.pptx"',
		);
		expect(res.headers.get('cache-control')).toMatch(/s-maxage=86400/);
		expect(res.headers.get('etag')).toMatch(/^"pptx-[0-9a-f]{32}"$/);
		expect(res.headers.get('x-pptx-poster')).toBe('render');
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		expect(res.headers.get('access-control-expose-headers')).toMatch(/content-disposition/);
		const body = new Uint8Array(await res.arrayBuffer());
		expect(Number(res.headers.get('content-length'))).toBe(body.length);

		const files = unzipSync(body);
		const glb = files['ppt/media/model3d1.glb'];
		expect(strFromU8(glb.slice(0, 4))).toBe('glTF');
		const slide = strFromU8(files['ppt/slides/slide1.xml']);
		expect(slide).toContain('<am3d:model3d r:embed="rId2">');
		expect(slide).toContain('A red test tetrahedron');
		expect(slide).toContain(
			`by @tester. Drag the model to rotate it. https://three.ws/m/${ID}`,
		);

		// The poster is a real render: a transparent cut-out with the model's red in it.
		const { data, info } = await sharp(Buffer.from(files['ppt/media/image1.png']))
			.raw()
			.toBuffer({ resolveWithObject: true });
		expect([info.width, info.height, info.channels]).toEqual([POSTER_WIDTH, POSTER_HEIGHT, 4]);
		let opaque = 0;
		let reddish = 0;
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] > 200) {
				opaque++;
				if (data[i] > data[i + 1] * 1.5 && data[i] > data[i + 2] * 1.5) reddish++;
			}
		}
		expect(data[3]).toBe(0);
		expect(opaque).toBeGreaterThan(1000);
		expect(reddish / opaque).toBeGreaterThan(0.5);
	});

	it('serves repeats from cache and answers If-None-Match with 304', async () => {
		const before = loads;
		const first = await fetch(`${base}/api/forge/export-pptx?id=${ID.toUpperCase()}`);
		expect(first.status).toBe(200);
		await first.arrayBuffer();
		const again = await fetch(`${base}/api/forge/export-pptx?id=${ID}`, {
			headers: { 'if-none-match': first.headers.get('etag') },
		});
		expect(again.status).toBe(304);
		expect(loads).toBe(before);
	});

	it('rejects an id that is not a UUID', async () => {
		const res = await fetch(`${base}/api/forge/export-pptx?id=nope`);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('validation_error');
	});

	it('404s an unknown or private creation', async () => {
		const res = await fetch(`${base}/api/forge/export-pptx?id=${ID.replace(/1$/, '9')}`);
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe('creation_not_found');
	});

	it('tells the user what to do when the model is too big for a slide', async () => {
		const res = await fetch(`${base}/api/forge/export-pptx?id=${TOO_BIG}`);
		expect(res.status).toBe(413);
		const body = await res.json();
		expect(body.error).toBe('model_too_large');
		expect(body.error_description || body.message).toMatch(/Insert > 3D Models/);
	});

	it('maps a storage outage to a retryable 502', async () => {
		const res = await fetch(`${base}/api/forge/export-pptx?id=${OFFLINE}`);
		expect(res.status).toBe(502);
		expect((await res.json()).error).toBe('model_unavailable');
	});

	it('maps an unreadable model to 422', async () => {
		const res = await fetch(`${base}/api/forge/export-pptx?id=${BROKEN}`);
		expect(res.status).toBe(422);
		expect((await res.json()).error).toBe('invalid_model');
	});

	it('refuses anything but GET', async () => {
		const res = await fetch(`${base}/api/forge/export-pptx?id=${ID}`, { method: 'POST' });
		expect(res.status).toBe(405);
	});
});

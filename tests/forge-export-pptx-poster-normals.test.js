// The PowerPoint poster for a model that ships without vertex normals.
//
// Forge GLBs from the main reconstruction lane are written by trimesh with
// POSITION and TEXCOORD_0 only: no NORMAL attribute. The CPU rasterizer behind
// renderPoster reads normals straight from the geometry, so a model without
// them was lit by the ambient term alone and the slide's poster came out as a
// flat, pale silhouette (measured on 2026-11-27 against a live go-kart export:
// a dark rust texture rendered as light blue-grey). The poster must show the
// same directional shading the model gets when it does carry normals.

import { Document, NodeIO } from '@gltf-transform/core';
import { normals } from '@gltf-transform/functions';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { renderPoster } from '../api/forge/export-pptx.js';

/** A light grey octahedron, 1 m across, tipped so several faces face the camera. */
async function octaGlb({ withNormals }) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const s = 0.5;
	const raw = [
		[s, 0, 0],
		[-s, 0, 0],
		[0, s, 0],
		[0, -s, 0],
		[0, 0, s],
		[0, 0, -s],
	];
	// Tip it 30 degrees about X and 35 about Y so the faces meet the camera at different angles.
	const ax = (30 * Math.PI) / 180;
	const ay = (35 * Math.PI) / 180;
	const p = new Float32Array(
		raw.flatMap(([x, y, z]) => {
			const y1 = y * Math.cos(ax) - z * Math.sin(ax);
			const z1 = y * Math.sin(ax) + z * Math.cos(ax);
			return [x * Math.cos(ay) + z1 * Math.sin(ay), y1, -x * Math.sin(ay) + z1 * Math.cos(ay)];
		}),
	);
	// Flat faces with their own corners, the way a UV-seamed generated mesh splits them.
	const faces = [
		[0, 2, 4],
		[2, 1, 4],
		[1, 3, 4],
		[3, 0, 4],
		[2, 0, 5],
		[1, 2, 5],
		[3, 1, 5],
		[0, 3, 5],
	];
	const pos = new Float32Array(faces.length * 9);
	faces.forEach((f, i) => f.forEach((v, k) => pos.set(p.subarray(v * 3, v * 3 + 3), i * 9 + k * 3)));
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
		.setMaterial(doc.createMaterial('grey').setBaseColorFactor([0.6, 0.6, 0.6, 1]).setMetallicFactor(0));
	const scene = doc.createScene();
	scene.addChild(doc.createNode('octa').setMesh(doc.createMesh().addPrimitive(prim)));
	doc.getRoot().setDefaultScene(scene);
	if (withNormals) await doc.transform(normals({ overwrite: true }));
	return new NodeIO().writeBinary(doc);
}

/** Luminance of every opaque pixel in a PNG. */
async function opaqueLuma(png) {
	const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const out = [];
	for (let i = 0; i < data.length; i += info.channels) {
		if (data[i + 3] > 250) out.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
	}
	return out;
}

const spread = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.05)];
};

describe('renderPoster on a model without vertex normals', () => {
	it('shades its faces like the same model with normals instead of a flat ambient silhouette', async () => {
		const lit = await opaqueLuma(await renderPoster(await octaGlb({ withNormals: true })));
		const bare = await opaqueLuma(await renderPoster(await octaGlb({ withNormals: false })));
		expect(lit.length).toBeGreaterThan(10_000);
		expect(bare.length).toBeGreaterThan(10_000);
		// The lit model has bright and dark faces; the bare one must too.
		expect(spread(lit)).toBeGreaterThan(40);
		expect(spread(bare)).toBeGreaterThan(spread(lit) * 0.6);
		const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
		expect(Math.abs(mean(bare) - mean(lit))).toBeLessThan(25);
	}, 60_000);
});

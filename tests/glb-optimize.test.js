// Texture and target rules of the in-process optimizer (api/_lib/glb-optimize.js).
// A normal map or a texture whose alpha is read must stay lossless PNG, colour
// data whose alpha is never read may become JPEG, oversize textures are capped
// at the requested edge, and an absurd face target is clamped with a note.
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { clampTarget, OPTIMIZE_LIMITS, optimizeGlb } from '../api/_lib/glb-optimize.js';

const EDGE = 2048;

// A sharp, noisy RGBA image: noise keeps PNG large so the optimizer's resize
// is a real saving, and the alpha channel lets the test see what is kept.
async function noisePng(seed) {
	const px = Buffer.alloc(EDGE * EDGE * 4);
	let s = seed;
	for (let i = 0; i < px.length; i += 4) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		px[i] = s & 255;
		px[i + 1] = (s >> 8) & 255;
		px[i + 2] = (s >> 16) & 255;
		px[i + 3] = 128 + ((s >> 4) & 127);
	}
	return new Uint8Array(await sharp(px, { raw: { width: EDGE, height: EDGE, channels: 4 } }).png().toBuffer());
}

function quad(doc, buffer) {
	const pos = doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
	const uv = doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]));
	const nrm = doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]));
	const idx = doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
	return doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setAttribute('NORMAL', nrm).setIndices(idx);
}

async function threeMaterialGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const tex = async (name, seed) => doc.createTexture(name).setImage(await noisePng(seed)).setMimeType('image/png');
	const opaqueColor = await tex('opaque-color', 1);
	const normal = await tex('normal', 2);
	const blendColor = await tex('blend-color', 3);
	const opaque = doc.createMaterial('opaque').setBaseColorTexture(opaqueColor).setNormalTexture(normal);
	const glass = doc.createMaterial('glass').setBaseColorTexture(blendColor).setAlphaMode('BLEND');
	const mesh = doc.createMesh('m').addPrimitive(quad(doc, buffer).setMaterial(opaque)).addPrimitive(quad(doc, buffer).setMaterial(glass));
	doc.createScene().addChild(doc.createNode('n').setMesh(mesh));
	return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
}

async function readTextures(bytes) {
	const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
	const out = {};
	for (const t of doc.getRoot().listTextures()) {
		const meta = await sharp(Buffer.from(t.getImage())).metadata();
		out[t.getName()] = { mime: t.getMimeType(), width: meta.width, height: meta.height };
	}
	return { doc, textures: out };
}

describe('optimizeGlb texture rules', () => {
	it('keeps normal maps and read alpha lossless, JPEGs opaque colour, and caps the edge', async () => {
		const src = await threeMaterialGlb();
		const result = await optimizeGlb(src, { targetFaces: 50_000, operation: 'simplify', textureSize: 1024, compression: 'none' });

		expect(result.noop).toBe(false);
		expect(result.universal.byteLength).toBeLessThan(src.byteLength);
		const { doc, textures } = await readTextures(result.universal);
		expect(textures['opaque-color']).toEqual({ mime: 'image/jpeg', width: 1024, height: 1024 });
		expect(textures.normal).toEqual({ mime: 'image/png', width: 1024, height: 1024 });
		expect(textures['blend-color']).toEqual({ mime: 'image/png', width: 1024, height: 1024 });
		// The universal file opens everywhere: it requires no extension at all.
		expect(doc.getRoot().listExtensionsRequired()).toEqual([]);
		// Both materials and their UVs survive.
		expect(doc.getRoot().listMaterials().map((m) => m.getName()).sort()).toEqual(['glass', 'opaque']);
		for (const prim of doc.getRoot().listMeshes()[0].listPrimitives()) expect(prim.getAttribute('TEXCOORD_0')).toBeTruthy();
	}, 60_000);
});

describe('clampTarget', () => {
	it('passes a sane target through without a note', () => {
		expect(clampTarget(20_000)).toEqual({ target: 20_000, note: null });
		expect(clampTarget(undefined)).toEqual({ target: 50_000, note: null });
	});

	it('lowers an absurd target to the maximum and says so', () => {
		const r = clampTarget(1e12);
		expect(r.target).toBe(OPTIMIZE_LIMITS.maxTargetFaces);
		expect(r.note).toMatch(/lowered to the maximum of 500,000/);
	});

	it('raises a tiny target to the minimum and says so', () => {
		const r = clampTarget(3);
		expect(r.target).toBe(OPTIMIZE_LIMITS.minTargetFaces);
		expect(r.note).toMatch(/raised to the minimum of 1,000/);
	});

	it('replaces a non-number with the default and says so', () => {
		const r = clampTarget('lots');
		expect(r.target).toBe(50_000);
		expect(r.note).toMatch(/not a positive number/);
	});
});

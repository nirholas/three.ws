// Tests for api/_lib/texture-result-checks.js: the gate every texture worker
// result (workers/texture full retexture and Magic Brush region edits) passes
// before a user is handed it. The fixtures are real GLBs written with
// glTF-Transform and real PNGs encoded by sharp, so the checks read exactly
// the bytes a worker would upload.

import { describe, it, expect } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import {
	checkTextureResult,
	expectedAtlasSize,
	isPowerOfTwo,
	pngGamma,
} from '../api/_lib/texture-result-checks.js';

async function png(size, rgb = [200, 40, 40], { gamma } = {}) {
	const [w, h] = Array.isArray(size) ? size : [size, size];
	let img = sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } });
	const bytes = await img.png().toBuffer();
	if (gamma == null) return new Uint8Array(bytes);
	return withGammaChunk(new Uint8Array(bytes), gamma);
}

// Insert a gAMA chunk right after IHDR. Gamma is stored as gamma * 100000.
function withGammaChunk(bytes, gamma) {
	const ihdrEnd = 8 + 8 + 13 + 4;
	const data = new Uint8Array(4);
	new DataView(data.buffer).setUint32(0, Math.round(gamma * 100000));
	const type = new TextEncoder().encode('gAMA');
	const crc = crc32(new Uint8Array([...type, ...data]));
	const chunk = new Uint8Array(4 + 4 + 4 + 4);
	const dv = new DataView(chunk.buffer);
	dv.setUint32(0, 4);
	chunk.set(type, 4);
	chunk.set(data, 8);
	dv.setUint32(12, crc);
	const out = new Uint8Array(bytes.length + chunk.length);
	out.set(bytes.subarray(0, ihdrEnd), 0);
	out.set(chunk, ihdrEnd);
	out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length);
	return out;
}

function crc32(buf) {
	let c = ~0;
	for (const b of buf) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
	}
	return ~c >>> 0;
}

// A quad with UVs, optionally a skeleton + clip, optionally a base colour map.
async function glb({ texture = null, uvShift = 0, extraTri = false, rigged = false, linearSlotReuse = false } = {}) {
	const doc = new Document();
	const buf = doc.createBuffer();
	const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
	const uvs = [0, 0, 1, 0, 1, 1, 0, 1].map((v) => v + uvShift);
	const indices = extraTri ? [0, 1, 2, 0, 2, 3, 0, 1, 3] : [0, 1, 2, 0, 2, 3];
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buf))
		.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buf))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buf));
	const mat = doc.createMaterial('skin');
	if (texture) {
		const tex = doc.createTexture('base').setImage(texture).setMimeType('image/png');
		mat.setBaseColorTexture(tex);
		if (linearSlotReuse) mat.setMetallicRoughnessTexture(tex);
	}
	prim.setMaterial(mat);
	const mesh = doc.createMesh('body').addPrimitive(prim);
	const node = doc.createNode('body').setMesh(mesh);
	const scene = doc.createScene().addChild(node);
	if (rigged) {
		const hip = doc.createNode('hips');
		scene.addChild(hip);
		prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(16)).setBuffer(buf));
		prim.setAttribute(
			'WEIGHTS_0',
			doc.createAccessor().setType('VEC4').setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).setBuffer(buf),
		);
		const skin = doc
			.createSkin('rig')
			.addJoint(hip)
			.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).setBuffer(buf));
		node.setSkin(skin);
		const sampler = doc
			.createAnimationSampler()
			.setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buf))
			.setOutput(doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 1, 0])).setBuffer(buf));
		const channel = doc.createAnimationChannel().setTargetNode(hip).setTargetPath('translation').setSampler(sampler);
		doc.createAnimation('idle').addSampler(sampler).addChannel(channel);
	}
	return new NodeIO().writeBinary(doc);
}

describe('expectedAtlasSize', () => {
	it('a full retexture is exactly the size requested', () => {
		expect(expectedAtlasSize({ mode: 'full', requested: 1024, sourceSize: 4096 })).toBe(1024);
	});

	it('a region edit keeps a larger power-of-two source atlas so no detail is thrown away', () => {
		expect(expectedAtlasSize({ mode: 'region', requested: 1024, sourceSize: 2048 })).toBe(2048);
	});

	it('a region edit rounds a non-power-of-two source up and caps at 2048', () => {
		expect(expectedAtlasSize({ mode: 'region', requested: 512, sourceSize: 1500 })).toBe(2048);
		expect(expectedAtlasSize({ mode: 'region', requested: 1024, sourceSize: 700 })).toBe(1024);
		expect(expectedAtlasSize({ mode: 'region', requested: 1024, sourceSize: 8192 })).toBe(2048);
	});

	it('a region edit on an untextured source uses the requested size', () => {
		expect(expectedAtlasSize({ mode: 'region', requested: 512, sourceSize: 0 })).toBe(512);
	});

	it('isPowerOfTwo', () => {
		expect([1, 2, 512, 2048].every(isPowerOfTwo)).toBe(true);
		expect([0, 3, 1000, 1500].some(isPowerOfTwo)).toBe(false);
	});
});

describe('checkTextureResult: a good result passes', () => {
	it('a region edit that only swapped the base colour pixels', async () => {
		const source = await glb({ texture: await png(1024, [120, 120, 120]) });
		const result = await glb({ texture: await png(1024, [200, 40, 40]) });
		const out = await checkTextureResult({ source, result, mode: 'region', textureSize: 1024 });
		expect(out.failures).toEqual([]);
		expect(out.ok).toBe(true);
		expect(out.atlas).toEqual({ width: 1024, height: 1024, expected: 1024 });
	});

	it('a region edit on a rigged, animated model that kept the rig and clip', async () => {
		const source = await glb({ texture: await png(512), rigged: true });
		const result = await glb({ texture: await png(512, [10, 200, 10]), rigged: true });
		const out = await checkTextureResult({ source, result, mode: 'region', textureSize: 512 });
		expect(out.ok).toBe(true);
	});

	it('a full retexture of an untextured mesh at the requested size', async () => {
		const source = await glb();
		const result = await glb({ texture: await png(2048), uvShift: 0.1 });
		const out = await checkTextureResult({ source, result, mode: 'full', textureSize: 2048 });
		expect(out.ok).toBe(true);
	});

	it('accepts an explicit sRGB gamma chunk', async () => {
		const source = await glb({ texture: await png(512) });
		const result = await glb({ texture: await png(512, [1, 2, 3], { gamma: 1 / 2.2 }) });
		const out = await checkTextureResult({ source, result, mode: 'region', textureSize: 512 });
		expect(out.ok).toBe(true);
	});
});

describe('checkTextureResult: a deliberately bad result is rejected', () => {
	const codes = (out) => out.failures.map((f) => f.code);

	it('UVs moved in a region edit', async () => {
		const source = await glb({ texture: await png(512) });
		const result = await glb({ texture: await png(512, [1, 1, 1]), uvShift: 0.25 });
		const out = await checkTextureResult({ source, result, mode: 'region', textureSize: 512 });
		expect(out.ok).toBe(false);
		expect(codes(out)).toContain('mesh_changed');
	});

	it('geometry changed', async () => {
		const source = await glb({ texture: await png(512) });
		const result = await glb({ texture: await png(512, [1, 1, 1]), extraTri: true });
		for (const mode of ['region', 'full']) {
			const out = await checkTextureResult({ source, result, mode, textureSize: 512 });
			expect(out.ok).toBe(false);
			expect(codes(out)).toContain('mesh_changed');
		}
	});

	it('the skeleton and clip were dropped (what a trimesh round trip does)', async () => {
		const source = await glb({ texture: await png(512), rigged: true });
		const result = await glb({ texture: await png(512, [1, 1, 1]) });
		const out = await checkTextureResult({ source, result, mode: 'region', textureSize: 512 });
		expect(out.ok).toBe(false);
		expect(codes(out)).toContain('rig_changed');
		expect(out.failures.find((f) => f.code === 'rig_changed').message).toMatch(/skeleton|animation/);
	});

	it('the atlas is not the requested size', async () => {
		const source = await glb();
		const result = await glb({ texture: await png(1024) });
		const out = await checkTextureResult({ source, result, mode: 'full', textureSize: 2048 });
		expect(codes(out)).toContain('texture_size');
	});

	it('the atlas is not a power of two', async () => {
		const source = await glb({ texture: await png(512) });
		const result = await glb({ texture: await png([1000, 1000]) });
		const out = await checkTextureResult({ source, result, mode: 'region', textureSize: 512 });
		expect(codes(out)).toContain('texture_not_pow2');
	});

	it('the base colour image is tagged linear', async () => {
		const source = await glb({ texture: await png(512) });
		const result = await glb({ texture: await png(512, [1, 2, 3], { gamma: 1.0 }) });
		const out = await checkTextureResult({ source, result, mode: 'region', textureSize: 512 });
		expect(codes(out)).toContain('color_space');
	});

	it('the base colour image is also wired into a linear data slot', async () => {
		const source = await glb({ texture: await png(512) });
		const result = await glb({ texture: await png(512, [1, 2, 3]), linearSlotReuse: true });
		const out = await checkTextureResult({ source, result, mode: 'region', textureSize: 512 });
		expect(codes(out)).toContain('color_space');
	});

	it('there is no base colour texture at all', async () => {
		const source = await glb();
		const result = await glb();
		const out = await checkTextureResult({ source, result, mode: 'full', textureSize: 1024 });
		expect(codes(out)).toContain('no_texture');
	});

	it('the result is not a GLB', async () => {
		const source = await glb({ texture: await png(512) });
		const out = await checkTextureResult({ source, result: new TextEncoder().encode('<html>502</html>'), mode: 'region', textureSize: 512 });
		expect(out.ok).toBe(false);
		expect(codes(out)).toEqual(['unreadable']);
	});
});

describe('pngGamma', () => {
	it('reads the gAMA chunk, or null when there is none', async () => {
		expect(pngGamma(await png(4))).toBeNull();
		expect(pngGamma(await png(4, [0, 0, 0], { gamma: 1 }))).toBeCloseTo(1, 4);
	});
});

// src/engine-qa-client.js: the browser-only partial grade Rig Doctor runs
// with zero network. There is no real browser in this suite, so the one
// browser-only primitive it needs (createImageBitmap) is polyfilled with a
// real PNG decode (sharp), exactly like tests/engine-qa.test.js polyfills the
// bytes for the server-side grader. Everything else, including the GLB
// parsing and the matrix/area math, is the real module, unmodified.
import { describe, it, expect, beforeAll } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { gradeEngineQaClient } from '../src/engine-qa-client.js';

function cubeMesh(size) {
	const h = size / 2;
	const positions = [
		-h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
		-h, -h, h, h, -h, h, h, h, h, -h, h, h,
	];
	const faces = [
		[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
		[0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
		[0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
	];
	return { positions, indices: faces.flat() };
}

function planeMesh(width, depth) {
	const hw = width / 2, hd = depth / 2;
	return {
		positions: [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd],
		indices: [0, 2, 1, 0, 3, 2],
		uv: [0, 0, 1, 0, 1, 1, 0, 1],
	};
}

let pngCache = new Map();
async function pngBuffer(width, height) {
	const key = `${width}x${height}`;
	if (!pngCache.has(key)) {
		const sharp = (await import('sharp')).default;
		pngCache.set(key, sharp({ create: { width, height, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } }).png().toBuffer());
	}
	return pngCache.get(key);
}

async function buildGlbArrayBuffer(parts) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene('scene');
	const materials = new Map();
	const textures = new Map();

	for (const [i, part] of parts.entries()) {
		const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.positions)).setBuffer(buffer);
		const index = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(part.indices)).setBuffer(buffer);
		const prim = doc.createPrimitive().setAttribute('POSITION', position).setIndices(index);

		if (part.uv) {
			const uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array(part.uv)).setBuffer(buffer);
			prim.setAttribute('TEXCOORD_0', uv);
		}

		const materialKey = part.materialKey ?? `material-${i}`;
		if (!materials.has(materialKey)) {
			const material = doc.createMaterial(materialKey);
			if (part.textureSize) {
				const textureKey = `${materialKey}:${part.textureSize.join('x')}`;
				if (!textures.has(textureKey)) {
					const [w, h] = part.textureSize;
					const image = await pngBuffer(w, h);
					textures.set(textureKey, doc.createTexture(textureKey).setMimeType('image/png').setImage(new Uint8Array(image)));
				}
				material.setBaseColorTexture(textures.get(textureKey));
			}
			materials.set(materialKey, material);
		}
		prim.setMaterial(materials.get(materialKey));

		const mesh = doc.createMesh(`mesh-${i}`).addPrimitive(prim);
		const node = doc.createNode(`node-${i}`).setMesh(mesh);
		scene.addChild(node);
	}

	const bytes = await new NodeIO().writeBinary(doc);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

beforeAll(() => {
	// eslint-disable-next-line no-undef
	globalThis.createImageBitmap = async (blob) => {
		const sharp = (await import('sharp')).default;
		const buf = Buffer.from(await blob.arrayBuffer());
		const meta = await sharp(buf).metadata();
		return { width: meta.width, height: meta.height, close() {} };
	};
});

describe('gradeEngineQaClient', () => {
	it('grades draw calls and material count from real GLB bytes with no texture', async () => {
		const buffer = await buildGlbArrayBuffer([{ ...cubeMesh(0.4) }]);
		const report = await gradeEngineQaClient(buffer);

		expect(report.partial).toBe(true);
		expect(report.drawCalls).toBe(1);
		expect(report.materialCount).toBe(1);
		expect(report.checks.drawCalls.verdict).toBe('pass');
		expect(report.checks.materialCount.verdict).toBe('pass');
	});

	it('counts one draw call per node+primitive and flags the warn band', async () => {
		const parts = Array.from({ length: 25 }, () => ({ ...cubeMesh(0.1) }));
		const buffer = await buildGlbArrayBuffer(parts);
		const report = await gradeEngineQaClient(buffer);

		expect(report.drawCalls).toBe(25);
		expect(report.checks.drawCalls.verdict).toBe('warn');
	});

	it('skips texel density when nothing is UV-mapped to a texture', async () => {
		const buffer = await buildGlbArrayBuffer([{ ...cubeMesh(0.4) }]);
		const report = await gradeEngineQaClient(buffer);
		expect(report.checks.texelDensity.verdict).toBe('skip');
		expect(report.checks.texelDensity.value).toBeNull();
	});

	it('measures texel density from real UV + decoded-image data, matching the closed form', async () => {
		const buffer = await buildGlbArrayBuffer([{ ...planeMesh(1, 1), textureSize: [512, 512] }]);
		const report = await gradeEngineQaClient(buffer);
		// sqrt(512*512 / (1*1)) = 512
		expect(report.checks.texelDensity.value).toBeCloseTo(512, 0);
		expect(report.checks.texelDensity.verdict).toBe('pass');
	});

	it('always skips triangleBudget and collider with an actionable reason, matching the explicit-upload design', async () => {
		const buffer = await buildGlbArrayBuffer([{ ...cubeMesh(0.4) }]);
		const report = await gradeEngineQaClient(buffer);
		expect(report.checks.triangleBudget.verdict).toBe('skip');
		expect(report.checks.collider.verdict).toBe('skip');
		expect(report.checks.triangleBudget.reason).toMatch(/LOD/);
		expect(report.checks.collider.reason).toMatch(/manifold/);
	});
});

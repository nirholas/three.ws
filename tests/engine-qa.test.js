import { describe, it, expect, beforeAll } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { gradeEngineQa, ENGINE_QA_VERSION, ENGINE_QA_THRESHOLDS } from '../api/_lib/engine-qa.js';

// A single flat, closed solid with analytically known dimensions, authored
// in-process so expectations derive from the shape's geometry rather than a
// previous run of this same code - same philosophy as sim-readiness.test.js.
function cubeMesh(size, { open = false } = {}) {
	const h = size / 2;
	const positions = [
		-h, -h, -h,  h, -h, -h,  h,  h, -h, -h,  h, -h,
		-h, -h,  h,  h, -h,  h,  h,  h,  h, -h,  h,  h,
	];
	const faces = [
		[0, 2, 1], [0, 3, 2],
		[4, 5, 6], [4, 6, 7],
		[0, 1, 5], [0, 5, 4],
		[3, 7, 6], [3, 6, 2],
		[0, 4, 7], [0, 7, 3],
		[1, 2, 6], [1, 6, 5],
	];
	if (open) faces.splice(0, 2);
	return { positions, indices: faces.flat() };
}

// A UV sphere: manifold and watertight like the cube above, but with enough
// triangles to clear the collider budget, which a hand-authored solid can't
// reach without being unreadable. Degenerate triangles collapse to zero area
// at the poles; analyzeMesh's own dropDegenerate step removes them exactly as
// it would for any real asset, so the count below is deliberately well clear
// of the budget rather than tuned to land exactly on it.
function uvSphereMesh(radius, segments, rings) {
	const positions = [];
	for (let r = 0; r <= rings; r++) {
		const theta = (r * Math.PI) / rings;
		const y = radius * Math.cos(theta);
		const ringRadius = radius * Math.sin(theta);
		for (let s = 0; s <= segments; s++) {
			const phi = (s * 2 * Math.PI) / segments;
			positions.push(ringRadius * Math.cos(phi), y, ringRadius * Math.sin(phi));
		}
	}
	const indices = [];
	for (let r = 0; r < rings; r++) {
		for (let s = 0; s < segments; s++) {
			const a = r * (segments + 1) + s;
			const b = a + segments + 1;
			indices.push(a, b, a + 1, a + 1, b, b + 1);
		}
	}
	return { positions, indices };
}

// A single rectangular quad in the XZ plane, UV-mapped edge to edge, so texel
// density has a closed form: sqrt(texWidth*texHeight / (width*depth)).
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

/**
 * @param {Array<{ positions: number[], indices: number[], uv?: number[], textureSize?: [number, number], materialKey?: string }>} parts
 *   one node + one primitive per part, so part count == expected draw calls.
 */
async function buildGlb(parts) {
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

	return Buffer.from(await new NodeIO().writeBinary(doc));
}

describe('gradeEngineQa', () => {
	it('grades a simple textured, closed cube as engine-ready', async () => {
		const glb = await buildGlb([{ ...cubeMesh(0.4) }]);
		const report = await gradeEngineQa(glb);

		expect(report.version).toBe(ENGINE_QA_VERSION);
		expect(report.drawCalls).toBe(1);
		expect(report.materialCount).toBe(1);
		expect(report.checks.drawCalls.verdict).toBe('pass');
		expect(report.checks.materialCount.verdict).toBe('pass');
		expect(report.checks.collider.verdict).toBe('pass');
		expect(report.checks.collider.value.watertight).toBe(true);
		expect(report.overall).toBe('pass');
	});

	it('counts one draw call per node+primitive and reports a worse verdict past the warn band', async () => {
		const parts = Array.from({ length: 25 }, () => ({ ...cubeMesh(0.1) }));
		const glb = await buildGlb(parts);
		const report = await gradeEngineQa(glb);

		expect(report.drawCalls).toBe(25);
		expect(report.checks.drawCalls.verdict).toBe('warn');
	});

	it('counts distinct materials, not primitives, for materialCount', async () => {
		const shared = [
			{ ...cubeMesh(0.1), materialKey: 'shared' },
			{ ...cubeMesh(0.1), materialKey: 'shared' },
		];
		const glb = await buildGlb(shared);
		const report = await gradeEngineQa(glb);

		expect(report.drawCalls).toBe(2);
		expect(report.materialCount).toBe(1);
		expect(report.checks.materialCount.verdict).toBe('pass');
	});

	it('flags a non-manifold-material count past the fail band', async () => {
		const parts = Array.from({ length: 25 }, (_, i) => ({ ...cubeMesh(0.1), materialKey: `m${i}` }));
		const glb = await buildGlb(parts);
		const report = await gradeEngineQa(glb);

		expect(report.materialCount).toBe(25);
		expect(report.checks.materialCount.verdict).toBe('fail');
		expect(report.overall).toBe('fail');
	});

	it('skips texel density when nothing is UV-mapped to a texture', async () => {
		const glb = await buildGlb([{ ...cubeMesh(0.4) }]);
		const report = await gradeEngineQa(glb);

		expect(report.checks.texelDensity.verdict).toBe('skip');
		expect(report.checks.texelDensity.value).toBeNull();
	});

	it('measures texel density from real UV + texture-pixel data, matching the closed form', async () => {
		const glb = await buildGlb([{ ...planeMesh(1, 1), textureSize: [512, 512] }]);
		const report = await gradeEngineQa(glb);

		// sqrt(512*512 / (1*1)) = 512
		expect(report.checks.texelDensity.value).toBeCloseTo(512, 0);
		expect(report.checks.texelDensity.verdict).toBe('pass');
	});

	it('fails texel density below the floor (stretched texture) and warns above the ceiling (oversampled)', async () => {
		const stretched = await buildGlb([{ ...planeMesh(10, 10), textureSize: [32, 32] }]);
		const stretchedReport = await gradeEngineQa(stretched);
		expect(stretchedReport.checks.texelDensity.value).toBe(3); // round(sqrt(1024/100))
		expect(stretchedReport.checks.texelDensity.verdict).toBe('fail');

		const oversampled = await buildGlb([{ ...planeMesh(0.01, 0.01), textureSize: [512, 512] }]);
		const oversampledReport = await gradeEngineQa(oversampled);
		expect(oversampledReport.checks.texelDensity.value).toBeCloseTo(51200, -2);
		expect(oversampledReport.checks.texelDensity.verdict).toBe('warn');
	});

	it('skips the triangle budget check when no LOD chain is supplied', async () => {
		const glb = await buildGlb([{ ...cubeMesh(0.4) }]);
		const report = await gradeEngineQa(glb);

		expect(report.checks.triangleBudget.verdict).toBe('skip');
	});

	it('passes a LOD chain within budget and flags one that exceeds it', async () => {
		const glb = await buildGlb([{ ...cubeMesh(0.4) }]);
		const withinBudget = await gradeEngineQa(glb, {
			lods: [
				{ name: 'LOD0', triangleCount: 50_000 },
				{ name: 'LOD1', triangleCount: 20_000 },
				{ name: 'LOD2', triangleCount: 5_000 },
			],
		});
		expect(withinBudget.checks.triangleBudget.verdict).toBe('pass');
		expect(withinBudget.checks.triangleBudget.monotonicDecrease).toBe(true);

		const overBudget = await gradeEngineQa(glb, {
			lods: [
				{ name: 'LOD0', triangleCount: 50_000 },
				{ name: 'LOD1', triangleCount: 45_000 }, // over the LOD1 ceiling of 40,000
			],
		});
		expect(overBudget.checks.triangleBudget.verdict).toBe('fail');
		expect(overBudget.checks.triangleBudget.value[1].verdict).toBe('fail');
	});

	it('flags a LOD chain that is not monotonically decreasing', async () => {
		const glb = await buildGlb([{ ...cubeMesh(0.4) }]);
		const report = await gradeEngineQa(glb, {
			lods: [
				{ name: 'LOD0', triangleCount: 1000 },
				{ name: 'LOD1', triangleCount: 2000 },
			],
		});

		expect(report.checks.triangleBudget.monotonicDecrease).toBe(false);
		expect(report.checks.triangleBudget.verdict).toBe('fail');
	});

	it('reports a non-watertight mesh as collider-unsuitable with an actionable reason', async () => {
		const glb = await buildGlb([{ ...cubeMesh(0.4, { open: true }) }]);
		const report = await gradeEngineQa(glb);

		expect(report.checks.collider.verdict).toBe('fail');
		expect(report.checks.collider.value.watertight).toBe(false);
		expect(report.checks.collider.reason).toMatch(/not watertight/);
	});

	it('warns on a watertight mesh that is too heavy for a cheap mesh collider', async () => {
		const glb = await buildGlb([{ ...uvSphereMesh(0.5, 90, 70) }]);
		const report = await gradeEngineQa(glb);

		expect(report.checks.collider.value.watertight).toBe(true);
		expect(report.checks.collider.value.triangleCount).toBeGreaterThan(ENGINE_QA_THRESHOLDS.colliderTriangleBudget);
		expect(report.checks.collider.verdict).toBe('warn');
		expect(report.checks.collider.reason).toMatch(/convex-hull|primitive proxy/);
	});
});

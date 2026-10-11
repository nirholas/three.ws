// Engine QA grading for a generated GLB: the questions a game engine or a
// real-time renderer asks that neither glb-inspect.js ("is this valid glTF")
// nor sim-readiness.js ("can a physics solver integrate this") answers:
// "will this run, and can it collide?"
//
//   draw calls        one estimate per (node, primitive) pair actually in the
//                      default scene graph: the real GPU cost, not just the
//                      primitive count a mesh happens to own (a mesh referenced
//                      by two nodes draws twice).
//   material count    distinct materials, the other half of the draw-call
//                      story (same primitive, more materials, more batches a
//                      renderer can't merge).
//   texel density      texels per meter: sqrt(UV-triangle-area-in-texels /
//                      world-triangle-area-in-m²), summed across every
//                      textured triangle after applying the node's world
//                      transform. `null` with a reason when nothing is UV
//                      mapped to a texture, never a fabricated number.
//   triangle budget    each LOD level's triangle count against a configured
//                      per-level ceiling, plus the monotonic-decrease check
//                      every LOD chain must satisfy (highest to lowest detail).
//   collider           reuses the print pipeline's manifold/watertight check
//                      (api/_lib/print/{mesh-io,analyze}.js): a closed,
//                      budget-sized mesh is a cheap physics collider; anything
//                      else needs a convex-hull or primitive proxy instead.
//
// Every check is `pass` | `warn` | `fail`, or `skip` when the asset carries
// nothing the check can measure (no textures, no LOD chain supplied). The
// overall verdict is the worst non-skip verdict.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { loadMesh } from './print/mesh-io.js';
import { analyzeMesh } from './print/analyze.js';
import {
	ENGINE_QA_VERSION,
	ENGINE_QA_THRESHOLDS,
	worstVerdict,
	verdictFromBand,
	gradeTriangleBudget,
} from './engine-qa-core.js';

export { ENGINE_QA_VERSION, ENGINE_QA_THRESHOLDS };

const MODE_TRIANGLES = 4;

let ioPromise = null;

// Mirrors sim-readiness.js's getIO(): Draco/meshopt registration is
// best-effort so an asset that doesn't use either compression is never
// penalized for the dependency being unavailable.
async function getIO() {
	if (!ioPromise) {
		ioPromise = (async () => {
			const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
			const dependencies = {};
			try {
				const draco = await import('draco3dgltf');
				const create = draco.default ?? draco;
				dependencies['draco3d.decoder'] = await create.createDecoderModule();
			} catch {
				/* asset is only ungradeable if it actually uses Draco */
			}
			try {
				const { MeshoptDecoder } = await import('meshoptimizer');
				await MeshoptDecoder.ready;
				dependencies['meshopt.decoder'] = MeshoptDecoder;
			} catch {
				/* same: absence only matters for meshopt-compressed input */
			}
			if (Object.keys(dependencies).length) io.registerDependencies(dependencies);
			return io;
		})();
	}
	return ioPromise;
}

// gltf-transform world matrices are column-major, glTF's own convention.
function transformPoint(m, x, y, z) {
	const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
	return [
		(m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
		(m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
		(m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
	];
}

function triangleArea(a, b, c) {
	const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
	const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
	const cx = aby * acz - abz * acy;
	const cy = abz * acx - abx * acz;
	const cz = abx * acy - aby * acx;
	return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function triangleAreaUv(a, b, c) {
	// 2D cross product / 2, absolute value (winding doesn't matter for area).
	return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

/**
 * Walk the default scene once, counting real draw calls (one per node +
 * triangle-primitive pair actually reachable from the scene root, so an
 * instanced mesh counts once per instance) and accumulating textured-triangle
 * world/UV area for the texel-density estimate.
 */
function collectSceneStats(doc) {
	let drawCalls = 0;
	let totalWorldAreaM2 = 0;
	let totalUvAreaTexels = 0;

	const root = doc.getRoot();
	const scene = root.getDefaultScene() ?? root.listScenes()[0] ?? null;
	const roots = scene ? scene.listChildren() : root.listNodes();
	const seen = new Set();

	const visit = (node) => {
		if (seen.has(node)) return;
		seen.add(node);
		const mesh = node.getMesh();
		if (mesh) {
			const matrix = node.getWorldMatrix();
			for (const prim of mesh.listPrimitives()) {
				if (prim.getMode() !== MODE_TRIANGLES) continue;
				drawCalls += 1;

				const position = prim.getAttribute('POSITION');
				const uv = prim.getAttribute('TEXCOORD_0');
				const material = prim.getMaterial();
				const texture = material?.getBaseColorTexture() ?? firstTexture(material);
				if (!position || !uv || !texture) continue;
				const size = texture.getSize();
				if (!size) continue;
				const [texWidth, texHeight] = size;

				const index = prim.getIndices();
				const count = index ? index.getCount() : position.getCount();
				const p = [0, 0, 0];
				const uvA = [0, 0], uvB = [0, 0], uvC = [0, 0];
				for (let i = 0; i + 2 < count; i += 3) {
					const ia = index ? index.getScalar(i) : i;
					const ib = index ? index.getScalar(i + 1) : i + 1;
					const ic = index ? index.getScalar(i + 2) : i + 2;

					position.getElement(ia, p);
					const a = transformPoint(matrix, p[0], p[1], p[2]);
					position.getElement(ib, p);
					const b = transformPoint(matrix, p[0], p[1], p[2]);
					position.getElement(ic, p);
					const c = transformPoint(matrix, p[0], p[1], p[2]);
					totalWorldAreaM2 += triangleArea(a, b, c);

					uv.getElement(ia, uvA);
					uv.getElement(ib, uvB);
					uv.getElement(ic, uvC);
					totalUvAreaTexels += triangleAreaUv(uvA, uvB, uvC) * texWidth * texHeight;
				}
			}
		}
		for (const child of node.listChildren()) visit(child);
	};
	for (const node of roots) visit(node);

	return { drawCalls, totalWorldAreaM2, totalUvAreaTexels };
}

function firstTexture(material) {
	if (!material) return null;
	return (
		material.getNormalTexture() ??
		material.getMetallicRoughnessTexture() ??
		material.getEmissiveTexture() ??
		material.getOcclusionTexture() ??
		null
	);
}

/**
 * Reuse the print pipeline's manifold/watertight check: a closed mesh under
 * the collider triangle budget is cheap to collide against as-is; anything
 * else needs a convex-hull or primitive proxy instead of its render mesh.
 */
async function gradeColliderSuitability(bytes) {
	try {
		const mesh = await loadMesh(bytes, { color: false });
		const analysis = await analyzeMesh(mesh);
		const budget = ENGINE_QA_THRESHOLDS.colliderTriangleBudget;
		const overBudget = analysis.triangles > budget;
		let verdict = 'pass';
		if (!analysis.watertight) verdict = 'fail';
		else if (overBudget) verdict = 'warn';
		return {
			value: {
				watertight: analysis.watertight,
				manifold: analysis.manifold,
				shells: analysis.shells,
				openEdges: analysis.open_edges,
				triangleCount: analysis.triangles,
				budget,
			},
			verdict,
			reason: !analysis.watertight
				? 'mesh is not watertight; repair it or use a convex-hull/primitive collider'
				: overBudget
					? 'watertight but too heavy for a mesh collider; use a convex-hull or primitive proxy'
					: null,
		};
	} catch (err) {
		return { value: null, verdict: 'skip', reason: err?.message || 'collider analysis failed' };
	}
}

/**
 * Grade a GLB for real-time-engine fitness.
 *
 * @param {Uint8Array|ArrayBuffer} glb
 * @param {{ lods?: Array<{ name: string, triangleCount: number }> }} [options]
 */
export async function gradeEngineQa(glb, options = {}) {
	const input = glb instanceof Uint8Array ? glb : new Uint8Array(glb);
	const io = await getIO();
	const doc = await io.readBinary(input);
	const root = doc.getRoot();

	const materialCount = root.listMaterials().length;
	const textureCount = root.listTextures().length;
	const { drawCalls, totalWorldAreaM2, totalUvAreaTexels } = collectSceneStats(doc);

	const drawCallsCheck = { value: drawCalls, verdict: verdictFromBand(drawCalls, ENGINE_QA_THRESHOLDS.drawCalls), thresholds: ENGINE_QA_THRESHOLDS.drawCalls };
	const materialCountCheck = { value: materialCount, verdict: verdictFromBand(materialCount, ENGINE_QA_THRESHOLDS.materialCount), thresholds: ENGINE_QA_THRESHOLDS.materialCount };

	let texelDensityCheck;
	if (totalWorldAreaM2 > 0 && totalUvAreaTexels > 0) {
		const texelsPerM2 = totalUvAreaTexels / totalWorldAreaM2;
		const pxPerMeter = Math.round(Math.sqrt(texelsPerM2));
		const { minPxPerMeter, maxPxPerMeter } = ENGINE_QA_THRESHOLDS.texelDensity;
		const verdict = pxPerMeter < minPxPerMeter ? 'fail' : pxPerMeter > maxPxPerMeter ? 'warn' : 'pass';
		texelDensityCheck = { value: pxPerMeter, verdict, thresholds: ENGINE_QA_THRESHOLDS.texelDensity };
	} else {
		texelDensityCheck = { value: null, verdict: 'skip', reason: 'no UV-mapped texture found to measure' };
	}

	const triangleBudgetCheck = gradeTriangleBudget(options.lods ?? null);
	const colliderCheck = await gradeColliderSuitability(input);

	const checks = {
		drawCalls: drawCallsCheck,
		materialCount: materialCountCheck,
		texelDensity: texelDensityCheck,
		triangleBudget: triangleBudgetCheck,
		collider: colliderCheck,
	};

	return {
		version: ENGINE_QA_VERSION,
		overall: worstVerdict(Object.values(checks).map((c) => c.verdict)),
		materialCount,
		textureCount,
		drawCalls,
		checks,
	};
}

// Engine QA, computed entirely in the browser: zero network, zero upload.
//
// Rig Doctor's whole privacy claim ("No bytes are sent to any server... works
// with the network disconnected") rules out posting a visitor's file to
// /api/3d/engine-qa for the full server-side grade (api/_lib/engine-qa.js),
// which needs Node-only dependencies (gltf-transform's NodeIO, the manifold
// print pipeline) anyway. This module grades the three checks that are pure
// math over bytes already in memory: draw calls, material count, and texel
// density. It shares its thresholds and verdict logic with the server grader
// via api/_lib/engine-qa-core.js, so the two can never disagree on a verdict.
//
// What it deliberately does NOT grade (returned as `skip`, never fabricated):
//   triangleBudget   needs a real LOD chain, which needs real decimation work
//                    (meshoptimizer), heavy enough that even the server gates
//                    it behind its own rate limit. Rig Doctor's own offer to
//                    build one is an explicit, visible upload: see
//                    rig-doctor-page.js's `requestFullEngineQa`.
//   collider         needs the manifold/watertight analyzer, which is a
//                    server-only dependency chain (api/_lib/print/*). Same
//                    explicit-upload offer covers this.
//
// Parses the raw GLB with rig-report.js's own byte-level reader rather than a
// second JSON/BIN parser, so the two analyses of the same file can never
// disagree about where the chunks are.

import { readGlbJson } from './rig-report.js';
import {
	ENGINE_QA_VERSION,
	ENGINE_QA_THRESHOLDS,
	worstVerdict,
	verdictFromBand,
} from '../api/_lib/engine-qa-core.js';

const MODE_TRIANGLES = 4;
const COMPONENT_FLOAT = 5126;
const INDEX_READERS = {
	5121: (dv, o) => dv.getUint8(o),
	5123: (dv, o) => dv.getUint16(o, true),
	5125: (dv, o) => dv.getUint32(o, true),
};

function sliceBin(buffer, jsonBytes) {
	const c1Offset = 20 + jsonBytes;
	if (c1Offset + 8 > buffer.byteLength) return null;
	const view = new DataView(buffer);
	const c1Len = view.getUint32(c1Offset, true);
	return new Uint8Array(buffer, c1Offset + 8, c1Len);
}

// Only FLOAT VEC2/VEC3 accessors (positions and UVs are FLOAT in every mesh
// this needs to measure); anything else, including quantized attributes,
// returns null so the caller skips that primitive's area contribution rather
// than misreading it.
function readFloatAccessor(json, bin, accessorIndex, numComponents) {
	const accessor = json.accessors?.[accessorIndex];
	if (!accessor || accessor.sparse || accessor.componentType !== COMPONENT_FLOAT) return null;
	if (typeof accessor.bufferView !== 'number' || !bin) return null;
	const view = json.bufferViews?.[accessor.bufferView];
	if (!view) return null;
	const stride = view.byteStride || numComponents * 4;
	const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
	if (base + stride * Math.max(0, accessor.count - 1) + numComponents * 4 > bin.byteLength) return null;
	const dv = new DataView(bin.buffer, bin.byteOffset + base);
	return {
		count: accessor.count,
		get(i, out) {
			const o = i * stride;
			for (let c = 0; c < numComponents; c++) out[c] = dv.getFloat32(o + c * 4, true);
			return out;
		},
	};
}

function readIndexAccessor(json, bin, accessorIndex) {
	const accessor = json.accessors?.[accessorIndex];
	if (!accessor || accessor.sparse) return null;
	const reader = INDEX_READERS[accessor.componentType];
	if (!reader || typeof accessor.bufferView !== 'number' || !bin) return null;
	const view = json.bufferViews?.[accessor.bufferView];
	if (!view) return null;
	const compBytes = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
	const stride = view.byteStride || compBytes;
	const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
	if (base + stride * Math.max(0, accessor.count - 1) + compBytes > bin.byteLength) return null;
	const dv = new DataView(bin.buffer, bin.byteOffset + base);
	return { count: accessor.count, get: (i) => reader(dv, i * stride) };
}

function mat4Identity() {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mat4Multiply(a, b) {
	const out = new Array(16);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			out[col * 4 + row] =
				a[0 * 4 + row] * b[col * 4 + 0] +
				a[1 * 4 + row] * b[col * 4 + 1] +
				a[2 * 4 + row] * b[col * 4 + 2] +
				a[3 * 4 + row] * b[col * 4 + 3];
		}
	}
	return out;
}

// Column-major, matching glTF's own convention and api/_lib/engine-qa.js's
// transformPoint helper, so a mesh graded on both sides never gets two
// different world-space triangle areas for the same transform.
function localMatrix(node) {
	if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
	const [tx, ty, tz] = node.translation || [0, 0, 0];
	const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale || [1, 1, 1];
	const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
	const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
	const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
	return [
		r00 * sx, r10 * sx, r20 * sx, 0,
		r01 * sy, r11 * sy, r21 * sy, 0,
		r02 * sz, r12 * sz, r22 * sz, 0,
		tx, ty, tz, 1,
	];
}

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
	const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
	return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function triangleAreaUv(a, b, c) {
	return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

function firstTextureRef(material) {
	if (!material) return null;
	return (
		material.pbrMetallicRoughness?.baseColorTexture ??
		material.normalTexture ??
		material.pbrMetallicRoughness?.metallicRoughnessTexture ??
		material.emissiveTexture ??
		material.occlusionTexture ??
		null
	);
}

// Decode an embedded (bufferView-backed) image to get its pixel size, via the
// browser's own image decoder: no manual PNG/JPEG header parsing, and it
// never leaves the tab because the bytes are already local. A `uri`-backed
// image (external reference) is skipped rather than fetched: fetching it
// would be this module's only network request, and the one guarantee Rig
// Doctor makes is that there isn't one.
async function textureSize(json, bin, textureRef) {
	const texture = json.textures?.[textureRef?.index];
	const image = json.images?.[texture?.source];
	if (!image || typeof image.bufferView !== 'number' || !bin) return null;
	const view = json.bufferViews?.[image.bufferView];
	if (!view) return null;
	const start = (view.byteOffset || 0);
	const bytes = bin.subarray(start, start + view.byteLength);
	const blob = new Blob([bytes], { type: image.mimeType || 'image/png' });
	try {
		const bitmap = await createImageBitmap(blob);
		const size = [bitmap.width, bitmap.height];
		bitmap.close?.();
		return size;
	} catch {
		return null;
	}
}

/**
 * Grade the checks that are pure math over bytes already in memory: draw
 * calls, material count, and texel density. `triangleBudget` and `collider`
 * come back `skip` with a reason pointing at the explicit upload path.
 *
 * @param {ArrayBuffer} buffer a GLB already read into memory (FileReader result)
 */
export async function gradeEngineQaClient(buffer) {
	const { json, jsonBytes } = readGlbJson(buffer);
	const bin = sliceBin(buffer, jsonBytes);

	const materialCount = (json.materials || []).length;
	const textureCount = (json.textures || []).length;

	const sceneIndex = json.scene ?? 0;
	const rootIndices = json.scenes?.[sceneIndex]?.nodes ?? [];
	const seen = new Set();
	let drawCalls = 0;
	let totalWorldAreaM2 = 0;
	let totalUvAreaTexels = 0;
	let anyMeasured = false;

	const visit = async (nodeIndex, parentMatrix) => {
		if (seen.has(nodeIndex)) return;
		seen.add(nodeIndex);
		const node = json.nodes?.[nodeIndex];
		if (!node) return;
		const matrix = mat4Multiply(parentMatrix, localMatrix(node));

		if (typeof node.mesh === 'number') {
			for (const prim of json.meshes?.[node.mesh]?.primitives || []) {
				if ((prim.mode ?? MODE_TRIANGLES) !== MODE_TRIANGLES) continue;
				drawCalls += 1;

				const posAcc = prim.attributes?.POSITION;
				const uvAcc = prim.attributes?.TEXCOORD_0;
				const material = json.materials?.[prim.material];
				const textureRef = firstTextureRef(material);
				if (posAcc == null || uvAcc == null || !textureRef) continue;

				const position = readFloatAccessor(json, bin, posAcc, 3);
				const uv = readFloatAccessor(json, bin, uvAcc, 2);
				if (!position || !uv) continue;
				const size = await textureSize(json, bin, textureRef);
				if (!size) continue;
				const [texWidth, texHeight] = size;

				const index = prim.indices != null ? readIndexAccessor(json, bin, prim.indices) : null;
				const count = index ? index.count : position.count;
				const p = [0, 0, 0], uvA = [0, 0], uvB = [0, 0], uvC = [0, 0];
				for (let i = 0; i + 2 < count; i += 3) {
					const ia = index ? index.get(i) : i;
					const ib = index ? index.get(i + 1) : i + 1;
					const ic = index ? index.get(i + 2) : i + 2;

					const a = transformPoint(matrix, ...position.get(ia, p));
					const b = transformPoint(matrix, ...position.get(ib, p));
					const c = transformPoint(matrix, ...position.get(ic, p));
					totalWorldAreaM2 += triangleArea(a, b, c);

					uv.get(ia, uvA);
					uv.get(ib, uvB);
					uv.get(ic, uvC);
					totalUvAreaTexels += triangleAreaUv(uvA, uvB, uvC) * texWidth * texHeight;
					anyMeasured = true;
				}
			}
		}
		for (const childIndex of node.children || []) await visit(childIndex, matrix);
	};
	for (const rootIndex of rootIndices) await visit(rootIndex, mat4Identity());

	const drawCallsCheck = { value: drawCalls, verdict: verdictFromBand(drawCalls, ENGINE_QA_THRESHOLDS.drawCalls), thresholds: ENGINE_QA_THRESHOLDS.drawCalls };
	const materialCountCheck = { value: materialCount, verdict: verdictFromBand(materialCount, ENGINE_QA_THRESHOLDS.materialCount), thresholds: ENGINE_QA_THRESHOLDS.materialCount };

	let texelDensityCheck;
	if (anyMeasured && totalWorldAreaM2 > 0) {
		const pxPerMeter = Math.round(Math.sqrt(totalUvAreaTexels / totalWorldAreaM2));
		const { minPxPerMeter, maxPxPerMeter } = ENGINE_QA_THRESHOLDS.texelDensity;
		const verdict = pxPerMeter < minPxPerMeter ? 'fail' : pxPerMeter > maxPxPerMeter ? 'warn' : 'pass';
		texelDensityCheck = { value: pxPerMeter, verdict, thresholds: ENGINE_QA_THRESHOLDS.texelDensity };
	} else {
		texelDensityCheck = { value: null, verdict: 'skip', reason: 'no UV-mapped texture found to measure' };
	}

	const checks = {
		drawCalls: drawCallsCheck,
		materialCount: materialCountCheck,
		texelDensity: texelDensityCheck,
		triangleBudget: { value: null, verdict: 'skip', reason: 'requires building a real LOD chain; use "Check LOD & collider fitness" to run it' },
		collider: { value: null, verdict: 'skip', reason: 'requires the server-side manifold analyzer; use "Check LOD & collider fitness" to run it' },
	};

	return {
		version: ENGINE_QA_VERSION,
		overall: worstVerdict(Object.values(checks).map((c) => c.verdict)),
		materialCount,
		textureCount,
		drawCalls,
		partial: true,
		checks,
	};
}

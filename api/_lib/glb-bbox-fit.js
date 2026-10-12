// Fit a delivered GLB inside a caller-requested [x, y, z] bounding box.
//
// Some integrations (a game engine's prop slot, an AR anchor, a print bed) need
// the delivered mesh to occupy a known footprint rather than whatever scale the
// generator happened to produce. forge-options.js's `bbox` field carries that
// request in meters; this module performs the fit: the mesh is uniformly scaled
// (never stretched: a non-uniform scale would distort the subject) so its
// longest-relative-to-box axis exactly fills that axis of the box, then
// recentered so it sits in the middle of X/Z and rests on the floor at Y=0,
// matching the convention every other forge delivery already uses (see
// glb-floor-slab.js).
//
// Pure, CPU-only and best-effort, same contract as glb-floor-slab.js: anything
// this pass cannot read or decide returns the original bytes unchanged.

import { Buffer } from 'node:buffer';

function worldBounds(prim, matrix) {
	const pos = prim.getAttribute('POSITION');
	const n = pos.getCount();
	const v = [0, 0, 0];
	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	for (let i = 0; i < n; i++) {
		pos.getElement(i, v);
		const x = matrix[0] * v[0] + matrix[4] * v[1] + matrix[8] * v[2] + matrix[12];
		const y = matrix[1] * v[0] + matrix[5] * v[1] + matrix[9] * v[2] + matrix[13];
		const z = matrix[2] * v[0] + matrix[6] * v[1] + matrix[10] * v[2] + matrix[14];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;
	}
	return { minX, minY, minZ, maxX, maxY, maxZ };
}

function mergeBounds(a, b) {
	return {
		minX: Math.min(a.minX, b.minX),
		minY: Math.min(a.minY, b.minY),
		minZ: Math.min(a.minZ, b.minZ),
		maxX: Math.max(a.maxX, b.maxX),
		maxY: Math.max(a.maxY, b.maxY),
		maxZ: Math.max(a.maxZ, b.maxZ),
	};
}

/**
 * Compute the uniform scale and recentering translation that fits `bounds`
 * inside `[bx, by, bz]` meters, preserving aspect ratio, centered on X/Z and
 * floored at Y=0. Pure: takes world-space bounds, returns a transform.
 *
 * @param {{minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number}} bounds
 * @param {[number, number, number]} bbox
 * @returns {{ fit: boolean, reason: string, scale?: number, translate?: [number, number, number] }}
 */
export function computeBboxFit(bounds, bbox) {
	const sizeX = bounds.maxX - bounds.minX;
	const sizeY = bounds.maxY - bounds.minY;
	const sizeZ = bounds.maxZ - bounds.minZ;
	if (!(sizeX > 0 || sizeY > 0 || sizeZ > 0)) return { fit: false, reason: 'no_extent' };
	const [bx, by, bz] = bbox;
	if (!(bx > 0 && by > 0 && bz > 0)) return { fit: false, reason: 'invalid_bbox' };
	// Only the axes with real extent constrain the scale: a flat plane (sizeY
	// near 0) would otherwise force an infinite scale trying to fill a height
	// it has none of.
	const ratios = [];
	if (sizeX > 0) ratios.push(bx / sizeX);
	if (sizeY > 0) ratios.push(by / sizeY);
	if (sizeZ > 0) ratios.push(bz / sizeZ);
	const scale = Math.min(...ratios);
	if (!(scale > 0 && Number.isFinite(scale))) return { fit: false, reason: 'degenerate_scale' };
	const centerX = (bounds.minX + bounds.maxX) / 2;
	const centerZ = (bounds.minZ + bounds.maxZ) / 2;
	return {
		fit: true,
		reason: 'fitted',
		scale,
		// Translate in the mesh's own (pre-scale) units: the root node applies
		// scale then translate as separate TRS channels, so this offset must
		// already be divided by `scale` to land the scaled mesh centered and
		// floored once both transforms are composed.
		translate: [-centerX, -bounds.minY, -centerZ],
	};
}

/**
 * Fit a GLB's content inside a caller-requested [x, y, z] box in meters, via a
 * single wrapping root node (scale + translate), so the source geometry itself
 * is never resampled. Returns the original bytes unchanged when there is
 * nothing to fit or the request is degenerate.
 *
 * @param {Buffer|Uint8Array} buf - source GLB bytes
 * @param {[number, number, number]} bbox - requested [x, y, z] in meters
 * @returns {Promise<{ buffer: Buffer, fitted: boolean, reason: string, scale?: number }>}
 */
export async function fitBbox(buf, bbox) {
	const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
	const unchanged = (reason) => ({ buffer: input, fitted: false, reason });
	if (!Array.isArray(bbox) || bbox.length !== 3) return unchanged('no_bbox_requested');

	const { NodeIO } = await import('@gltf-transform/core');
	const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
	const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
	const doc = await io.readBinary(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));

	const scene = doc.getRoot().listScenes()[0];
	const topNodes = scene ? scene.listChildren() : doc.getRoot().listNodes().filter((n) => !n.getParentNode?.());
	if (!topNodes.length) return unchanged('no_nodes');

	let bounds = null;
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh();
		if (!mesh) continue;
		const matrix = node.getWorldMatrix();
		for (const prim of mesh.listPrimitives()) {
			if (!prim.getAttribute('POSITION')) continue;
			const b = worldBounds(prim, matrix);
			bounds = bounds ? mergeBounds(bounds, b) : b;
		}
	}
	if (!bounds) return unchanged('no_triangles');

	const verdict = computeBboxFit(bounds, bbox);
	if (!verdict.fit) return unchanged(verdict.reason);

	// Wrap every top-level node under one new root that carries the scale and
	// translation, rather than editing vertex data: cheap, lossless, and never
	// fights an existing node hierarchy or skin.
	const wrapper = doc.createNode('BboxFit').setScale([verdict.scale, verdict.scale, verdict.scale]);
	wrapper.setTranslation(verdict.translate.map((v) => v * verdict.scale));
	for (const node of topNodes) {
		scene.removeChild(node);
		wrapper.addChild(node);
	}
	if (scene) scene.addChild(wrapper);

	const out = Buffer.from(await io.writeBinary(doc));
	return { buffer: out, fitted: true, reason: 'fitted', scale: verdict.scale };
}

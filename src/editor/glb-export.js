/**
 * GLB export pipeline using glTF-Transform.
 *
 * Reads the original GLB/GLTF bytes, applies accumulated edits from the
 * EditorSession, and re-serializes as a valid GLB. We match Three.js edits
 * back to glTF-Transform entities by NAME (UUIDs don't cross the boundary).
 *
 * Materials: names are typically unique within a glTF. If two materials
 * share a name we still apply edits to the first match — correct 99% of
 * the time and not worse than what the GUI would suggest.
 */
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

/** Convert an Euler (XYZ order, radians) to a quaternion [x,y,z,w]. */
function eulerToQuat([x, y, z]) {
	const cx = Math.cos(x / 2),
		sx = Math.sin(x / 2);
	const cy = Math.cos(y / 2),
		sy = Math.sin(y / 2);
	const cz = Math.cos(z / 2),
		sz = Math.sin(z / 2);
	return [
		sx * cy * cz + cx * sy * sz,
		cx * sy * cz - sx * cy * sz,
		cx * cy * sz + sx * sy * cz,
		cx * cy * cz - sx * sy * sz,
	];
}

/**
 * @param {EditorSession} session
 * @returns {Promise<Uint8Array>} modified GLB bytes
 */
export async function exportEditedGLB(session) {
	const buf = await session.getSourceBuffer();
	if (!buf) throw new Error('No source buffer for export');

	const io = new WebIO({ credentials: 'include' }).registerExtensions(ALL_EXTENSIONS);
	const doc = await io.readBinary(new Uint8Array(buf));
	const root = doc.getRoot();

	applyMaterialEdits(root, session.materialEdits);
	applyTransformAndVisibilityEdits(root, session.transformEdits, session.visibilityEdits);

	return io.writeBinary(doc);
}

function applyMaterialEdits(root, edits) {
	if (!edits || !Object.keys(edits).length) return;

	const byName = new Map();
	for (const mat of root.listMaterials()) {
		const n = mat.getName();
		if (!byName.has(n)) byName.set(n, mat);
	}

	for (const uuid in edits) {
		const edit = edits[uuid];
		const mat = byName.get(edit.name);
		if (!mat) continue;

		if (edit.baseColor) {
			const [r, g, b] = edit.baseColor;
			const alpha =
				edit.opacity !== undefined ? edit.opacity : mat.getBaseColorFactor()[3] ?? 1;
			mat.setBaseColorFactor([r, g, b, alpha]);
		} else if (edit.opacity !== undefined) {
			const f = mat.getBaseColorFactor() || [1, 1, 1, 1];
			mat.setBaseColorFactor([f[0], f[1], f[2], edit.opacity]);
		}

		if (edit.metalness !== undefined) mat.setMetallicFactor(edit.metalness);
		if (edit.roughness !== undefined) mat.setRoughnessFactor(edit.roughness);
		if (edit.emissive) mat.setEmissiveFactor(edit.emissive);
		if (edit.alphaMode !== undefined) mat.setAlphaMode(edit.alphaMode);
		if (edit.alphaCutoff !== undefined) mat.setAlphaCutoff(edit.alphaCutoff);
		if (edit.doubleSided !== undefined) mat.setDoubleSided(edit.doubleSided);
	}
}

function applyTransformAndVisibilityEdits(root, transformEdits, visibilityEdits) {
	const hasT = transformEdits && Object.keys(transformEdits).length > 0;
	const hasV = visibilityEdits && Object.keys(visibilityEdits).length > 0;
	if (!hasT && !hasV) return;

	const byName = new Map();
	for (const node of root.listNodes()) {
		const n = node.getName();
		if (n && !byName.has(n)) byName.set(n, node);
	}

	if (hasT) {
		for (const uuid in transformEdits) {
			const edit = transformEdits[uuid];
			const node = byName.get(edit.name);
			if (!node) continue;
			if (edit.position) node.setTranslation(edit.position);
			if (edit.rotation) node.setRotation(eulerToQuat(edit.rotation));
			if (edit.scale) node.setScale(edit.scale);
		}
	}

	if (hasV) {
		for (const uuid in visibilityEdits) {
			const edit = visibilityEdits[uuid];
			if (edit.visible) continue;
			const node = byName.get(edit.name);
			if (!node) continue;
			node.setScale([0, 0, 0]);
		}
	}
}

export function downloadGLB(bytes, filename = 'edited.glb') {
	const blob = new Blob([bytes], { type: 'model/gltf-binary' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

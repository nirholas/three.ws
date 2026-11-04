/**
 * GLB export pipeline using glTF-Transform.
 *
 * Reads the original GLB/GLTF bytes, applies accumulated edits from the
 * EditorSession, and re-serializes as a valid GLB.
 *
 * Edits are matched back to glTF-Transform entities by the glTF array index
 * the session captured from the loader (`materialIndex` / `nodeIndex`), which
 * stays unique when a model reuses a name. Edits stored before indices existed
 * (or from a source that has none) fall back to the name; a name that matches
 * several entities is applied to every one of them and reported in `warnings`
 * so the creator is told instead of silently getting the first match.
 *
 * Node visibility is written as KHR_node_visibility, so a hidden node keeps
 * its real scale and other glTF tools read it as hidden.
 */
import { WebIO } from '@gltf-transform/core';
import {
	ALL_EXTENSIONS,
	KHRMaterialsEmissiveStrength,
	KHRNodeVisibility,
	EXTTextureWebP,
} from '@gltf-transform/extensions';

const EMISSIVE_STRENGTH = 'KHR_materials_emissive_strength';
const NODE_VISIBILITY = 'KHR_node_visibility';
const HIDDEN_FLAG = 'threeWsHidden';

/** Texture slot id -> [getter, setter] names on a glTF-Transform Material. */
const TEXTURE_SLOTS = {
	baseColor: ['getBaseColorTexture', 'setBaseColorTexture'],
	normal: ['getNormalTexture', 'setNormalTexture'],
	metallicRoughness: ['getMetallicRoughnessTexture', 'setMetallicRoughnessTexture'],
	occlusion: ['getOcclusionTexture', 'setOcclusionTexture'],
	emissive: ['getEmissiveTexture', 'setEmissiveTexture'],
};

export const TEXTURE_SLOT_IDS = Object.keys(TEXTURE_SLOTS);

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
 * The glTF entities an edit targets. Index first (checked against the name so a
 * session recorded against a different file never patches the wrong entity),
 * then every entity with that name.
 */
function resolveTargets(list, edit, indexKey, kind, warnings) {
	const idx = edit[indexKey];
	if (Number.isInteger(idx) && list[idx] && list[idx].getName() === (edit.name ?? '')) {
		return [list[idx]];
	}
	const matches = list.filter((e) => e.getName() === edit.name);
	if (matches.length > 1) {
		const msg = `${kind} name "${edit.name}" matches ${matches.length} ${kind.toLowerCase()}s; the edit was applied to all of them.`;
		if (!warnings.includes(msg)) warnings.push(msg);
	}
	return matches;
}

/**
 * @param {EditorSession} session
 * @returns {Promise<{ bytes: Uint8Array, warnings: string[] }>} modified GLB bytes
 *   and any non-fatal problems the creator should be told about
 */
export async function exportEditedGLB(session) {
	const buf = await session.getSourceBuffer();
	if (!buf) throw new Error('No source buffer for export');

	const io = new WebIO({ credentials: 'include' }).registerExtensions(ALL_EXTENSIONS);
	const doc = await io.readBinary(new Uint8Array(buf));
	const warnings = [];

	applyMaterialEdits(doc, session.materialEdits, warnings);
	applyTextureEdits(doc, session.textureEdits, warnings);
	applyTransformAndVisibilityEdits(doc, session.transformEdits, session.visibilityEdits, warnings);

	for (const w of warnings) console.warn('[editor] export:', w);
	return { bytes: await io.writeBinary(doc), warnings };
}

function applyMaterialEdits(doc, edits, warnings) {
	if (!edits || !Object.keys(edits).length) return;
	const materials = doc.getRoot().listMaterials();

	for (const uuid in edits) {
		const edit = edits[uuid];
		for (const mat of resolveTargets(materials, edit, 'materialIndex', 'Material', warnings)) {
			if (edit.baseColor) {
				const [r, g, b] = edit.baseColor;
				const alpha =
					edit.opacity !== undefined ? edit.opacity : (mat.getBaseColorFactor()[3] ?? 1);
				mat.setBaseColorFactor([r, g, b, alpha]);
			} else if (edit.opacity !== undefined) {
				const f = mat.getBaseColorFactor() || [1, 1, 1, 1];
				mat.setBaseColorFactor([f[0], f[1], f[2], edit.opacity]);
			}

			if (edit.metalness !== undefined) mat.setMetallicFactor(edit.metalness);
			if (edit.roughness !== undefined) mat.setRoughnessFactor(edit.roughness);
			if (edit.emissive) mat.setEmissiveFactor(edit.emissive);
			if (edit.emissiveIntensity !== undefined) setEmissiveStrength(doc, mat, edit.emissiveIntensity);
			if (edit.alphaMode !== undefined) mat.setAlphaMode(edit.alphaMode);
			if (edit.alphaCutoff !== undefined) mat.setAlphaCutoff(edit.alphaCutoff);
			if (edit.doubleSided !== undefined) mat.setDoubleSided(edit.doubleSided);
		}
	}
}

/** Strength 1 is the glTF default, so it is represented by no extension at all. */
function setEmissiveStrength(doc, mat, value) {
	if (!Number.isFinite(value) || Math.abs(value - 1) < 1e-6) {
		mat.setExtension(EMISSIVE_STRENGTH, null);
		return;
	}
	const ext = doc.createExtension(KHRMaterialsEmissiveStrength);
	mat.setExtension(EMISSIVE_STRENGTH, ext.createEmissiveStrength().setEmissiveStrength(value));
}

function applyTextureEdits(doc, edits, warnings) {
	if (!edits || !Object.keys(edits).length) return;
	const materials = doc.getRoot().listMaterials();

	for (const key in edits) {
		const edit = edits[key];
		const slot = TEXTURE_SLOTS[edit.slot];
		if (!slot || !edit.bytes?.byteLength) continue;
		const [get, set] = slot;
		for (const mat of resolveTargets(materials, edit, 'materialIndex', 'Material', warnings)) {
			const previous = mat[get]();
			if (edit.mime === 'image/webp') doc.createExtension(EXTTextureWebP).setRequired(true);
			// A new texture per material: replacing the shared one in place would
			// change every other material that used it.
			const texture = doc
				.createTexture(`${mat.getName() || 'material'}-${edit.slot}`)
				.setImage(edit.bytes)
				.setMimeType(edit.mime);
			mat[set](texture);
			if (previous && previous.listParents().every((p) => p.propertyType === 'Root')) {
				previous.dispose();
			}
		}
	}
}

function applyTransformAndVisibilityEdits(doc, transformEdits, visibilityEdits, warnings) {
	const hasT = transformEdits && Object.keys(transformEdits).length > 0;
	const hasV = visibilityEdits && Object.keys(visibilityEdits).length > 0;
	if (!hasT && !hasV) return;
	const nodes = doc.getRoot().listNodes();

	if (hasT) {
		for (const uuid in transformEdits) {
			const edit = transformEdits[uuid];
			for (const node of resolveTargets(nodes, edit, 'nodeIndex', 'Node', warnings)) {
				if (edit.position) node.setTranslation(edit.position);
				if (edit.rotation) node.setRotation(eulerToQuat(edit.rotation));
				if (edit.scale) node.setScale(edit.scale);
			}
		}
	}

	if (hasV) {
		for (const uuid in visibilityEdits) {
			const edit = visibilityEdits[uuid];
			for (const node of resolveTargets(nodes, edit, 'nodeIndex', 'Node', warnings)) {
				setNodeVisible(doc, node, edit.visible !== false);
			}
		}
	}
}

function setNodeVisible(doc, node, visible) {
	const extras = { ...node.getExtras() };
	if (visible) {
		node.setExtension(NODE_VISIBILITY, null);
		delete extras[HIDDEN_FLAG];
	} else {
		const ext = doc.createExtension(KHRNodeVisibility);
		node.setExtension(NODE_VISIBILITY, ext.createVisibility().setVisible(false));
		// Readers that ignore the extension can still see the intent.
		extras[HIDDEN_FLAG] = true;
	}
	node.setExtras(extras);
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

// USDZ + half-body pipeline.
//
// Both helpers run entirely client-side:
//   1. Load a GLB Blob into a Three.js scene via GLTFLoader.
//   2. Either USDZ-export the whole scene, or strip the lower-body and GLB-
//      export the upper half.
//   3. Return the resulting Blob, ready to PUT to a presigned R2 URL.
//
// The viewer pulls the resulting URLs from the avatar record and feeds them
// into setARTarget() / loadHalfBody(), so iOS Quick Look and VR seats work
// without any external converter or hosted RPM endpoint.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { conformanceReport } from './runtime/arkit52.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { MeshStandardMaterial, Color, DoubleSide } from 'three';

// Bone-name fragments that mark the lower body. Matched case-insensitively
// after stripping the standard prefixes (mixamorig:, CC_Base_, Armature|).
const LOWER_BODY_FRAGMENTS = [
	'upleg', 'leg', 'thigh', 'knee', 'shin', 'calf',
	'foot', 'toe', 'ankle',
];

function _normalizeBone(name) {
	return String(name || '')
		.toLowerCase()
		.replace(/^mixamorig:?_?/, '')
		.replace(/^cc_base_/, '')
		.replace(/^armature[:_|]/, '')
		.replace(/^rig[:_]/, '');
}

function _isLowerBody(name) {
	const norm = _normalizeBone(name);
	return LOWER_BODY_FRAGMENTS.some((f) => norm.includes(f));
}

async function _loadGlbBlob(blob) {
	const loader = new GLTFLoader();
	const arrayBuf = await blob.arrayBuffer();
	return new Promise((resolve, reject) => {
		loader.parse(arrayBuf, '', resolve, reject);
	});
}

/**
 * Convert a GLB Blob to a USDZ Blob using three.js's USDZExporter.
 *
 * Materials are coerced to MeshStandardMaterial — USDZ only supports
 * UsdPreviewSurface, and the exporter throws on unlit / phong / toon.
 *
 * @param {Blob} glbBlob — bytes of the source GLB
 * @returns {Promise<Blob>} bytes packaged as a .usdz (zip-based) blob
 */
export async function glbBlobToUsdzBlob(glbBlob) {
	const gltf = await _loadGlbBlob(glbBlob);
	const scene = gltf.scene || gltf.scenes?.[0];
	if (!scene) throw new Error('USDZ: glb contained no scene');

	// Quick Look refuses Unlit/Phong/Toon materials; coerce to standard. The
	// visual result is close-to-identical for the typical avatar PBR setup.
	scene.traverse((obj) => {
		if (!obj.isMesh) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		mats.forEach((m, i) => {
			if (!m) return;
			if (m.isMeshStandardMaterial) return;
			const replacement = new MeshStandardMaterial({
				color: m.color ? m.color.clone() : new Color(0xffffff),
				map: m.map || null,
				normalMap: m.normalMap || null,
				roughness: typeof m.roughness === 'number' ? m.roughness : 0.85,
				metalness: typeof m.metalness === 'number' ? m.metalness : 0.0,
				transparent: !!m.transparent,
				opacity: typeof m.opacity === 'number' ? m.opacity : 1,
				side: m.side ?? DoubleSide,
			});
			if (Array.isArray(obj.material)) obj.material[i] = replacement;
			else obj.material = replacement;
		});
	});

	const exporter = new USDZExporter();
	const usdzBytes = await exporter.parseAsync(scene);
	return new Blob([usdzBytes], { type: 'model/vnd.usdz+zip' });
}

/**
 * Build a half-body GLB from a full-body GLB by hiding the lower-body
 * skeleton + skinned vertices, then GLB-exporting the result.
 *
 * Strategy: walk every skinned mesh, identify bone indices whose bone name
 * looks like leg/foot/toe, and zero the bone weights for those vertices.
 * Bone hierarchy is left intact so animation clips that reference lower
 * bones still apply cleanly — they just don't deform any geometry.
 *
 * @param {Blob} glbBlob — bytes of the source GLB
 * @returns {Promise<Blob>} half-body GLB blob
 */
export async function glbBlobToHalfBodyBlob(glbBlob) {
	const gltf = await _loadGlbBlob(glbBlob);
	const scene = gltf.scene || gltf.scenes?.[0];
	if (!scene) throw new Error('halfbody: glb contained no scene');

	let trimmedAny = false;

	scene.traverse((obj) => {
		if (!obj.isSkinnedMesh || !obj.skeleton) return;
		const bones = obj.skeleton.bones || [];
		const lowerBoneSet = new Set();
		bones.forEach((b, idx) => {
			if (_isLowerBody(b.name)) lowerBoneSet.add(idx);
		});
		if (!lowerBoneSet.size) return;

		const skinIdx = obj.geometry.getAttribute('skinIndex');
		const skinW = obj.geometry.getAttribute('skinWeight');
		if (!skinIdx || !skinW) return;

		// Zero out weights of vertices that are predominantly bound to lower
		// bones. We keep the geometry around — Quick Look-friendly and avoids
		// expensive re-indexing — and rely on the weight=0 to collapse those
		// triangles to the rest pose (head/torso).
		const count = skinIdx.count;
		for (let v = 0; v < count; v++) {
			let lowerWeight = 0;
			for (let i = 0; i < 4; i++) {
				const bone = skinIdx.getComponent(v, i);
				const w = skinW.getComponent(v, i);
				if (lowerBoneSet.has(bone)) lowerWeight += w;
			}
			if (lowerWeight > 0.5) {
				for (let i = 0; i < 4; i++) {
					skinW.setComponent(v, i, 0);
				}
			}
		}
		skinW.needsUpdate = true;
		trimmedAny = true;
	});

	if (!trimmedAny) {
		throw new Error('halfbody: no recognizable lower-body bones — skipping');
	}

	const exporter = new GLTFExporter();
	const buffer = await new Promise((resolve, reject) => {
		exporter.parse(
			scene,
			(out) => resolve(out),
			(err) => reject(err),
			{ binary: true, embedImages: true },
		);
	});
	return new Blob([buffer], { type: 'model/gltf-binary' });
}

/**
 * Inspect a GLB Blob and report which of the 52 canonical ARKit blendshapes
 * the avatar implements (including via known aliases — snake_case, _L/_R
 * suffixes, combined-shape fanout). Used by the upload pipeline to attach
 * coverage metadata so the editor can surface gaps to the user and the
 * Empathy Layer knows up-front what it can drive.
 *
 * @param {Blob} glbBlob
 * @returns {Promise<{ implemented: string[], missing: string[], coverage: number }>}
 */
export async function glbBlobToArkitReport(glbBlob) {
	const gltf = await _loadGlbBlob(glbBlob);
	const scene = gltf.scene || gltf.scenes?.[0];
	if (!scene) throw new Error('arkit: glb contained no scene');
	return conformanceReport(scene);
}

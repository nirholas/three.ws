// Size and ground a loaded avatar by its real, posed mesh.
//
// Both helpers measure with a precise Box3, which for a SkinnedMesh skins every
// vertex through its bones' matrixWorld. A GLB fresh out of the loader (or a
// SkeletonUtils clone of one) has never had its world matrices computed, so the
// bones still hold identity there. Measured that way, a centimetre-scale Mixamo
// rig (armature exported at scale 0.01, e.g. /avatars/michelle.glb) reads as a
// few millimetres tall, and scaling it "to 1.7 m" blew it up ~430x into a
// building-sized smear across the sky of /club. Refreshing the subtree's world
// matrices first makes the measurement the real one on every rig.
//
// The refresh must go through updateMatrixWorld, not updateWorldMatrix: only the
// former runs SkinnedMesh's override that re-derives bindMatrixInverse for an
// 'attached' mesh. Skipping it counts any ancestor move or scale twice.

import { Box3 } from 'three';

const _box = new Box3();

function measure(obj) {
	obj.parent?.updateWorldMatrix(true, false);
	obj.updateMatrixWorld(true);
	return _box.setFromObject(obj, true);
}

/**
 * Uniformly scale `obj` so its bounding height is `h` world units. A model that
 * cannot be measured (empty, or a degenerate box) is left untouched.
 *
 * @param {import('three').Object3D} obj
 * @param {number} h
 */
export function scaleToHeight(obj, h) {
	const b = measure(obj);
	const cur = b.max.y - b.min.y;
	if (!(cur > 1e-6) || !Number.isFinite(cur)) return;
	obj.scale.multiplyScalar(h / cur);
}

/**
 * Shift `obj` vertically so its lowest point sits at its parent's y = 0.
 *
 * @param {import('three').Object3D} obj
 */
export function groundFeet(obj) {
	const b = measure(obj);
	if (Number.isFinite(b.min.y)) obj.position.y -= b.min.y;
}

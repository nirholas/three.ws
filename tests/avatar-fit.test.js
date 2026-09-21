// Tests for src/shared/avatar-fit.js: sizing and grounding an avatar by its
// skinned mesh. The regression case is a centimetre-scale Mixamo layout (the
// armature node scaled 0.01, bones and bind-space vertices in centimetres),
// measured on a SkeletonUtils clone whose world matrices were never computed.
// That is exactly what the /club crowd does, and before the fix it read the rig
// as a few millimetres tall and scaled it into a ~700 m giant.

import { describe, it, expect } from 'vitest';
import {
	Bone,
	Box3,
	BufferGeometry,
	Float32BufferAttribute,
	Group,
	MeshBasicMaterial,
	Skeleton,
	SkinnedMesh,
	Uint16BufferAttribute,
} from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { scaleToHeight, groundFeet } from '../src/shared/avatar-fit.js';

// A 170 cm tall two-bone column under a 0.01-scaled armature node, laid out
// like a GLTFLoader result: nothing has had updateMatrixWorld called on it.
function centimetreRig() {
	const root = new Group();
	const armature = new Group();
	armature.scale.setScalar(0.01);
	root.add(armature);

	const hips = new Bone();
	hips.name = 'mixamorigHips';
	hips.position.set(0, 100, 0);
	const head = new Bone();
	head.name = 'mixamorigHead';
	head.position.set(0, 70, 0);
	hips.add(head);
	armature.add(hips);

	const positions = [-20, 0, 0, 20, 0, 0, 0, 170, 0, 0, 100, 10];
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], 4));
	geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
	geometry.setIndex([0, 1, 2, 0, 3, 2]);
	const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
	armature.add(mesh);

	// Bind in the armature's local (centimetre) frame, then throw the computed
	// world matrices away so the graph looks freshly loaded again.
	armature.updateMatrixWorld(true);
	mesh.bind(new Skeleton([hips, head]), mesh.matrixWorld);
	root.traverse((n) => n.matrixWorld.identity());
	return root;
}

function bounds(obj) {
	obj.updateMatrixWorld(true);
	return new Box3().setFromObject(obj, true);
}

function height(obj) {
	const b = bounds(obj);
	return b.max.y - b.min.y;
}

describe('scaleToHeight', () => {
	it('sizes a never-updated clone of a centimetre-scale rig to the requested height', () => {
		const model = clone(centimetreRig());
		scaleToHeight(model, 1.7);
		expect(height(model)).toBeCloseTo(1.7, 3);
	});

	it('is a no-op on an empty object instead of scaling by infinity', () => {
		const empty = new Group();
		scaleToHeight(empty, 1.7);
		expect(empty.scale.toArray()).toEqual([1, 1, 1]);
	});
});

describe('groundFeet', () => {
	it('puts the lowest skinned vertex on y = 0', () => {
		const model = clone(centimetreRig());
		model.position.y = 3;
		scaleToHeight(model, 1.7);
		groundFeet(model);
		expect(bounds(model).min.y).toBeCloseTo(0, 4);
		expect(height(model)).toBeCloseTo(1.7, 3);
	});
});

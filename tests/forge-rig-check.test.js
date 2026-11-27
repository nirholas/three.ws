/**
 * The Rig button checks a rigged model before it replaces the static one
 * (src/forge-rig-check.js). Measured 2026-11-27: the rig tool answered "done"
 * for a katana and a pair of boots with a human skeleton, and the page showed
 * whatever came back without looking at it. These tests pin the check on real
 * three.js skinned meshes and the real library idle clip:
 *   - no skeleton, broken skin weights and a skeleton that does not fit the
 *     mesh are each refused with a sentence that says what is wrong;
 *   - a humanoid plays the library idle and a creature plays the sway, and
 *     both pass without the mesh exploding;
 *   - the bones are back in their bind pose afterwards, so the model can be
 *     exported for the viewer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	Bone,
	BufferGeometry,
	Float32BufferAttribute,
	Group,
	Mesh,
	MeshBasicMaterial,
	Skeleton,
	SkinnedMesh,
	Uint16BufferAttribute,
} from 'three';
import { verifyRiggedModel, swayClip, measureDeformation, HUMANOID_TEST_CLIP } from '../src/forge-rig-check.js';

const IDLE = JSON.parse(readFileSync(new URL(`../public${HUMANOID_TEST_CLIP}`, import.meta.url), 'utf8'));

// Bones as [name, parent, local offset]. A 1.8 m figure standing on y = 0.
const HUMAN = [
	['Hips', null, [0, 1.0, 0]],
	['Spine', 'Hips', [0, 0.1, 0]],
	['Spine1', 'Spine', [0, 0.12, 0]],
	['Spine2', 'Spine1', [0, 0.12, 0]],
	['Neck', 'Spine2', [0, 0.16, 0]],
	['Head', 'Neck', [0, 0.1, 0]],
	['LeftShoulder', 'Spine2', [0.06, 0.12, 0]],
	['LeftArm', 'LeftShoulder', [0.12, 0, 0]],
	['LeftForeArm', 'LeftArm', [0.27, 0, 0]],
	['LeftHand', 'LeftForeArm', [0.25, 0, 0]],
	['RightShoulder', 'Spine2', [-0.06, 0.12, 0]],
	['RightArm', 'RightShoulder', [-0.12, 0, 0]],
	['RightForeArm', 'RightArm', [-0.27, 0, 0]],
	['RightHand', 'RightForeArm', [-0.25, 0, 0]],
	['LeftUpLeg', 'Hips', [0.09, -0.05, 0]],
	['LeftLeg', 'LeftUpLeg', [0, -0.45, 0]],
	['LeftFoot', 'LeftLeg', [0, -0.42, 0]],
	['LeftToeBase', 'LeftFoot', [0, -0.06, 0.12]],
	['RightUpLeg', 'Hips', [-0.09, -0.05, 0]],
	['RightLeg', 'RightUpLeg', [0, -0.45, 0]],
	['RightFoot', 'RightLeg', [0, -0.42, 0]],
	['RightToeBase', 'RightFoot', [0, -0.06, 0.12]],
];

// A 24-bone chain, the shape the non-human rigger returns for a hound.
const CHAIN = Array.from({ length: 24 }, (_, i) => [`bone_${i}`, i ? `bone_${i - 1}` : null, i ? [0.05, 0, 0] : [0, 0.5, 0]]);

/**
 * Build a skinned model: a small cube of eight vertices around each bone,
 * weighted fully to that bone. `bonesAt` shifts the whole skeleton (a skeleton
 * that does not sit inside its mesh); `weights` and `index` overwrite the first
 * vertices' weights and joint indices, four values per vertex.
 */
function skinned(spec, { bonesAt = [0, 0, 0], weights = null, index = null } = {}) {
	const group = new Group();
	const byName = new Map();
	const bones = spec.map(([name, parent, at]) => {
		const bone = new Bone();
		bone.name = name;
		bone.position.set(...at);
		byName.set(name, bone);
		(parent ? byName.get(parent) : group).add(bone);
		return bone;
	});
	group.updateMatrixWorld(true);

	const positions = [];
	const skinIndex = [];
	const skinWeight = [];
	const r = 0.03;
	bones.forEach((bone, i) => {
		const p = bone.getWorldPosition(bone.position.clone().set(0, 0, 0));
		for (const dx of [-r, r]) for (const dy of [-r, r]) for (const dz of [-r, r]) {
			positions.push(p.x + dx, p.y + dy, p.z + dz);
			skinIndex.push(i, 0, 0, 0);
			skinWeight.push(1, 0, 0, 0);
		}
	});
	if (weights) skinWeight.splice(0, weights.length, ...weights);
	if (index) skinIndex.splice(0, index.length, ...index);

	// Move the skeleton after the mesh is laid out, then bind: the bind matrices
	// are right for where the bones are, but the bones are not inside the mesh.
	bones[0].position.x += bonesAt[0];
	bones[0].position.y += bonesAt[1];
	bones[0].position.z += bonesAt[2];
	group.updateMatrixWorld(true);

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
	geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
	const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
	group.add(mesh);
	group.updateMatrixWorld(true);
	mesh.bind(new Skeleton(bones));
	return group;
}

describe('verifyRiggedModel refuses a rig that cannot move', () => {
	it('refuses a model with no skeleton', () => {
		const root = new Group();
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
		root.add(new Mesh(geometry, new MeshBasicMaterial()));

		const out = verifyRiggedModel(root);

		expect(out.ok).toBe(false);
		expect(out.problem.code).toBe('no_skeleton');
		expect(out.problem.message).toMatch(/without a skeleton/);
	});

	it.each([
		['a NaN weight', { weights: [Number.NaN, 0, 0, 0] }],
		['a joint index past the last bone', { index: [999, 0, 0, 0] }],
		['a negative weight', { weights: [1.2, -0.2, 0, 0] }],
	])('refuses %s on a single vertex', (_label, broken) => {
		const out = verifyRiggedModel(skinned(CHAIN, broken));

		expect(out.ok).toBe(false);
		expect(out.problem.code).toBe('bad_weights');
		expect(out.problem.message).toMatch(/broken skin weights/);
		expect(out.stats.badWeights).toBe(1);
	});

	it('refuses weights that do not sum to 1 once they pass 1% of the vertices', () => {
		// One bone's cube is 8 of the chain's 192 vertices: 4.2%.
		const out = verifyRiggedModel(skinned(CHAIN, { weights: Array(8).fill([0.5, 0, 0, 0]).flat() }));

		expect(out.ok).toBe(false);
		expect(out.problem.code).toBe('bad_weights');
		expect(out.problem.message).toMatch(/^4\.2% of this model's vertices/);
	});

	it('lets a stray vertex whose weights sum slightly off pass under the 1% bound', () => {
		const out = verifyRiggedModel(skinned(CHAIN, { weights: [0.5, 0, 0, 0] }));

		expect(out.ok).toBe(true);
		expect(out.stats.badWeights).toBe(1);
	});

	it('refuses a skeleton that sits outside its mesh, because the mesh flies apart when it moves', () => {
		const out = verifyRiggedModel(skinned(CHAIN, { bonesAt: [0, 40, 0] }));

		expect(out.ok).toBe(false);
		expect(out.problem.code).toBe('explodes');
		expect(out.problem.message).toMatch(/stretched out of shape/);
		expect(out.stats.drift).toBeGreaterThan(0.6);
	});
});

describe('verifyRiggedModel passes a rig that moves', () => {
	it('plays the library idle on a humanoid without the mesh exploding', () => {
		const out = verifyRiggedModel(skinned(HUMAN), { clipJson: IDLE });

		expect(out.problem).toBeNull();
		expect(out.ok).toBe(true);
		expect(out.kind).toBe('humanoid');
		expect(out.clip.name).toBe('av-idle-breath');
		expect(out.clip.tracks.length).toBeGreaterThan(20);
		expect(out.stats.growth).toBeLessThan(1.75);
		expect(out.stats.drift).toBeLessThan(0.6);
	});

	it('plays the sway on a creature the clip library cannot drive', () => {
		const out = verifyRiggedModel(skinned(CHAIN), { clipJson: IDLE });

		expect(out.ok).toBe(true);
		expect(out.kind).toBe('creature');
		expect(out.clip.name).toBe('Sway');
		expect(out.clip.tracks).toHaveLength(24);
	});

	it('puts every bone back in its bind pose after the test', () => {
		const root = skinned(HUMAN);
		const before = [];
		root.traverse((n) => n.isBone && before.push([n, n.quaternion.clone(), n.position.clone()]));

		measureDeformation(root, swayClip(root));

		for (const [bone, q, p] of before) {
			expect(bone.quaternion.equals(q)).toBe(true);
			expect(bone.position.equals(p)).toBe(true);
		}
	});
});

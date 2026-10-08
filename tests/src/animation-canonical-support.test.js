import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Bone, BufferGeometry, Group, Object3D, PropertyBinding, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { AnimationManager } from '../../src/animation-manager.js';
import { CANONICAL_BONES } from '../../src/glb-canonicalize.js';
import { canonicalRestDirectionMapFromObject } from '../../src/animation-retarget.js';
import { CANONICAL_PARENT, CANONICAL_REST_POSITION } from '../../src/animation-canonical-rest.js';
import { loadBoneGraph } from '../_helpers/glb-bone-graph.js';

// AnimationManager.attach() is only ever handed a real three.js scene graph (a
// GLTFLoader result), and every rest-frame capture it runs reads that graph's
// world matrices. So these fixtures are real Object3D/Bone/SkinnedMesh graphs,
// laid out on the canonical reference skeleton, never duck-typed stand-ins: a
// plain `{ traverse }` object stopped being a valid model the day attach()
// began measuring limb rest directions (8561d5c5d).

const CZ_GLB = fileURLToPath(new URL('../../public/avatars/cz.glb', import.meta.url));

// Nearest ancestor of `bone` on the canonical skeleton that the fixture
// actually carries, so a partial rig still nests the way a real export does.
function presentParent(bone, present, rename) {
	for (let p = CANONICAL_PARENT[bone]; p; p = CANONICAL_PARENT[p]) {
		if (present.has(p)) return rename(p);
	}
	return null;
}

/**
 * Build a real bone graph for a set of canonical bones, at the reference rig's
 * bind positions (identity rotations, so world position == authored position).
 *
 * @param {string[]} canonicalNames canonical bones to include
 * @param {object} [opts]
 * @param {(name: string) => string} [opts.rename] node name for a canonical bone
 * @param {boolean} [opts.skinned] bind a SkinnedMesh to the bones
 * @param {(name: string) => number[]} [opts.position] world bind position override
 */
function humanoid(canonicalNames, { rename = (n) => n, skinned = true, position } = {}) {
	const root = new Group();
	root.name = 'root';
	const present = new Set(canonicalNames);
	const nodes = new Map();
	const worldOf = (name) => new Vector3().fromArray(position?.(name) || CANONICAL_REST_POSITION[name]);
	for (const name of canonicalNames) {
		const node = skinned ? new Bone() : new Object3D();
		node.name = rename(name);
		nodes.set(node.name, { node, world: worldOf(name) });
	}
	for (const name of canonicalNames) {
		const { node, world } = nodes.get(rename(name));
		const parentName = presentParent(name, present, rename);
		const parent = parentName ? nodes.get(parentName) : null;
		node.position.copy(parent ? world.clone().sub(parent.world) : world);
		(parent ? parent.node : root).add(node);
	}
	if (skinned) {
		const bones = [...nodes.values()].map((e) => e.node);
		const mesh = new SkinnedMesh(new BufferGeometry());
		mesh.name = 'Body';
		mesh.bind(new Skeleton(bones));
		root.add(mesh);
	}
	root.updateMatrixWorld(true);
	return root;
}

// A skinned chain of bones whose names map to no canonical joint.
function creature() {
	const root = new Group();
	let parent = root;
	const bones = [];
	for (const name of ['tail_01', 'tail_02', 'wing_L', 'wing_R', 'jaw']) {
		const bone = new Bone();
		bone.name = name;
		bone.position.set(0, 0.1, 0);
		parent.add(bone);
		bones.push(bone);
		parent = bone;
	}
	const mesh = new SkinnedMesh(new BufferGeometry());
	mesh.bind(new Skeleton(bones));
	root.add(mesh);
	return root;
}

const DEG = 180 / Math.PI;

describe('AnimationManager.supportsCanonicalClips', () => {
	it('is false before any model is attached', () => {
		const mgr = new AnimationManager();
		expect(mgr.supportsCanonicalClips()).toBe(false);
	});

	it('is true for a skinned humanoid matching the canonical rig', () => {
		const mgr = new AnimationManager();
		mgr.attach(humanoid(CANONICAL_BONES.slice()));
		expect(mgr.supportsCanonicalClips()).toBe(true);
	});

	it('is true for a Mixamo-prefixed humanoid (names canonicalize)', () => {
		const mgr = new AnimationManager();
		// GLTFLoader sanitizes `mixamorig:Hips` to `mixamorigHips`; mirror it.
		const rename = (b) => PropertyBinding.sanitizeNodeName(`mixamorig:${b}`);
		mgr.attach(humanoid(CANONICAL_BONES.slice(0, 12), { rename }));
		expect(mgr.supportsCanonicalClips()).toBe(true);
	});

	it('is false for a static mesh with no skeleton', () => {
		const mgr = new AnimationManager();
		// Canonical node *names* present, but nothing is a SkinnedMesh.
		mgr.attach(humanoid(CANONICAL_BONES.slice(), { skinned: false }));
		expect(mgr.supportsCanonicalClips()).toBe(false);
	});

	it('is false for a skinned non-humanoid rig (few canonical bones)', () => {
		const mgr = new AnimationManager();
		mgr.attach(creature());
		expect(mgr.supportsCanonicalClips()).toBe(false);
	});

	it('resets to false after detach', () => {
		const mgr = new AnimationManager();
		mgr.attach(humanoid(CANONICAL_BONES.slice()));
		expect(mgr.supportsCanonicalClips()).toBe(true);
		mgr.detach();
		expect(mgr.supportsCanonicalClips()).toBe(false);
	});

	it('attaches the committed cz.glb skeleton and admits it to the clip library', () => {
		const mgr = new AnimationManager();
		const { root } = loadBoneGraph(CZ_GLB);
		mgr.attach(root);
		expect(mgr.supportsCanonicalClips()).toBe(true);
	});
});

// Direct coverage for the rest-direction capture attach() runs on every model.
// It had none, which is how a fixture that could not answer updateMatrixWorld()
// sat red without anyone noticing what the new capture assumed.
describe('canonicalRestDirectionMapFromObject', () => {
	it('reads a T-posed arm as pointing straight out along the side axis', () => {
		const dirs = canonicalRestDirectionMapFromObject(humanoid(CANONICAL_BONES.slice()));
		for (const bone of ['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm']) {
			expect(dirs.has(bone)).toBe(true);
		}
		expect(dirs.get('LeftArm').angleTo(new Vector3(1, 0, 0)) * DEG).toBeLessThan(5);
		expect(dirs.get('RightArm').angleTo(new Vector3(-1, 0, 0)) * DEG).toBeLessThan(5);
		expect(dirs.get('LeftUpLeg').y).toBeLessThan(-0.9);
	});

	it('reads an A-posed arm as dropped 45 degrees, which is what the re-aim corrects', () => {
		const shoulder = new Vector3().fromArray(CANONICAL_REST_POSITION.LeftArm);
		const drop = (name) => {
			const p = new Vector3().fromArray(CANONICAL_REST_POSITION[name]);
			if (!['LeftForeArm', 'LeftHand'].includes(name)) return p.toArray();
			const reach = p.x - shoulder.x;
			return [shoulder.x + reach * Math.SQRT1_2, shoulder.y - reach * Math.SQRT1_2, p.z];
		};
		const dirs = canonicalRestDirectionMapFromObject(humanoid(CANONICAL_BONES.slice(), { position: drop }));
		const tilt = dirs.get('LeftArm').angleTo(new Vector3(1, 0, 0)) * DEG;
		expect(tilt).toBeGreaterThan(40);
		expect(tilt).toBeLessThan(50);
		expect(dirs.get('LeftArm').y).toBeLessThan(0);
	});

	it('measures in the model frame, so moving or turning the scene around it changes nothing', () => {
		const model = humanoid(CANONICAL_BONES.slice());
		const still = canonicalRestDirectionMapFromObject(model).get('LeftArm').clone();
		const parent = new Group();
		parent.position.set(4, -2, 7);
		parent.rotation.set(0.3, 1.1, -0.2);
		parent.add(model);
		parent.updateMatrixWorld(true);
		const moved = canonicalRestDirectionMapFromObject(model).get('LeftArm');
		expect(moved.angleTo(still) * DEG).toBeLessThan(0.01);
	});

	it('returns an empty map for a graph with no canonical limbs', () => {
		expect(canonicalRestDirectionMapFromObject(creature()).size).toBe(0);
		expect(canonicalRestDirectionMapFromObject(null).size).toBe(0);
	});
});

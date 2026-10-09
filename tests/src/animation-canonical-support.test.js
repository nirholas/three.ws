import { describe, it, expect } from 'vitest';
import { Group, Object3D, SkinnedMesh } from 'three';
import { AnimationManager } from '../../src/animation-manager.js';
import { CANONICAL_BONES } from '../../src/glb-canonicalize.js';

// AnimationManager.attach() reads the model's rest pose (world matrices, rest
// directions) as well as `.name` and `.isSkinnedMesh`, so the model must be a
// real three.js scene graph. Plain named Object3D nodes under a Group exercise
// the canonical support check without loading real GLB assets.
function fakeModel(nodes) {
	const root = new Group();
	root.name = 'root';
	for (const node of nodes) root.add(node);
	return root;
}

function named(node, name) {
	node.name = name;
	return node;
}

function boneNodes(names, { skinned = true } = {}) {
	const nodes = names.map((name) => named(new Object3D(), name));
	if (skinned) nodes.push(named(new SkinnedMesh(), 'Body'));
	return nodes;
}

describe('AnimationManager.supportsCanonicalClips', () => {
	it('is false before any model is attached', () => {
		const mgr = new AnimationManager();
		expect(mgr.supportsCanonicalClips()).toBe(false);
	});

	it('is true for a skinned humanoid matching the canonical rig', () => {
		const mgr = new AnimationManager();
		mgr.attach(fakeModel(boneNodes(CANONICAL_BONES.slice())));
		expect(mgr.supportsCanonicalClips()).toBe(true);
	});

	it('is true for a Mixamo-prefixed humanoid (names canonicalize)', () => {
		const mgr = new AnimationManager();
		const mixamo = CANONICAL_BONES.slice(0, 12).map((b) => `mixamorig:${b}`);
		mgr.attach(fakeModel(boneNodes(mixamo)));
		expect(mgr.supportsCanonicalClips()).toBe(true);
	});

	it('is false for a static mesh with no skeleton', () => {
		const mgr = new AnimationManager();
		// Canonical bone *names* present, but nothing is a SkinnedMesh.
		mgr.attach(fakeModel(boneNodes(CANONICAL_BONES.slice(), { skinned: false })));
		expect(mgr.supportsCanonicalClips()).toBe(false);
	});

	it('is false for a skinned non-humanoid rig (few canonical bones)', () => {
		const mgr = new AnimationManager();
		mgr.attach(fakeModel(boneNodes(['tail_01', 'tail_02', 'wing_L', 'wing_R', 'jaw'])));
		expect(mgr.supportsCanonicalClips()).toBe(false);
	});

	it('resets to false after detach', () => {
		const mgr = new AnimationManager();
		mgr.attach(fakeModel(boneNodes(CANONICAL_BONES.slice())));
		expect(mgr.supportsCanonicalClips()).toBe(true);
		mgr.detach();
		expect(mgr.supportsCanonicalClips()).toBe(false);
	});
});

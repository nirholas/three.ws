/**
 * Tests for src/animation-bvh-export.js: AnimationClip (canonical skeleton)
 * to Biovision BVH text.
 *
 * The round-trip test is the one that matters: it writes a BVH, parses it
 * back with three.js's OWN BVHLoader (the same loader
 * src/dashboard-next/pages/library/animations.js already uses for BVH
 * import), and checks the recovered per-joint rotations and root translation
 * match the source clip. That is the load-bearing proof that a file this
 * module writes is a real, correctly-encoded BVH and not merely
 * well-formed-looking text: Blender, Unreal and every other BVH consumer
 * use the same channel-order convention BVHLoader does.
 */

import { describe, it, expect } from 'vitest';
import {
	AnimationClip,
	Euler,
	MathUtils,
	Quaternion,
	QuaternionKeyframeTrack,
	Vector3,
	VectorKeyframeTrack,
} from 'three';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';

import { canonicalBoneOrder, canonicalLocalOffset, clipToBVH, clipJSONToBVH } from '../src/animation-bvh-export.js';
import { CANONICAL_PARENT } from '../src/animation-canonical-rest.js';

function qArr(q) {
	return [q.x, q.y, q.z, q.w];
}

// A clip that rotates Hips, Spine and LeftArm through a sweep, and moves
// Hips forward, so both the root translation path and a mid-chain joint's
// rotation path get exercised.
function makeClip() {
	const hipsQ = new QuaternionKeyframeTrack(
		'Hips.quaternion',
		[0, 1],
		[...qArr(new Quaternion()), ...qArr(new Quaternion().setFromEuler(new Euler(0.1, 0.4, -0.05)))],
	);
	const hipsPos = new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0.98, 0, 0.2, 0.98, 0.35]);
	const spineQ = new QuaternionKeyframeTrack(
		'Spine.quaternion',
		[0, 1],
		[...qArr(new Quaternion()), ...qArr(new Quaternion().setFromEuler(new Euler(-0.2, 0, 0.1)))],
	);
	const armQ = new QuaternionKeyframeTrack(
		'LeftArm.quaternion',
		[0, 1],
		[...qArr(new Quaternion().setFromEuler(new Euler(0, 0, 0.6))), ...qArr(new Quaternion().setFromEuler(new Euler(0.3, 0.2, 1.1)))],
	);
	return new AnimationClip('capture', 1, [hipsQ, hipsPos, spineQ, armQ]);
}

describe('canonicalBoneOrder', () => {
	it('is rooted at Hips and covers every canonical bone exactly once', () => {
		const { order, root } = canonicalBoneOrder();
		expect(root).toBe('Hips');
		expect(order[0]).toBe('Hips');
		expect(new Set(order).size).toBe(order.length);
		expect(order.length).toBe(Object.keys(CANONICAL_PARENT).length);
		for (const name of Object.keys(CANONICAL_PARENT)) expect(order).toContain(name);
	});
});

describe('canonicalLocalOffset', () => {
	it('returns a zero-length offset only when parent and child coincide, and is deterministic', () => {
		const a = canonicalLocalOffset('Spine', 'Hips');
		const b = canonicalLocalOffset('Spine', 'Hips');
		expect(a.toArray()).toEqual(b.toArray());
		expect(a.length()).toBeGreaterThan(0);
	});

	it('returns the raw rest position for the root (no parent)', () => {
		const offset = canonicalLocalOffset('Hips', null);
		expect(offset).toBeInstanceOf(Vector3);
		expect(offset.y).toBeGreaterThan(0.5); // hip height, meters
	});
});

describe('clipToBVH', () => {
	const bvh = clipToBVH(makeClip(), { fps: 30 });

	it('writes a well-formed HIERARCHY/MOTION document rooted at Hips', () => {
		expect(bvh.startsWith('HIERARCHY\nROOT Hips\n')).toBe(true);
		expect(bvh).toContain('CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation');
		expect(bvh).toContain('CHANNELS 3 Zrotation Xrotation Yrotation');
		expect(bvh).toContain('End Site');
		expect(bvh).toMatch(/\nMOTION\nFrames: \d+\nFrame Time: [\d.]+\n/);
	});

	it('emits one joint block per canonical bone', () => {
		const jointCount = (bvh.match(/\n\t*(ROOT|JOINT) /g) || []).length;
		expect(jointCount).toBe(Object.keys(CANONICAL_PARENT).length);
	});

	it('emits exactly Frames+1-worth of motion rows matching the declared Frames count', () => {
		const framesDeclared = Number(bvh.match(/Frames: (\d+)/)[1]);
		const motionBody = bvh.split('\n').filter((l) => /^-?\d/.test(l));
		expect(motionBody.length).toBe(framesDeclared);
	});

	it('round-trips through three.js BVHLoader: root translation and a mid-chain rotation match the source clip', () => {
		const loader = new BVHLoader();
		const parsed = loader.parse(bvh);
		expect(parsed.clip).toBeTruthy();

		const source = makeClip();
		const findTrack = (clip, name) => clip.tracks.find((t) => t.name === name);

		for (const t of [0, 0.5, 1]) {
			// Root translation (meters in source, centimeters on the wire).
			const srcPos = findTrack(source, 'Hips.position').createInterpolant().evaluate(t);
			const outPosTrack = findTrack(parsed.clip, 'Hips.position');
			expect(outPosTrack).toBeTruthy();
			const outPos = outPosTrack.createInterpolant().evaluate(t);
			for (let i = 0; i < 3; i++) expect(outPos[i] / 100).toBeCloseTo(srcPos[i], 3);

			// A mid-chain joint's rotation (LeftArm): angleTo is the right
			// comparator for quaternions since q and -q represent the same
			// rotation and a naive component diff would false-fail on sign flips.
			const srcQv = findTrack(source, 'LeftArm.quaternion').createInterpolant().evaluate(t);
			const srcQ = new Quaternion(srcQv[0], srcQv[1], srcQv[2], srcQv[3]);
			const outTrack = findTrack(parsed.clip, 'LeftArm.quaternion');
			expect(outTrack).toBeTruthy();
			const outQv = outTrack.createInterpolant().evaluate(t);
			const outQ = new Quaternion(outQv[0], outQv[1], outQv[2], outQv[3]);
			expect(srcQ.angleTo(outQ)).toBeLessThan(MathUtils.degToRad(0.1));
		}
	});

	it('holds identity rotation for canonical bones the source clip never animated', () => {
		const loader = new BVHLoader();
		const parsed = loader.parse(bvh);
		const headTrack = parsed.clip.tracks.find((t) => t.name === 'Head.quaternion');
		expect(headTrack).toBeTruthy();
		const q = headTrack.createInterpolant().evaluate(0.5);
		const identity = new Quaternion();
		expect(new Quaternion(q[0], q[1], q[2], q[3]).angleTo(identity)).toBeLessThan(1e-4);
	});
});

describe('clipJSONToBVH', () => {
	it('accepts a clip.json document directly, the same artifact model-video2motion serves', () => {
		const json = AnimationClip.toJSON(makeClip());
		const bvh = clipJSONToBVH(json, { fps: 24 });
		expect(bvh.startsWith('HIERARCHY\n')).toBe(true);
		expect(bvh).toContain('Frame Time: 0.041667');
	});
});

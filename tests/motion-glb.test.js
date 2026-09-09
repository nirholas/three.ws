/**
 * Baking a motion clip onto a rig as a self-contained animated GLB.
 *
 * The rig is the real one the platform ships (public/avatars/default.glb), not a
 * fixture, because every interesting failure in this module is a property of a
 * real container: a meshopt-compressed rig whose bufferViews must survive
 * untouched, a node graph the clip's bone names have to resolve against, and a
 * rest basis the clip's rotations have to be corrected into. A synthetic two-node
 * glTF would exercise none of that.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { bakeMotionGlb, readGlbChunks, restBoneHeight, restBasisFromGltf } from '../api/_lib/motion-glb.js';
import { CANONICAL_REST } from '../src/animation-canonical-rest.js';

const RIG = readFileSync(fileURLToPath(new URL('../public/avatars/default.glb', import.meta.url)));

const BONES = [
	'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
	'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
	'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
	'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
	'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

function quatX(angle) {
	return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

function quatMul(a, b) {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

/** A clip in the library's canonical basis, the shape a published clip has. */
function clipFixture({ frames = 60, fps = 30, drift = 0 } = {}) {
	const times = Array.from({ length: frames }, (_, i) => i / fps);
	const tracks = BONES.map((bone) => {
		const values = [];
		for (let i = 0; i < frames; i += 1) {
			values.push(...quatMul(CANONICAL_REST[bone] ?? [0, 0, 0, 1], quatX(0.2 * Math.sin((i / frames) * Math.PI * 4))));
		}
		return { type: 'quaternion', name: `${bone}.quaternion`, times: [...times], values };
	});
	const hips = [];
	for (let i = 0; i < frames; i += 1) hips.push(0, 0.92 + 0.02 * Math.sin(i / 5), drift * times[i]);
	tracks.push({ type: 'vector', name: 'Hips.position', times: [...times], values: hips });
	return {
		name: 'gen-test-000000000000',
		duration: (frames - 1) / fps,
		tracks,
		uuid: '11111111-2222-3333-4444-555555555555',
		blendMode: 0,
		userData: { basis: 'canonical-rest-v1' },
	};
}

describe('glb container', () => {
	it('round-trips the shipping rig without disturbing it', () => {
		const { json, bin } = readGlbChunks(RIG);
		expect(json.asset.version).toBe('2.0');
		expect(json.nodes.length).toBeGreaterThan(50);
		expect(bin.length).toBe(json.buffers[0].byteLength);
		// The rig is meshopt-compressed, which is exactly why the bake edits the
		// container instead of decoding it.
		expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
	});

	it('refuses anything that is not a binary glTF 2.0', () => {
		expect(() => readGlbChunks(Buffer.alloc(4))).toThrow(/too short/);
		expect(() => readGlbChunks(Buffer.alloc(64))).toThrow(/bad magic/);
	});

	it('reads the rig rest height the root track is scaled against', () => {
		const { json } = readGlbChunks(RIG);
		expect(restBoneHeight(json)).toBeCloseTo(1.037, 2);
		expect(restBoneHeight(json, 'NoSuchBone')).toBeNull();
	});
});

describe('rest basis from the container', () => {
	it('maps every canonical bone the clip drives', () => {
		const { json } = readGlbChunks(RIG);
		const basis = restBasisFromGltf(json);
		for (const bone of BONES) expect(basis.canonicalToNode.has(bone)).toBe(true);
		expect(basis.targetRest.size).toBe(basis.canonicalToNode.size);
		expect(basis.targetWorldRest.size).toBe(basis.canonicalToNode.size);
	});
});

describe('bakeMotionGlb', () => {
	it('writes one animation covering every driven bone', () => {
		const result = bakeMotionGlb({ rig: RIG, clip: clipFixture(), name: 'test-motion' });
		expect(result.channels).toBe(BONES.length + 1); // every bone, plus root translation
		expect(result.droppedTracks).toEqual([]);
		expect(result.coverage).toBe(1);

		const { json } = readGlbChunks(result.glb);
		expect(json.animations).toHaveLength(1);
		expect(json.animations[0].name).toBe('test-motion');
		expect(json.animations[0].channels).toHaveLength(result.channels);
	});

	it('produces a container that still parses, with the buffer length updated', () => {
		const result = bakeMotionGlb({ rig: RIG, clip: clipFixture() });
		const { json, bin } = readGlbChunks(result.glb);
		expect(bin.length).toBe(json.buffers[0].byteLength);
		expect(result.glb.length).toBeGreaterThan(RIG.length);
		// The rig's own bufferViews are untouched, so its meshes still decode.
		const original = readGlbChunks(RIG);
		expect(json.bufferViews.slice(0, original.json.bufferViews.length)).toEqual(original.json.bufferViews);
	});

	it('gives every animation sampler input the min and max the spec requires', () => {
		const { json } = readGlbChunks(bakeMotionGlb({ rig: RIG, clip: clipFixture() }).glb);
		for (const sampler of json.animations[0].samplers) {
			const input = json.accessors[sampler.input];
			expect(input.type).toBe('SCALAR');
			expect(Array.isArray(input.min)).toBe(true);
			expect(Array.isArray(input.max)).toBe(true);
			expect(input.max[0]).toBeGreaterThan(input.min[0]);
		}
	});

	it('scales root motion onto the rig it is baking for', () => {
		// The fixture is authored around a 0.92 m hip and the rig rests at 1.037.
		const result = bakeMotionGlb({ rig: RIG, clip: clipFixture() });
		expect(result.hipScale).toBeCloseTo(1.037 / 0.92, 1);
	});

	it('takes the lane drift out by default and leaves it in on request', () => {
		const drifting = clipFixture({ drift: 0.25 });
		expect(bakeMotionGlb({ rig: RIG, clip: drifting }).driftRemoved).toBeGreaterThan(0.4);
		expect(bakeMotionGlb({ rig: RIG, clip: drifting, flatten: false }).driftRemoved).toBe(0);
	});

	it('refuses a clip with nothing to bake rather than writing an empty animation', () => {
		expect(() => bakeMotionGlb({ rig: RIG, clip: { tracks: [] } })).toThrow(/no tracks/);
	});
});

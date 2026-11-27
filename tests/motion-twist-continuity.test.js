/**
 * Generated motion keeps every bone's twist continuous from frame to frame.
 *
 * The text2motion worker recovers rotations from joint POSITIONS
 * (workers/model-text2motion/motion_decode.py `_positions_to_local_quats`). A
 * bone with one child only has one direction to fit, so the fit leaves the
 * twist about that bone free, and the SVD it uses picks that twist arbitrarily
 * on every frame. Measured on a live "waves hello" clip on 2026-11-27: the right
 * collar turned 179.9 degrees between frames 0 and 1, the neck and the forearms
 * flipped by up to 180 degrees later, and the unanimated fingertips jumped
 * 0.20 to 0.25 m per frame while the hand itself barely moved. On screen the
 * hands, head and feet spin in place.
 *
 * The fixture is that real worker output, every 4th frame
 * (tests/fixtures/text2motion-wave-clip.json).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	libraryReadyClip,
	continuousBoneTwist,
	forwardKinematicsFrame,
	rebaseToCanonicalRest,
	HUMANML3D_REST_DIRECTION,
} from '../api/_lib/motion-seed.js';
import {
	CANONICAL_PARENT,
	CANONICAL_REST,
	CANONICAL_REST_POSITION,
	CANONICAL_REST_WORLD,
} from '../src/animation-canonical-rest.js';

const RAW = JSON.parse(readFileSync(new URL('./fixtures/text2motion-wave-clip.json', import.meta.url), 'utf8'));
const SAMPLES = RAW.tracks[0].times.length;

function mul(a, b) {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

function angleDeg(a, b) {
	const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
	return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
}

function order() {
	const out = [];
	const seen = new Set();
	const visit = (b) => {
		if (seen.has(b)) return;
		if (CANONICAL_PARENT[b]) visit(CANONICAL_PARENT[b]);
		seen.add(b);
		out.push(b);
	};
	Object.keys(CANONICAL_PARENT).forEach(visit);
	return out;
}

/** World orientation of every canonical bone at sample i of a library-basis clip. */
function worldQuats(clip, i) {
	const tracks = new Map(clip.tracks.map((t) => [t.name, t]));
	const world = {};
	for (const bone of order()) {
		const t = tracks.get(`${bone}.quaternion`);
		const local = t ? Array.from(t.values.slice(i * 4, i * 4 + 4)) : CANONICAL_REST[bone] ?? [0, 0, 0, 1];
		const parent = CANONICAL_PARENT[bone];
		world[bone] = parent ? mul(world[parent] ?? [0, 0, 0, 1], local) : local;
	}
	return world;
}

function conj(q) {
	return [-q[0], -q[1], -q[2], q[3]];
}

function rotate(q, v) {
	const p = mul(mul(q, [v[0], v[1], v[2], 0]), conj(q));
	return [p[0], p[1], p[2]];
}

// Every bone the source animates that has exactly one animated child: the
// bones whose twist the worker leaves free. The child's rest offset, in the
// bone's own frame, is the axis that twist turns about.
const SOURCE = new Set(['Hips', ...Object.keys(HUMANML3D_REST_DIRECTION)]);
const TWIST_AXIS = (() => {
	const out = {};
	for (const bone of SOURCE) {
		const kids = [...SOURCE].filter((b) => CANONICAL_PARENT[b] === bone);
		if (kids.length !== 1) continue;
		const here = CANONICAL_REST_POSITION[bone];
		const offset = CANONICAL_REST_POSITION[kids[0]].map((v, k) => v - here[k]);
		const local = rotate(conj(CANONICAL_REST_WORLD[bone]), offset);
		const len = Math.hypot(...local);
		out[bone] = local.map((v) => v / len);
	}
	return out;
})();

/** Twist, in degrees, of `delta` about unit `axis` (swing removed). */
function twistDeg(delta, axis) {
	const p = Math.abs(delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2]);
	return (2 * Math.atan2(p, Math.abs(delta[3])) * 180) / Math.PI;
}

/** Local rotation of `bone` at sample i, or its rest when the clip has no track. */
function localQuat(clip, bone, i) {
	const t = clip.tracks.find((x) => x.name === `${bone}.quaternion`);
	return t ? Array.from(t.values.slice(i * 4, i * 4 + 4)) : CANONICAL_REST[bone] ?? [0, 0, 0, 1];
}

/**
 * Largest frame-to-frame roll of each bone about its own axis, relative to its
 * parent. Measured locally so a parent's real motion (an upper arm swinging the
 * forearm around) is not counted against the forearm.
 */
function worstTwistSteps(clip) {
	const out = {};
	for (const [bone, axis] of Object.entries(TWIST_AXIS)) {
		for (let i = 1; i < SAMPLES; i += 1) {
			const delta = mul(conj(localQuat(clip, bone, i - 1)), localQuat(clip, bone, i));
			out[bone] = Math.max(out[bone] ?? 0, twistDeg(delta, axis));
		}
	}
	return out;
}

// The fixture keeps every 4th frame of a 30 fps take, so one step is 0.133 s.
// A forearm rolls a few tens of degrees in that time at most; a flip is a half
// turn. Swing (the bone changing direction) is real motion and is not counted.
const MAX_TWIST_STEP_DEG = 45;

describe('generated motion twist continuity', () => {
	it('the raw worker output really does flip (guards the fixture)', () => {
		const steps = worstTwistSteps(rebaseToCanonicalRest(RAW).clip);
		expect(Math.max(...Object.values(steps))).toBeGreaterThan(150);
	});

	it('no bone rolls about its own axis more than a natural amount between frames', () => {
		const steps = worstTwistSteps(libraryReadyClip(RAW));
		const bad = Object.entries(steps).filter(([, deg]) => deg > MAX_TWIST_STEP_DEG);
		expect(bad, JSON.stringify(steps)).toEqual([]);
	});

	// Only the source joints: the fingers and the head top are not part of the
	// worker's skeleton and are meant to follow the corrected twist.
	it('only twists: every joint position the worker produced is unchanged', () => {
		const before = rebaseToCanonicalRest(RAW).clip;
		const after = rebaseToCanonicalRest(continuousBoneTwist(RAW).clip).clip;
		let worst = 0;
		for (let i = 0; i < SAMPLES; i += 1) {
			const a = forwardKinematicsFrame(before, i);
			const b = forwardKinematicsFrame(after, i);
			for (const bone of SOURCE) {
				worst = Math.max(worst, Math.hypot(a[bone][0] - b[bone][0], a[bone][1] - b[bone][1], a[bone][2] - b[bone][2]));
			}
		}
		expect(worst).toBeLessThan(1e-6);
	});

	it('starts from the least twist away from rest', () => {
		const { clip } = continuousBoneTwist(RAW);
		const forearm = clip.tracks.find((t) => t.name === 'RightForeArm.quaternion').values;
		const original = RAW.tracks.find((t) => t.name === 'RightForeArm.quaternion').values;
		const q = Array.from(forearm.slice(0, 4));
		expect(angleDeg(q, [0, 0, 0, 1])).toBeLessThanOrEqual(angleDeg(Array.from(original.slice(0, 4)), [0, 0, 0, 1]) + 1e-9);
	});

	it('leaves a clip already in the library basis alone', () => {
		const ready = libraryReadyClip(RAW);
		const parsed = { ...ready, userData: JSON.parse(ready.userData) };
		expect(continuousBoneTwist(parsed).adjusted).toBe(0);
	});
});

/**
 * The Eidon IMU converter (scripts/eidon-imu-clip.mjs) measures every harness
 * mounting parameter from the recording itself. These tests drive it with a
 * synthetic wearer whose arm motion is known exactly: a body in a z-up world,
 * seven sensors strapped on at mountings that sit a realistic 10-20 degrees
 * off the population prior, doing a scripted routine (hang still, flex the
 * elbow with the forearm level and palm down, reach forward, hang again). The
 * converter must recover the elbow angle, the shoulder flexion, the wearer's
 * forward direction and the chest lean on the canonical rig, and it must do so
 * from the sensor streams alone, because no such truth exists for the real
 * recordings.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import {
	alignFrames,
	bakeClip,
	calibrate,
	deserializeFrames,
	HARNESS_PRIOR,
	liveliestWindow,
	SAMPLE_HZ,
	serializeFrames,
	SLOT,
} from '../scripts/eidon-imu-clip.mjs';
import { CANONICAL_REST_POSITION, CANONICAL_REST_WORLD } from '../src/animation-canonical-rest.js';

const idle = JSON.parse(readFileSync(new URL('../public/animations/clips/idle.json', import.meta.url), 'utf8'));
const DEG = 180 / Math.PI;

const v = (x, y, z) => new Vector3(x, y, z);
const columns = (a, b, c) => new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(a, b, c));
const axisAngle = (axis, deg) => new Quaternion().setFromAxisAngle(axis.clone().normalize(), deg / DEG);
const perp = (vec, axis) => vec.clone().addScaledVector(axis, -vec.dot(axis)).normalize();
const angle = (a, b) => a.angleTo(b) * DEG;

/**
 * A sensor's frame relative to its segment: the segment's distal and
 * secondary axes expressed in sensor coordinates, taken from the harness prior
 * and rotated by `tiltDeg` about a fixed axis so the estimators cannot simply
 * echo the prior back.
 */
function mounting(distalPrior, secondaryPrior, tiltDeg) {
	const tilt = axisAngle(v(1, 2, 3), tiltDeg);
	const distal = v(...distalPrior).normalize().applyQuaternion(tilt);
	const secondary = perp(v(...secondaryPrior).applyQuaternion(tilt), distal);
	// Columns [distal, secondary, distal × secondary] map segment coordinates to
	// sensor coordinates; the sensor's orientation is the segment's times the inverse.
	return columns(distal, secondary, new Vector3().crossVectors(distal, secondary)).invert();
}

/** Scripted routine: returns shoulder flexion, elbow flexion and wrist wobble (degrees) at time t. */
function routine(t) {
	if (t < 6) return { shoulder: 0, elbow: 0, wrist: 0 };
	if (t < 20) return { shoulder: 10 - 10 * Math.cos((t - 6) * 0.9), elbow: 50 - 50 * Math.cos((t - 6) * 1.3), wrist: 8 * Math.sin(t * 2.1) };
	if (t < 30) return { shoulder: 60, elbow: 90 + 12 * Math.sin((t - 20) * 1.7), wrist: 8 * Math.sin(t * 2.1) };
	return { shoulder: 0, elbow: 0, wrist: 0 };
}

/**
 * Simulate the seven sensor streams for `seconds` of the routine.
 * World: z up, the wearer faces +x, +y is the wearer's left.
 */
function simulate(seconds = 40) {
	const up = v(0, 0, 1);
	const rows = [];
	const mounts = {
		[SLOT.chest]: axisAngle(v(0.3, 1, 0.2), 140),
		[SLOT.leftArm]: mounting(HARNESS_PRIOR.distal[SLOT.leftArm], HARNESS_PRIOR.anterior[SLOT.leftArm], 12),
		[SLOT.rightArm]: mounting(HARNESS_PRIOR.distal[SLOT.rightArm], HARNESS_PRIOR.anterior[SLOT.rightArm], -15),
		[SLOT.leftForeArm]: mounting(HARNESS_PRIOR.distal[SLOT.leftForeArm], HARNESS_PRIOR.dorsal[SLOT.leftForeArm], 18),
		[SLOT.rightForeArm]: mounting(HARNESS_PRIOR.distal[SLOT.rightForeArm], HARNESS_PRIOR.dorsal[SLOT.rightForeArm], -9),
		[SLOT.leftHand]: axisAngle(v(1, -0.5, 0.7), 75),
		[SLOT.rightHand]: axisAngle(v(-0.4, 0.9, 0.3), -50),
	};
	const truth = [];
	const frames = Math.round(seconds * SAMPLE_HZ);
	for (let i = 0; i < frames; i++) {
		const t = i / SAMPLE_HZ;
		const timeMs = Math.round(t * 1000) + 42;
		const { shoulder, elbow, wrist } = routine(t);
		// Body: a constant heading plus a lean about the left axis and a small yaw wobble.
		const lean = 6 * Math.sin(t * 0.5);
		const body = axisAngle(up, 35 + 4 * Math.sin(t * 0.3)).multiply(axisAngle(v(0, 1, 0), lean));
		const forward = v(1, 0, 0).applyQuaternion(body);
		const left = v(0, 1, 0).applyQuaternion(body);
		const bodyUp = v(0, 0, 1).applyQuaternion(body);
		const push = (slot, segmentWorld) => {
			const q = segmentWorld.clone().multiply(mounts[slot]);
			rows.push({ recording_id: 1, time_ms: timeMs, slot, quat_x: q.x, quat_y: q.y, quat_z: q.z, quat_w: q.w });
		};
		push(SLOT.chest, body);
		const perSide = {};
		for (const side of ['left', 'right']) {
			// Upper arm hangs (distal = -up, anterior = forward) and flexes forward at the shoulder.
			const flex = axisAngle(left, -shoulder);
			const armDistal = bodyUp.clone().negate().applyQuaternion(flex);
			const armAnterior = forward.clone().applyQuaternion(flex);
			const armThird = new Vector3().crossVectors(armDistal, armAnterior);
			// Forearm flexes toward the anterior side; its dorsal side faces up when level (palm down).
			const rad = elbow / DEG;
			const foreDistal = armDistal.clone().multiplyScalar(Math.cos(rad)).addScaledVector(armAnterior, Math.sin(rad));
			const foreDorsal = armDistal.clone().multiplyScalar(-Math.sin(rad)).addScaledVector(armAnterior, Math.cos(rad));
			const foreThird = new Vector3().crossVectors(foreDistal, foreDorsal);
			const foreWorld = columns(foreDistal, foreDorsal, foreThird);
			const handWorld = axisAngle(foreThird, wrist).multiply(foreWorld);
			const slots = side === 'left'
				? { arm: SLOT.leftArm, foreArm: SLOT.leftForeArm, hand: SLOT.leftHand }
				: { arm: SLOT.rightArm, foreArm: SLOT.rightForeArm, hand: SLOT.rightHand };
			push(slots.arm, columns(armDistal, armAnterior, armThird));
			push(slots.foreArm, foreWorld);
			push(slots.hand, handWorld);
			perSide[side] = { armDistal, foreDistal };
		}
		truth.push({ t, shoulder, elbow, wrist, lean, forward, left, bodyUp, ...perSide });
	}
	return { rows, truth };
}

/** World rotation of every bone in a clip frame, composed from the clip's own local tracks. */
function worldRotations(clip, frame) {
	const parents = {
		Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1',
		LeftShoulder: 'Spine2', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
		RightShoulder: 'Spine2', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
	};
	const local = (bone) => {
		const track = clip.tracks.find((tr) => tr.name === `${bone}.quaternion`);
		return new Quaternion().fromArray(track.values, frame * 4).normalize();
	};
	const world = { Hips: local('Hips') };
	for (const bone of Object.keys(parents)) world[bone] = world[parents[bone]].clone().multiply(local(bone));
	return world;
}

/** A bone's distal direction on the canonical rig, in model space, for a clip frame. */
function boneDirection(world, bone, child) {
	const restDistal = v(...CANONICAL_REST_POSITION[child]).sub(v(...CANONICAL_REST_POSITION[bone])).normalize();
	const restLocal = restDistal.applyQuaternion(new Quaternion().fromArray(CANONICAL_REST_WORLD[bone]).invert());
	return restLocal.applyQuaternion(world[bone]);
}

describe('eidon imu clip: calibration from a synthetic wearer', () => {
	const { rows, truth } = simulate();
	const frames = alignFrames(rows);
	const cal = calibrate(frames);

	it('aligns the long-form rows into complete seven-slot frames', () => {
		expect(frames.times.length).toBe(truth.length);
		expect(frames.quats).toHaveLength(7);
		expect(frames.times[1] - frames.times[0]).toBeCloseTo(1 / SAMPLE_HZ, 3);
	});

	it('finds the wearer\'s up, forward and left in the chest sensor frame', () => {
		const chestInv = cal.chestMean.clone().invert();
		const meanForward = truth.reduce((acc, f) => acc.add(f.forward), new Vector3()).normalize().applyQuaternion(chestInv);
		const meanLeft = truth.reduce((acc, f) => acc.add(f.left), new Vector3()).normalize().applyQuaternion(chestInv);
		expect(angle(cal.up, v(0, 0, 1).applyQuaternion(chestInv))).toBeLessThan(3);
		expect(angle(cal.forward, meanForward)).toBeLessThan(6);
		expect(angle(cal.left, meanLeft)).toBeLessThan(6);
	});

	it('measures every arm axis from the data instead of echoing the prior', () => {
		for (const side of ['left', 'right']) {
			const q = cal.sides[side].quality;
			expect(q.hangingSeconds).toBeGreaterThan(3);
			expect(q.anteriorFromPrior).not.toBeNull();
			expect(q.dorsalFromPrior).not.toBeNull();
			for (const value of Object.values(q.distalFromPrior)) expect(value).not.toBeNull();
			// The mountings were tilted 9-18 degrees off the prior, and the estimate should follow the tilt, not the prior.
			expect(q.anteriorFromPrior).toBeGreaterThan(4);
		}
	});

	it('survives a recording that never hangs or flexes by falling back to the prior', () => {
		const still = { ...frames, times: frames.times.slice(0, 60), quats: frames.quats.map((s) => s.slice(0, 60)) };
		const calStill = calibrate(still);
		expect(calStill.sides.left.quality.anteriorFromPrior).toBeNull();
		expect(angle(calStill.sides.left.anterior, perp(v(...HARNESS_PRIOR.anterior[SLOT.leftArm]), calStill.sides.left.distal[SLOT.leftArm]))).toBeLessThan(1e-6);
	});
});

describe('eidon imu clip: baked motion on the canonical rig', () => {
	const { rows, truth } = simulate();
	const frames = alignFrames(rows);
	const cal = calibrate(frames);
	const clip = bakeClip(frames, cal, { name: 'synthetic', idle, start: 2, end: 36, loop: false });
	const fps = 30;
	const truthAt = (clipTime) => truth[Math.round((2 + clipTime) * SAMPLE_HZ)];

	it('has every idle track, at 30 fps, over the requested window', () => {
		expect(clip.tracks.map((t) => t.name)).toEqual(idle.tracks.map((t) => t.name));
		expect(clip.duration).toBeCloseTo(34, 5);
		expect(clip.tracks[0].times[1]).toBeCloseTo(1 / fps, 6);
		expect(JSON.parse(clip.userData)).toMatchObject({ source: 'eidon-ai/tracker-pov-imu', license: 'CC-BY-4.0', recording: 1 });
	});

	it('reproduces the elbow angle within a few degrees on both arms', () => {
		let worst = 0;
		for (let frame = 0; frame < clip.tracks[0].times.length; frame += 7) {
			const world = worldRotations(clip, frame);
			const expected = truthAt(clip.tracks[0].times[frame]).elbow;
			for (const side of ['Left', 'Right']) {
				const arm = boneDirection(world, `${side}Arm`, `${side}ForeArm`);
				const fore = boneDirection(world, `${side}ForeArm`, `${side}Hand`);
				worst = Math.max(worst, Math.abs(angle(arm, fore) - expected));
			}
		}
		expect(worst).toBeLessThan(4);
	});

	it('hangs the arms straight down and raises them forward when the wearer reaches', () => {
		const at = (clipTime) => worldRotations(clip, Math.round(clipTime * fps));
		const hanging = at(1);
		expect(angle(boneDirection(hanging, 'LeftArm', 'LeftForeArm'), v(0, -1, 0))).toBeLessThan(4);
		expect(angle(boneDirection(hanging, 'RightArm', 'RightForeArm'), v(0, -1, 0))).toBeLessThan(4);
		// t = 23 s in the routine (21 s into the clip): shoulder 60 degrees forward, elbow about 90.
		const reaching = at(21);
		const expectedArm = v(0, -Math.cos(60 / DEG), Math.sin(60 / DEG));
		expect(angle(boneDirection(reaching, 'LeftArm', 'LeftForeArm'), expectedArm)).toBeLessThan(5);
		expect(angle(boneDirection(reaching, 'RightArm', 'RightForeArm'), expectedArm)).toBeLessThan(5);
		// The flexed forearm points up and forward (elbow flexes toward the anterior side), never backward.
		const fore = boneDirection(reaching, 'LeftForeArm', 'LeftHand');
		expect(fore.z).toBeGreaterThan(0.3);
		expect(fore.y).toBeGreaterThan(0.3);
	});

	it('keeps the level forearm palm-down: its dorsal side faces up', () => {
		// t = 14.8 s: elbow near 100 degrees with the upper arm hanging, so the forearm is roughly level.
		const frame = Math.round((14.8 - 2) * fps);
		const world = worldRotations(clip, frame);
		const restDorsal = v(0, 1, 0).applyQuaternion(new Quaternion().fromArray(CANONICAL_REST_WORLD.LeftForeArm).invert());
		const dorsal = restDorsal.applyQuaternion(world.LeftForeArm);
		expect(dorsal.y).toBeGreaterThan(0.85);
	});

	it('leans the torso with the chest sensor and leaves the legs on the idle clip', () => {
		const spine2 = (clipTime) => worldRotations(clip, Math.round(clipTime * fps)).Spine2;
		const idleSpine2 = (clipTime) => {
			const idleClip = { ...idle, tracks: idle.tracks };
			const frame = Math.round(clipTime * fps) % idle.tracks[0].times.length;
			return worldRotations(idleClip, frame).Spine2;
		};
		// The lean is 6 degrees at its peak around t = 3.14 s (1.14 s into the clip) and reverses at t = 9.4 s.
		const forwardLean = spine2(1.14).angleTo(idleSpine2(1.14)) * DEG;
		const backLean = spine2(7.4).angleTo(idleSpine2(7.4)) * DEG;
		expect(forwardLean).toBeGreaterThan(3);
		expect(backLean).toBeGreaterThan(3);
		const legs = clip.tracks.find((t) => t.name === 'LeftUpLeg.quaternion');
		const idleLegs = idle.tracks.find((t) => t.name === 'LeftUpLeg.quaternion');
		expect(legs.values.slice(0, 4)).toEqual(idleLegs.values.slice(0, 4).map((n) => Number(n.toPrecision(7))));
	});

	it('closes a looping clip so the last frame returns to the first', () => {
		const loop = bakeClip(frames, cal, { name: 'loop', idle, start: 8, end: 18, loop: true, loopBlend: 0.6 });
		for (const bone of ['LeftArm', 'LeftForeArm', 'RightForeArm', 'Spine2']) {
			const track = loop.tracks.find((t) => t.name === `${bone}.quaternion`);
			const first = new Quaternion().fromArray(track.values, 0);
			const last = new Quaternion().fromArray(track.values, (track.times.length - 1) * 4);
			expect(first.angleTo(last) * DEG).toBeLessThan(3);
		}
	});

	it('is deterministic and round-trips through the frame cache format', () => {
		const again = bakeClip(deserializeFrames(serializeFrames(frames)), calibrate(deserializeFrames(serializeFrames(frames))), { name: 'synthetic', idle, start: 2, end: 36, loop: false });
		expect(again).toEqual(clip);
	});

	it('picks the liveliest window after the loop margin', () => {
		const window = liveliestWindow(frames, 10, { margin: 1 });
		expect(window.start).toBeGreaterThanOrEqual(1);
		expect(window.start).toBeGreaterThan(5);
		expect(window.end - window.start).toBeCloseTo(10, 5);
	});
});

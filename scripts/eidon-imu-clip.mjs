/**
 * Eidon Tracker POV IMU → canonical-skeleton AnimationClip.
 *
 * The Eidon AI release (huggingface.co/datasets/eidon-ai/tracker-pov-imu,
 * CC-BY-4.0) is 1,274 hours of people doing household chores wearing a
 * seven-sensor IMU harness: both hands, both forearms, both upper arms and the
 * chest, each streaming an orientation quaternion at 24 Hz. This module turns
 * one recording into a clip on the same canonical skeleton the rest of the
 * library uses (`public/animations/clips/*.json`), so a real person's arms
 * folding laundry or scrubbing a pan retarget onto any rigged avatar exactly
 * like a Mixamo preset does.
 *
 * Nothing about the harness geometry is documented beyond the slot list, so
 * every mounting parameter is measured from the recording itself. The
 * estimators and the facts they rest on (all verified against the data, see
 * docs/animations.md "Real chores from the Eidon IMU dataset"):
 *
 *   • Each quaternion rotates sensor coordinates into a shared z-up world frame
 *     (the world up vector is constant in every sensor's own frame; it is not
 *     when the inverse convention is assumed).
 *   • An arm segment's long axis in its sensor's frame is the direction gravity
 *     points while that arm hangs straight and still. Arms hang between tasks
 *     often enough that nearly every recording has a second or more of it.
 *   • The elbow only flexes forward, so the direction the forearm swings toward
 *     in the upper-arm sensor's frame is the upper arm's anterior side. That
 *     pins the upper arm's roll with no sign ambiguity.
 *   • People work palm-down, so the side of the forearm that faces up while
 *     the forearm is horizontal is its dorsal side. That pins the forearm's
 *     roll (average pronation becomes the rest pronation).
 *   • The forearms point away from the body while working, so their average
 *     horizontal direction in the chest sensor's frame is the wearer's
 *     forward. The chest unit's yaw on the strap
 *     varies between sessions, so forward cannot be a constant.
 *   • The wrist is expressed relative to its own average pose, because the
 *     hand unit sits on a glove and its mounting is the least consistent.
 *
 * Every estimate falls back to a population prior (`HARNESS_PRIOR`, measured
 * across 60 recordings from 5 contributors) when the recording does not
 * contain the motion the estimator needs, and the calibration reports which
 * fell back and how far each estimate sits from the prior, so the build can
 * rank recordings by how trustworthy their conversion is.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import {
	CANONICAL_REST,
	CANONICAL_REST_POSITION,
	CANONICAL_REST_WORLD,
} from '../src/animation-canonical-rest.js';
import { compactClipJson } from './compact-clips.mjs';

export const SAMPLE_HZ = 24;

/** Body slot ids as the dataset numbers them. */
export const SLOT = Object.freeze({
	leftHand: 0,
	leftForeArm: 1,
	leftArm: 2,
	rightHand: 3,
	rightForeArm: 4,
	rightArm: 5,
	chest: 6,
});
export const SLOT_COUNT = 7;

/** Sensor axes in each sensor's own frame, averaged over 60 recordings. */
export const HARNESS_PRIOR = Object.freeze({
	distal: {
		[SLOT.leftArm]: [-0.11, 0.9, -0.42],
		[SLOT.rightArm]: [0.15, 0.89, -0.43],
		[SLOT.leftForeArm]: [-0.3, 0.88, -0.38],
		[SLOT.rightForeArm]: [0.29, 0.84, -0.45],
	},
	anterior: {
		[SLOT.leftArm]: [0.87, 0, 0.49],
		[SLOT.rightArm]: [-0.93, 0, 0.38],
	},
	dorsal: {
		[SLOT.leftForeArm]: [0.67, 0, 0.74],
		[SLOT.rightForeArm]: [-0.59, 0, 0.81],
	},
});

const SIDES = [
	{ key: 'left', arm: SLOT.leftArm, foreArm: SLOT.leftForeArm, hand: SLOT.leftHand, bones: ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'] },
	{ key: 'right', arm: SLOT.rightArm, foreArm: SLOT.rightForeArm, hand: SLOT.rightHand, bones: ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'] },
];

const WORLD_UP = new Vector3(0, 0, 1);
const CHAR_UP = new Vector3(0, 1, 0);
const CHAR_FORWARD = new Vector3(0, 0, 1);

/** How the chest's measured lean is distributed along the spine chain. */
const SPINE_SHARE = { Spine: 0.3, Spine1: 0.6, Spine2: 1 };

const DRIVEN_BONES = new Set([
	'Spine', 'Spine1', 'Spine2',
	'LeftArm', 'LeftForeArm', 'LeftHand',
	'RightArm', 'RightForeArm', 'RightHand',
]);

const STRAIGHT_ELBOW_DEG = 20;
const FLEXED_ELBOW_DEG = 25;
const STILL_RATE_DEG_PER_S = 40;
const MIN_ESTIMATE_FRAMES = SAMPLE_HZ;
const HORIZONTAL_COS = 0.5;
const PRIOR_DISAGREEMENT_DEG = 60;
const YAW_WINDOW_S = 5;

const DEG = 180 / Math.PI;

const v3 = (a) => new Vector3(a[0], a[1], a[2]);
const q4 = (a) => new Quaternion(a[0], a[1], a[2], a[3]);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Sign-aligned mean of unit quaternions, fine for the clustered rotations here. */
function meanQuaternion(quats) {
	const ref = quats[0];
	const acc = [0, 0, 0, 0];
	for (const q of quats) {
		const s = q.dot(ref) < 0 ? -1 : 1;
		acc[0] += s * q.x; acc[1] += s * q.y; acc[2] += s * q.z; acc[3] += s * q.w;
	}
	return new Quaternion(acc[0], acc[1], acc[2], acc[3]).normalize();
}

function meanVector(vectors) {
	const acc = new Vector3();
	for (const v of vectors) acc.add(v);
	return vectors.length ? acc.divideScalar(vectors.length) : acc;
}

/** Component of `v` perpendicular to unit `axis`, normalized. */
function perpendicular(v, axis) {
	return v.clone().addScaledVector(axis, -v.dot(axis)).normalize();
}

/** Angle in degrees between two vectors. */
function angleDeg(a, b) {
	return Math.acos(clamp(a.dot(b) / (a.length() * b.length() || 1), -1, 1)) * DEG;
}

/** Quaternion whose rotation maps sensor coordinates onto the (left, up, forward) basis. */
function basisQuaternion(xAxis, yAxis, zAxis) {
	// Rows of the rotation matrix are the target axes; Matrix4.makeBasis sets
	// columns, so build the transpose and invert.
	const m = new Matrix4().makeBasis(xAxis, yAxis, zAxis);
	return new Quaternion().setFromRotationMatrix(m).invert();
}

/** Quaternion of the matrix with the given column vectors. */
function columnsQuaternion(xAxis, yAxis, zAxis) {
	return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zAxis));
}

/** Frame with columns [distal, secondary, distal × secondary]. */
function segmentFrame(distal, secondary) {
	const d = distal.clone().normalize();
	const s = perpendicular(secondary, d);
	return columnsQuaternion(d, s, new Vector3().crossVectors(d, s));
}

/**
 * Align the long-form rows of one recording into per-timestamp frames.
 * Timestamps that lack any of the seven slots are dropped.
 *
 * @param {Array<{recording_id?:number,time_ms:number,slot:number,quat_x:number,quat_y:number,quat_z:number,quat_w:number}>} rows
 * @returns {{ recording: number|null, times: number[], quats: Quaternion[][] }} times in seconds; quats[slot][frame]
 */
export function alignFrames(rows) {
	const byTime = new Map();
	let recording = null;
	for (const r of rows) {
		if (recording == null && r.recording_id != null) recording = Number(r.recording_id);
		const t = Number(r.time_ms);
		let entry = byTime.get(t);
		if (!entry) { entry = new Array(SLOT_COUNT).fill(null); byTime.set(t, entry); }
		entry[Number(r.slot)] = new Quaternion(Number(r.quat_x), Number(r.quat_y), Number(r.quat_z), Number(r.quat_w)).normalize();
	}
	const times = [];
	const quats = Array.from({ length: SLOT_COUNT }, () => []);
	for (const t of [...byTime.keys()].sort((a, b) => a - b)) {
		const entry = byTime.get(t);
		if (entry.some((q) => q === null)) continue;
		times.push(t / 1000);
		for (let s = 0; s < SLOT_COUNT; s++) quats[s].push(entry[s]);
	}
	return { recording, times, quats };
}

/** Serialize aligned frames for the on-disk cache (`animation-sources/eidon/<id>.json`). */
export function serializeFrames(frames) {
	return {
		recording: frames.recording,
		hz: SAMPLE_HZ,
		times: frames.times,
		quats: frames.quats.map((slot) => slot.flatMap((q) => [q.x, q.y, q.z, q.w])),
	};
}

export function deserializeFrames(data) {
	return {
		recording: data.recording,
		times: data.times,
		quats: data.quats.map((flat) => {
			const out = [];
			for (let i = 0; i < flat.length; i += 4) out.push(new Quaternion(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]));
			return out;
		}),
	};
}

/** World-frame vector `v` expressed in the sensor's own frame. */
function inSensorFrame(q, v) {
	return v.clone().applyQuaternion(q.clone().invert());
}

/** Degrees per second of rotation between consecutive frames. */
function rotationRates(quats, times) {
	const rates = new Array(quats.length).fill(0);
	for (let i = 1; i < quats.length; i++) {
		const dt = times[i] - times[i - 1] || 1 / SAMPLE_HZ;
		rates[i] = (quats[i].angleTo(quats[i - 1]) * DEG) / dt;
	}
	if (rates.length > 1) rates[0] = rates[1];
	return rates;
}

function elbowAngles(armQ, foreQ, distalArm, distalFore) {
	const out = new Array(armQ.length);
	for (let i = 0; i < armQ.length; i++) {
		const rel = armQ[i].clone().invert().multiply(foreQ[i]);
		out[i] = angleDeg(distalFore.clone().applyQuaternion(rel), distalArm);
	}
	return out;
}

function percentile(values, p) {
	if (!values.length) return NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = clamp(Math.round((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
	return sorted[idx];
}

/**
 * Estimate one arm's sensor mountings from the recording.
 * @returns {{ distal: Record<number, Vector3>, anterior: Vector3, dorsal: Vector3, quality: object }}
 */
function calibrateSide(frames, side, prior) {
	const { times, quats } = frames;
	const armQ = quats[side.arm];
	const foreQ = quats[side.foreArm];
	const n = times.length;
	const rates = rotationRates(armQ, times);
	const down = WORLD_UP.clone().negate();

	// 1. Long axes, from the frames where the arm hangs straight and still.
	//    Straightness needs the long axes, so run two passes: the prior axes
	//    find the hanging frames, the axes those frames yield refine them.
	const distal = {};
	const distalFromPrior = {};
	for (const slot of [side.arm, side.foreArm]) { distal[slot] = v3(prior.distal[slot]).normalize(); distalFromPrior[slot] = null; }
	let hanging = [];
	for (let pass = 0; pass < 2; pass++) {
		const straight = elbowAngles(armQ, foreQ, distal[side.arm], distal[side.foreArm]);
		hanging = [];
		for (let i = 0; i < n; i++) if (straight[i] < STRAIGHT_ELBOW_DEG && rates[i] < STILL_RATE_DEG_PER_S) hanging.push(i);
		if (hanging.length < MIN_ESTIMATE_FRAMES) hanging = straight.map((a, i) => (a < STRAIGHT_ELBOW_DEG ? i : -1)).filter((i) => i >= 0);
		if (hanging.length < MIN_ESTIMATE_FRAMES) break;
		for (const slot of [side.arm, side.foreArm]) {
			const priorAxis = v3(prior.distal[slot]).normalize();
			const est = meanVector(hanging.map((i) => inSensorFrame(quats[slot][i], down))).normalize();
			const disagreement = angleDeg(est, priorAxis);
			if (disagreement <= PRIOR_DISAGREEMENT_DEG) { distal[slot] = est; distalFromPrior[slot] = disagreement; }
		}
	}
	const hangingSeconds = hanging.length / SAMPLE_HZ;

	// 2. Anterior side of the upper arm: where the forearm swings when flexed.
	const elbow = elbowAngles(armQ, foreQ, distal[side.arm], distal[side.foreArm]);
	const swing = [];
	for (let i = 0; i < n; i++) {
		if (elbow[i] <= FLEXED_ELBOW_DEG) continue;
		const rel = armQ[i].clone().invert().multiply(foreQ[i]);
		swing.push(perpendicular(distal[side.foreArm].clone().applyQuaternion(rel), distal[side.arm]));
	}
	const anteriorPrior = perpendicular(v3(prior.anterior[side.arm]), distal[side.arm]);
	let anterior = anteriorPrior;
	let anteriorFromPrior = null;
	let anteriorSpread = null;
	if (swing.length >= MIN_ESTIMATE_FRAMES) {
		const est = meanVector(swing).normalize();
		anteriorSpread = meanVector(swing).length();
		const disagreement = angleDeg(est, anteriorPrior);
		if (disagreement <= PRIOR_DISAGREEMENT_DEG) { anterior = perpendicular(est, distal[side.arm]); anteriorFromPrior = disagreement; }
	}

	// 3. Dorsal side of the forearm: what faces up while the forearm is level.
	const level = [];
	for (let i = 0; i < n; i++) {
		const worldDistal = distal[side.foreArm].clone().applyQuaternion(foreQ[i]);
		if (Math.abs(worldDistal.dot(WORLD_UP)) < HORIZONTAL_COS) level.push(i);
	}
	const dorsalPrior = perpendicular(v3(prior.dorsal[side.foreArm]), distal[side.foreArm]);
	let dorsal = dorsalPrior;
	let dorsalFromPrior = null;
	if (level.length >= MIN_ESTIMATE_FRAMES) {
		const est = perpendicular(meanVector(level.map((i) => inSensorFrame(foreQ[i], WORLD_UP))), distal[side.foreArm]);
		const disagreement = angleDeg(est, dorsalPrior);
		if (disagreement <= PRIOR_DISAGREEMENT_DEG) { dorsal = est; dorsalFromPrior = disagreement; }
	}

	return {
		distal,
		anterior,
		dorsal,
		quality: {
			hangingSeconds,
			levelSeconds: level.length / SAMPLE_HZ,
			distalFromPrior,
			anteriorFromPrior,
			anteriorSpread,
			dorsalFromPrior,
			elbowP10: percentile(elbow, 10),
			elbowP50: percentile(elbow, 50),
			elbowP90: percentile(elbow, 90),
		},
	};
}

/**
 * Measure every mounting parameter the conversion needs from one recording.
 *
 * @param {{times:number[], quats:Quaternion[][]}} frames
 * @param {{ prior?: typeof HARNESS_PRIOR }} [opts]
 */
export function calibrate(frames, { prior = HARNESS_PRIOR } = {}) {
	const { times, quats } = frames;
	const n = times.length;
	if (n < MIN_ESTIMATE_FRAMES) throw new Error(`recording too short to calibrate: ${n} aligned frames`);
	const chestQ = quats[SLOT.chest];
	const chestMean = meanQuaternion(chestQ);
	const chestMeanInv = chestMean.clone().invert();
	const up = inSensorFrame(chestMean, WORLD_UP).normalize();

	const sides = {};
	for (const side of SIDES) sides[side.key] = calibrateSide(frames, side, prior);

	// Forward: where the forearms point, horizontally, in the mean chest frame.
	const pointing = [];
	const windows = new Map();
	for (let i = 0; i < n; i++) {
		const frameSum = new Vector3();
		for (const side of SIDES) {
			const d = sides[side.key].distal[side.foreArm];
			frameSum.add(d.clone().applyQuaternion(chestMeanInv.clone().multiply(quats[side.foreArm][i])));
		}
		pointing.push(frameSum);
		const w = Math.floor(times[i] / YAW_WINDOW_S);
		if (!windows.has(w)) windows.set(w, new Vector3());
		windows.get(w).add(frameSum);
	}
	const forward = perpendicular(meanVector(pointing), up);
	const left = new Vector3().crossVectors(up, forward).normalize();
	const yaws = [...windows.values()].map((sum) => {
		const d = perpendicular(sum, up);
		return Math.atan2(d.dot(left), d.dot(forward)) * DEG;
	});
	const yawMean = yaws.reduce((a, b) => a + b, 0) / (yaws.length || 1);
	const yawStd = Math.sqrt(yaws.reduce((a, y) => a + (y - yawMean) ** 2, 0) / (yaws.length || 1));

	// Wrist: the hand relative to its own average pose in the forearm sensor frame.
	const wristMean = {};
	for (const side of SIDES) {
		const rel = [];
		for (let i = 0; i < n; i++) rel.push(quats[side.foreArm][i].clone().invert().multiply(quats[side.hand][i]));
		wristMean[side.key] = meanQuaternion(rel);
	}

	return {
		recording: frames.recording ?? null,
		frames: n,
		seconds: times[n - 1] - times[0],
		chestMean,
		up,
		forward,
		left,
		toCharacter: basisQuaternion(left, up, forward),
		sides,
		wristMean,
		quality: { yawStd, chestTiltDeg: angleDeg(up, new Vector3(0, Math.sign(up.y) || 1, 0)) },
	};
}

/** Rest-pose geometry of one arm on the canonical rig, from the bind data. */
function restArm(side) {
	const [shoulder, arm, foreArm, hand] = side.bones;
	const pArm = v3(CANONICAL_REST_POSITION[arm]);
	const pFore = v3(CANONICAL_REST_POSITION[foreArm]);
	const pHand = v3(CANONICAL_REST_POSITION[hand]);
	const armDistal = pFore.clone().sub(pArm).normalize();
	const foreDistal = pHand.clone().sub(pFore).normalize();
	return {
		shoulder,
		arm,
		foreArm,
		hand,
		armWorld: q4(CANONICAL_REST_WORLD[arm]),
		foreWorld: q4(CANONICAL_REST_WORLD[foreArm]),
		handLocal: q4(CANONICAL_REST[hand]),
		armFrame: segmentFrame(armDistal, CHAR_FORWARD),
		foreFrame: segmentFrame(foreDistal, CHAR_UP),
		armLength: pFore.distanceTo(pArm),
		foreLength: pHand.distanceTo(pFore),
		armDistalLocal: armDistal.clone().applyQuaternion(q4(CANONICAL_REST_WORLD[arm]).invert()),
		foreDistalLocal: foreDistal.clone().applyQuaternion(q4(CANONICAL_REST_WORLD[foreArm]).invert()),
		shoulderPosition: pArm,
	};
}

/**
 * Per-frame world (model-space) rotations of the driven bones, plus the
 * chest deviation, for one sample index. Everything is relative to the
 * recording's mean chest pose, which stands in for "upright".
 */
function poseAt(frames, cal, i) {
	const { quats } = frames;
	const C = cal.toCharacter;
	const chestInv = cal.chestMean.clone().invert();
	const chest = C.clone().multiply(chestInv.clone().multiply(quats[SLOT.chest][i])).multiply(C.clone().invert());
	const arms = {};
	for (const side of SIDES) {
		const s = cal.sides[side.key];
		const rest = restArm(side);
		const armK = segmentFrame(s.distal[side.arm], s.anterior).multiply(rest.armFrame.clone().invert()).multiply(rest.armWorld);
		const foreK = segmentFrame(s.distal[side.foreArm], s.dorsal).multiply(rest.foreFrame.clone().invert()).multiply(rest.foreWorld);
		const armWorld = C.clone().multiply(chestInv.clone().multiply(quats[side.arm][i])).multiply(armK);
		const foreSensorToChar = C.clone().multiply(chestInv.clone().multiply(quats[side.foreArm][i]));
		const foreWorld = foreSensorToChar.clone().multiply(foreK);
		const wrist = quats[side.foreArm][i].clone().invert().multiply(quats[side.hand][i]).multiply(cal.wristMean[side.key].clone().invert());
		const wristWorld = foreSensorToChar.clone().multiply(wrist).multiply(foreSensorToChar.clone().invert());
		const handWorld = wristWorld.multiply(foreWorld.clone().multiply(rest.handLocal));
		arms[side.key] = { armWorld, foreWorld, handWorld, rest };
	}
	return { chest, arms };
}

/**
 * Biomechanical sanity of the converted motion: hands in front of the body,
 * below the head, elbows never hyperextended. Used to rank recordings.
 */
export function assessPose(frames, cal, { step = 4 } = {}) {
	let total = 0;
	let inFront = 0;
	let belowHead = 0;
	let elbowOk = 0;
	const headY = CANONICAL_REST_POSITION.Head[1];
	for (let i = 0; i < frames.times.length; i += step) {
		const pose = poseAt(frames, cal, i);
		for (const side of SIDES) {
			const a = pose.arms[side.key];
			const elbowPos = a.rest.shoulderPosition.clone().addScaledVector(a.rest.armDistalLocal.clone().applyQuaternion(a.armWorld), a.rest.armLength);
			const handPos = elbowPos.clone().addScaledVector(a.rest.foreDistalLocal.clone().applyQuaternion(a.foreWorld), a.rest.foreLength);
			const armDir = a.rest.armDistalLocal.clone().applyQuaternion(a.armWorld);
			const foreDir = a.rest.foreDistalLocal.clone().applyQuaternion(a.foreWorld);
			total++;
			if (handPos.z > -0.08) inFront++;
			if (handPos.y < headY + 0.05) belowHead++;
			if (angleDeg(armDir, foreDir) < 160) elbowOk++;
		}
	}
	return { inFront: inFront / total, belowHead: belowHead / total, elbowOk: elbowOk / total };
}

/** 0..1 ranking of how trustworthy a recording's conversion is. */
export function qualityScore(cal, pose) {
	let score = 1;
	score *= clamp(1 - cal.quality.yawStd / 45, 0, 1);
	for (const side of SIDES) {
		const q = cal.sides[side.key].quality;
		if (q.hangingSeconds < 1) score *= 0.85;
		if (q.anteriorFromPrior == null) score *= 0.7;
		if (q.dorsalFromPrior == null) score *= 0.9;
		if (q.distalFromPrior[side.arm] == null || q.distalFromPrior[side.foreArm] == null) score *= 0.85;
	}
	score *= 0.4 + 0.6 * pose.inFront;
	score *= 0.4 + 0.6 * pose.belowHead;
	score *= 0.4 + 0.6 * pose.elbowOk;
	return score;
}

/** Mean rotation rate of the six arm sensors, degrees per second, per frame. */
export function motionEnergy(frames) {
	const rates = [];
	for (let s = 0; s < SLOT.chest; s++) rates.push(rotationRates(frames.quats[s], frames.times));
	return frames.times.map((_, i) => rates.reduce((a, r) => a + r[i], 0) / rates.length);
}

/**
 * The `seconds`-long window with the most arm motion, at least `margin`
 * seconds after the start so a looping clip has frames to blend back into.
 */
export function liveliestWindow(frames, seconds, { margin = 1 } = {}) {
	const energy = motionEnergy(frames);
	const { times } = frames;
	let best = { start: margin, end: margin + seconds, energy: -1 };
	for (let i = 0; i < times.length; i++) {
		const start = times[i];
		if (start < margin) continue;
		const end = start + seconds;
		if (end > times[times.length - 1]) break;
		let sum = 0;
		let count = 0;
		for (let j = i; j < times.length && times[j] <= end; j++) { sum += energy[j]; count++; }
		const mean = count ? sum / count : 0;
		if (mean > best.energy) best = { start, end, energy: mean };
	}
	return best;
}

/** Index of the last sample at or before `t`, clamped into range. */
function indexBefore(times, t) {
	let lo = 0;
	let hi = times.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (times[mid] <= t) lo = mid; else hi = mid - 1;
	}
	return lo;
}

/** Pose at an arbitrary time, slerped between the two nearest IMU samples. */
function poseAtTime(frames, cal, t) {
	const { times } = frames;
	const i = indexBefore(times, t);
	const j = Math.min(i + 1, times.length - 1);
	const span = times[j] - times[i];
	const w = span > 0 ? clamp((t - times[i]) / span, 0, 1) : 0;
	const a = poseAt(frames, cal, i);
	if (w === 0 || i === j) return a;
	const b = poseAt(frames, cal, j);
	const out = { chest: a.chest.clone().slerp(b.chest, w), arms: {} };
	for (const side of SIDES) {
		const x = a.arms[side.key];
		const y = b.arms[side.key];
		out.arms[side.key] = {
			armWorld: x.armWorld.clone().slerp(y.armWorld, w),
			foreWorld: x.foreWorld.clone().slerp(y.foreWorld, w),
			handWorld: x.handWorld.clone().slerp(y.handWorld, w),
			rest: x.rest,
		};
	}
	return out;
}

/** Sample a clip track (quaternion or vector) at time `t`, interpolating. */
function sampleTrack(track, t) {
	const size = track.type === 'quaternion' ? 4 : track.type === 'vector' ? 3 : 1;
	const i = indexBefore(track.times, t);
	const j = Math.min(i + 1, track.times.length - 1);
	const span = track.times[j] - track.times[i];
	const w = span > 0 ? clamp((t - track.times[i]) / span, 0, 1) : 0;
	const a = track.values.slice(i * size, i * size + size);
	if (w === 0 || i === j) return a;
	const b = track.values.slice(j * size, j * size + size);
	if (track.type === 'quaternion') return q4(a).slerp(q4(b), w).toArray();
	return a.map((v, k) => v + (b[k] - v) * w);
}

function smoothstep(x) {
	const t = clamp(x, 0, 1);
	return t * t * (3 - 2 * t);
}

/**
 * Bake a window of the recording into a clip on the canonical skeleton.
 *
 * Bones the harness does not measure (hips, legs, neck, head, fingers,
 * clavicles) play the `idle` clip, time-warped so it completes whole cycles
 * inside the window, which keeps a looping clip seamless. Looping clips also
 * blend their final `loopBlend` seconds back toward the frames just before the
 * window, so the wrap is continuous.
 *
 * @param {{times:number[], quats:Quaternion[][]}} frames
 * @param {ReturnType<typeof calibrate>} cal
 * @param {{ name:string, idle:object, start:number, end:number, fps?:number, loop?:boolean, loopBlend?:number, userData?:object }} opts
 */
export function bakeClip(frames, cal, { name, idle, start, end, fps = 30, loop = true, loopBlend = 0.6, userData = {} }) {
	const first = frames.times[0];
	const last = frames.times[frames.times.length - 1];
	if (!(end > start)) throw new Error(`window end ${end} must be after start ${start}`);
	if (start < first || end > last) throw new Error(`window ${start}-${end}s is outside the recording (${first.toFixed(2)}-${last.toFixed(2)}s)`);
	const duration = end - start;
	const blend = loop ? Math.min(loopBlend, start - first, duration / 2) : 0;
	const frameCount = Math.max(2, Math.round(duration * fps) + 1);
	const times = Array.from({ length: frameCount }, (_, k) => k / fps);
	const idleCycles = Math.max(1, Math.round(duration / idle.duration));
	const idleTime = (t) => ((t / duration) * idleCycles * idle.duration) % idle.duration;

	const idleTracks = new Map(idle.tracks.map((tr) => [tr.name, tr]));
	const idleLocal = (bone, t) => q4(sampleTrack(idleTracks.get(`${bone}.quaternion`), idleTime(t)));

	/** Driven world rotations at recording time `rt`, composed onto the idle skeleton at clip time `t`. */
	const drivenAt = (rt, t) => {
		const pose = poseAtTime(frames, cal, rt);
		const hipsWorld = idleLocal('Hips', t);
		const chain = { Hips: hipsWorld };
		let parentIdle = hipsWorld;
		for (const bone of ['Spine', 'Spine1', 'Spine2']) {
			parentIdle = parentIdle.clone().multiply(idleLocal(bone, t));
			const share = new Quaternion().slerp(pose.chest, SPINE_SHARE[bone]);
			chain[bone] = share.multiply(parentIdle);
		}
		const world = { ...chain };
		for (const side of SIDES) {
			const [shoulder, arm, foreArm, hand] = side.bones;
			const a = pose.arms[side.key];
			world[shoulder] = chain.Spine2.clone().multiply(idleLocal(shoulder, t));
			world[arm] = a.armWorld;
			world[foreArm] = a.foreWorld;
			world[hand] = a.handWorld;
		}
		const parents = { Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm' };
		const local = {};
		for (const bone of DRIVEN_BONES) local[bone] = world[parents[bone]].clone().invert().multiply(world[bone]);
		return local;
	};

	const drivenFrames = times.map((t) => {
		const raw = drivenAt(start + t, t);
		if (!blend || t < duration - blend) return raw;
		const w = smoothstep((t - (duration - blend)) / blend);
		const target = drivenAt(start + t - duration, t);
		const out = {};
		for (const bone of DRIVEN_BONES) out[bone] = raw[bone].clone().slerp(target[bone], w);
		return out;
	});

	const tracks = idle.tracks.map((track) => {
		const bone = track.name.slice(0, track.name.indexOf('.'));
		if (track.type === 'quaternion' && DRIVEN_BONES.has(bone)) {
			return { name: track.name, type: track.type, times, values: drivenFrames.flatMap((f) => f[bone].normalize().toArray()) };
		}
		return { name: track.name, type: track.type, times, values: times.flatMap((t) => sampleTrack(track, idleTime(t))) };
	});

	return compactClipJson({
		name,
		duration: times[times.length - 1],
		tracks,
		blendMode: idle.blendMode,
		userData: JSON.stringify({
			source: 'eidon-ai/tracker-pov-imu',
			license: 'CC-BY-4.0',
			recording: cal.recording,
			window: [start, end],
			loop,
			neutralPose: 'public/animations/clips/idle.json',
			...userData,
		}),
	});
}

/** Calibrate and bake in one call. */
export function buildClip(frames, opts) {
	const cal = calibrate(frames, { prior: opts.prior });
	return { clip: bakeClip(frames, cal, opts), calibration: cal };
}

/** One-line calibration report for logs and the scan table. */
export function describeCalibration(cal, pose, score) {
	const s = (side) => {
		const q = cal.sides[side].quality;
		const f = (v) => (v == null ? 'prior' : `${v.toFixed(0)}°`);
		return `hang ${q.hangingSeconds.toFixed(1)}s ant ${f(q.anteriorFromPrior)} dors ${f(q.dorsalFromPrior)} elbow ${q.elbowP10.toFixed(0)}/${q.elbowP50.toFixed(0)}/${q.elbowP90.toFixed(0)}`;
	};
	return `score ${score.toFixed(2)} yaw±${cal.quality.yawStd.toFixed(0)}° front ${(pose.inFront * 100).toFixed(0)}% | L ${s('left')} | R ${s('right')}`;
}

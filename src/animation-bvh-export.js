// AnimationClip (canonical Wolf3D skeleton, the same document shape the clip
// library and model-video2motion serve) -> Biovision BVH text.
//
// BVH carries no mesh, so unlike the GLB export (which binds onto whichever
// rig the user picked via src/animation-retarget.js) this writes the motion
// on the CANONICAL skeleton's own fixed proportions, the way Mixamo's BVH
// downloads use Mixamo's own skeleton regardless of which character you
// previewed it on. A BVH is meant to be re-retargeted in the user's own DCC
// tool (Blender's Rokoko/Auto-Rig Pro, MotionBuilder, Unreal's IK Retargeter),
// so shipping stable, correct proportions matters more than matching a
// particular preview avatar's bone lengths.
//
// Joint hierarchy and rest offsets come straight from the same generated
// constants animation-retarget.js binds clips against
// (animation-canonical-rest.js), so this file has nothing to hand-tune and
// nothing that can drift from the retarget engine.
//
// Rotation channel order is ZXY (CHANNELS 3 Zrotation Xrotation Yrotation).
// This is not arbitrary: three.js's own BVHLoader composes a joint's rotation
// per frame by building an identity quaternion and post-multiplying one
// axis-angle quaternion per channel, in the file's channel order. For a
// channel order whose axis letters match a THREE.Euler `order` string,
// `new Euler().setFromQuaternion(q, order)` yields angles that recompose to
// the exact same quaternion under that algorithm, verified numerically
// against three.js's Quaternion/Euler math, not assumed. That equivalence is
// what lets a file this module writes round-trip through BVHLoader (the same
// loader src/dashboard-next/pages/library/animations.js already uses for BVH
// import) and come back bit-for-bit equivalent, which is what
// tests/animation-bvh-export.test.js checks.

import { AnimationClip, Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { CANONICAL_PARENT, CANONICAL_REST_POSITION, CANONICAL_REST_WORLD } from './animation-canonical-rest.js';

const CHANNEL_AXES = ['Z', 'X', 'Y'];
const EULER_ORDER = 'ZXY';

// BVH has no standard unit; this platform's own GLB/meter-scale rigs are
// tiny numbers in the format most DCC BVH importers assume (centimeters), so
// values are scaled up to match that convention. Documented here once instead
// of scattered as a magic number.
const METERS_TO_BVH_UNITS = 100;

function restPosition(name) {
	const v = CANONICAL_REST_POSITION[name];
	return new Vector3(v[0], v[1], v[2]);
}

function restWorldQuat(name) {
	const q = CANONICAL_REST_WORLD[name];
	return new Quaternion(q[0], q[1], q[2], q[3]);
}

/**
 * Depth-first joint order rooted at Hips, with deterministic (alphabetical)
 * sibling order so output is byte-stable across runs.
 */
export function canonicalBoneOrder() {
	const childrenOf = new Map();
	let root = null;
	for (const [name, parent] of Object.entries(CANONICAL_PARENT)) {
		if (parent === null) {
			root = name;
			continue;
		}
		if (!childrenOf.has(parent)) childrenOf.set(parent, []);
		childrenOf.get(parent).push(name);
	}
	for (const arr of childrenOf.values()) arr.sort();

	const order = [];
	const visit = (name) => {
		order.push(name);
		for (const child of childrenOf.get(name) || []) visit(child);
	};
	visit(root);
	return { order, childrenOf, root };
}

/**
 * Local (parent-frame) rest offset for a canonical bone, in meters: the rest
 * world-space translation from parent to bone, expressed in the parent's own
 * rest orientation. This is the correct BVH OFFSET definition (a child's
 * world position is parent world position + parent world rotation * OFFSET),
 * not a plain world-space delta, which would be wrong for any parent whose
 * rest pose isn't axis-aligned (the authoring rig rests in an A-pose, so
 * shoulders and hips are not).
 */
export function canonicalLocalOffset(name, parent) {
	const pos = restPosition(name);
	if (!parent) return pos;
	const parentPos = restPosition(parent);
	const parentRot = restWorldQuat(parent);
	return pos.sub(parentPos).applyQuaternion(parentRot.clone().invert());
}

function findTrack(clip, boneName, property) {
	const suffix = `.${property}`;
	return clip.tracks.find((t) => t.name === `${boneName}${suffix}`) || null;
}

function sampleVector3(track, time, out) {
	if (!track) return out.set(0, 0, 0);
	const values = track.createInterpolant().evaluate(time);
	return out.set(values[0], values[1], values[2]);
}

function sampleQuaternion(track, time, out) {
	if (!track) return out.identity();
	const values = track.createInterpolant().evaluate(time);
	return out.set(values[0], values[1], values[2], values[3]);
}

function formatNumber(n) {
	return (Object.is(n, -0) ? 0 : n).toFixed(6);
}

/**
 * Render an AnimationClip on the canonical skeleton (as produced by
 * src/animation-retarget.js's `parseClipJSON`, straight off
 * model-video2motion or the preset clip library) as Biovision BVH text.
 *
 * @param {AnimationClip} clip
 * @param {{fps?: number}} [opts]
 * @returns {string}
 */
export function clipToBVH(clip, opts = {}) {
	const fps = Math.max(1, Math.min(120, Math.round(opts.fps || 30)));
	const { order, childrenOf, root } = canonicalBoneOrder();

	const offsets = new Map();
	for (const name of order) {
		offsets.set(name, canonicalLocalOffset(name, CANONICAL_PARENT[name]));
	}

	// Leaf joints need a synthetic End Site: reuse the joint's own
	// parent-to-self offset vector as its self-to-tip vector, a standard
	// stand-in for "continue the segment" when no real tip data exists.
	const endSite = (name) => offsets.get(name);

	let depth = 0;
	const indent = () => '\t'.repeat(depth);
	const lines = ['HIERARCHY'];

	const writeOffset = (v) =>
		`${indent()}\tOFFSET ${formatNumber(v.x * METERS_TO_BVH_UNITS)} ${formatNumber(v.y * METERS_TO_BVH_UNITS)} ${formatNumber(v.z * METERS_TO_BVH_UNITS)}`;

	const writeJoint = (name, isRoot) => {
		lines.push(`${indent()}${isRoot ? 'ROOT' : 'JOINT'} ${name}`);
		lines.push(`${indent()}{`);
		depth++;
		lines.push(writeOffset(isRoot ? new Vector3(0, 0, 0) : offsets.get(name)));
		lines.push(
			isRoot
				? `${indent()}CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation`
				: `${indent()}CHANNELS 3 Zrotation Xrotation Yrotation`,
		);
		const kids = childrenOf.get(name) || [];
		for (const child of kids) writeJoint(child, false);
		if (kids.length === 0) {
			lines.push(`${indent()}End Site`);
			lines.push(`${indent()}{`);
			depth++;
			lines.push(writeOffset(endSite(name)));
			depth--;
			lines.push(`${indent()}}`);
		}
		depth--;
		lines.push(`${indent()}}`);
	};
	writeJoint(root, true);

	const frameTime = 1 / fps;
	const frameCount = Math.max(1, Math.round(clip.duration / frameTime) + 1);

	const tracksByBone = new Map();
	for (const name of order) {
		tracksByBone.set(name, {
			quat: findTrack(clip, name, 'quaternion'),
			pos: name === root ? findTrack(clip, name, 'position') : null,
		});
	}

	const motionLines = [];
	const q = new Quaternion();
	const v = new Vector3();
	const e = new Euler();
	for (let f = 0; f < frameCount; f++) {
		const t = Math.min(clip.duration, f * frameTime);
		const cols = [];
		for (const name of order) {
			const { quat, pos } = tracksByBone.get(name);
			if (name === root) {
				sampleVector3(pos, t, v);
				cols.push(
					formatNumber(v.x * METERS_TO_BVH_UNITS),
					formatNumber(v.y * METERS_TO_BVH_UNITS),
					formatNumber(v.z * METERS_TO_BVH_UNITS),
				);
			}
			sampleQuaternion(quat, t, q);
			e.setFromQuaternion(q, EULER_ORDER);
			const deg = { X: MathUtils.radToDeg(e.x), Y: MathUtils.radToDeg(e.y), Z: MathUtils.radToDeg(e.z) };
			for (const axis of CHANNEL_AXES) cols.push(formatNumber(deg[axis]));
		}
		motionLines.push(cols.join(' '));
	}

	lines.push('MOTION');
	lines.push(`Frames: ${frameCount}`);
	lines.push(`Frame Time: ${formatNumber(frameTime)}`);
	lines.push(...motionLines);
	return lines.join('\n') + '\n';
}

/**
 * Convenience wrapper: parse a clip.json document (the exact artifact
 * model-video2motion and the clip library serve) straight to BVH text.
 *
 * @param {object} clipJSON
 * @param {{fps?: number}} [opts]
 * @returns {string}
 */
export function clipJSONToBVH(clipJSON, opts = {}) {
	return clipToBVH(AnimationClip.parse(clipJSON), opts);
}

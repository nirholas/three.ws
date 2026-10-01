// Thumbnail rest pose: put a loaded avatar into a natural standing pose before a
// still render, so a poster never shows the raw bind pose (a T-pose or A-pose
// with the arms straight out).
//
// Every renderer that turns a GLB into a picture runs this one module: the
// server's software rasterizer (api/_lib/render-cpu.js), the server's headless
// chromium failover (api/_lib/render-glb.js, which ships this file into its
// render page), and the browser's offscreen poster capture
// (src/erc8004/thumbnail.js). It adds no bone-name table of its own. Posing goes
// through AnimationManager, the same object the live viewer animates avatars
// with, so a thumbnail lands in exactly the pose the viewer's idle shows:
// canonical bone mapping (glb-canonicalize.js), rest-frame correction and hip
// scaling (animation-retarget.js), the fallen-pose guard, and the un-driven-arm
// relaxation (animation-arm-relax.js).
//
// The pose comes from the motion library's standing idle, `av-idle-male`: a
// static, symmetric, weight-centred stance with the arms relaxed at the sides
// and the head level. The looping `idle` clip was the other candidate and was
// rejected after rendering both across Mixamo, Avaturn/RPM and the clips' own
// authoring rig: every frame of it leans the torso back with the chin raised,
// which reads well in motion and badly frozen. Whatever the source, the pose is
// sampled into a constant two-key clip by sampleClipPose(), so a render page
// carries a few kilobytes and every thumbnail of one avatar is deterministic.
//
// Rigs that cannot take canonical clips (no skin, or too few humanoid bones:
// props, vehicles, creatures) are left exactly as authored, the same gate
// AnimationManager.supportsCanonicalClips() applies in the viewer.
//
// Pure module (three + the animation stack), so it runs unchanged in Node,
// in a browser and in vitest.

import { AnimationClip, Vector3 } from 'three';
import { AnimationManager } from './animation-manager.js';
import { relaxUndrivenArms } from './animation-arm-relax.js';
import { canonicalBoneNodesFromObject } from './animation-retarget.js';

/** Library clip a thumbnail pose is sampled from (public/animations/clips/). */
export const THUMBNAIL_POSE_CLIP = 'av-idle-male';

/** Seconds into THUMBNAIL_POSE_CLIP. The clip is a single held frame. */
export const THUMBNAIL_POSE_TIME = 0;

/** Where the browser fetches the source clip. */
export const THUMBNAIL_POSE_URL = `/animations/clips/${THUMBNAIL_POSE_CLIP}.json`;

/**
 * Version stamp for posters rendered with this pose. Bump it when the pose
 * changes so scripts/regenerate-avatar-thumbnails.mjs knows which stored
 * posters are stale.
 */
export const THUMBNAIL_POSE_VERSION = 'rest-v1';

const POSE_CLIP_NAME = 'thumbnail-rest';

// An upper arm whose direction to the elbow points further down than this
// (y of the unit vector; -0.87 is 60 degrees below horizontal) already hangs at
// the side. A T-pose reads about 0 and an A-pose about -0.7, so both get posed.
const ARM_HANGING_Y = -0.87;

const _shoulder = new Vector3();
const _elbow = new Vector3();

// The mixer fades a freshly played action in over 0.01 s (AnimationManager.play).
// One tick past that leaves the pose at full weight. The clip is constant, so
// the tick length never changes the pose itself.
const SETTLE_SECONDS = 0.05;

/**
 * Freeze one instant of a clip into a constant two-key clip.
 *
 * Joint rotations are slerped exactly the way the mixer would at that time (the
 * track's own interpolant), so the frozen pose is the frame the viewer would
 * show. Translation and scale tracks are dropped: a held pose has no root
 * motion, and the clip's hip translation is authored in metres, which launches
 * a rig whose hips rest at its armature origin under a centimetre-scale parent
 * (Robot Expressive, among others) a hundred units into the air. The avatar
 * keeps its own rest hip height and the renderer frames whatever it shows. Two
 * identical keys at 0 s and 1 s give the clip a real duration, which the
 * mixer's looping math needs.
 *
 * @param {object} clipJson three.js AnimationClip JSON (the on-disk clip format)
 * @param {number} [time=THUMBNAIL_POSE_TIME] seconds into the clip; wraps by its duration
 * @returns {object} AnimationClip JSON for the frozen pose
 */
export function sampleClipPose(clipJson, time = THUMBNAIL_POSE_TIME) {
	const clip = AnimationClip.parse(clipJson);
	const duration = clip.duration > 0 ? clip.duration : 0;
	const t = duration > 0 ? ((Number(time) || 0) % duration + duration) % duration : 0;
	const tracks = [];
	for (const track of clip.tracks) {
		if (!track.times?.length || !track.name.endsWith('.quaternion')) continue;
		const value = Array.from(track.createInterpolant().evaluate(t));
		const Track = track.constructor;
		tracks.push(new Track(track.name, [0, 1], [...value, ...value]));
	}
	return AnimationClip.toJSON(new AnimationClip(POSE_CLIP_NAME, 1, tracks));
}

// Every node's local transform, so a pose can be undone exactly. Undoing it
// matters wherever the posed object outlives the render: the CPU lane keeps
// decoded models in a cache, and a later retarget against a still-posed rig
// would read the idle frame as its rest pose.
function snapshotTransforms(root) {
	const saved = [];
	root.traverse((node) => {
		saved.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]);
	});
	return saved;
}

function restoreTransforms(root, saved) {
	for (const [node, position, quaternion, scale] of saved) {
		node.position.copy(position);
		node.quaternion.copy(quaternion);
		node.scale.copy(scale);
	}
	refreshSkinning(root);
}

/**
 * Bring world matrices and skeleton bone matrices up to date, so a bounds
 * measurement or a render that follows reads the current pose. Box3 reads a
 * SkinnedMesh through its bone matrices, which go stale until updated.
 *
 * @param {import('three').Object3D} root
 */
export function refreshSkinning(root) {
	root.updateMatrixWorld(true);
	root.traverse((node) => {
		if (!node.isSkinnedMesh) return;
		node.skeleton?.update();
		// A SkinnedMesh caches its skinned bounds on first use; drop the cache so
		// framing measures this pose rather than whichever one was measured first.
		node.boundingBox = null;
		node.boundingSphere = null;
	});
}

/**
 * Whether a rig was authored with both arms already hanging at its sides, a
 * stance that needs no posing. Reposing such a rig gains nothing and can lose:
 * a stylized body with short, thick limbs (Robot Expressive) retargets into
 * folded arms where its own stance was natural.
 *
 * @param {import('three').Object3D} root the rig in its bind pose
 * @returns {boolean}
 */
export function armsAlreadyHanging(root) {
	const nodes = canonicalBoneNodesFromObject(root);
	for (const [arm, forearm] of [['LeftArm', 'LeftForeArm'], ['RightArm', 'RightForeArm']]) {
		const a = nodes.get(arm);
		const b = nodes.get(forearm);
		if (!a || !b) return false;
		a.getWorldPosition(_shoulder);
		b.getWorldPosition(_elbow);
		const dir = _elbow.sub(_shoulder);
		const length = dir.length();
		if (length < 1e-6 || dir.y / length > ARM_HANGING_Y) return false;
	}
	return true;
}

/**
 * @typedef {Object} ThumbnailPoseResult
 * @property {boolean} posed   true when the avatar was moved into the rest pose
 * @property {'rest'|'arms-relaxed'|'authored-rest'|'not-humanoid'|'no-pose'} mode
 *   how it was posed, or why it was left as authored ('authored-rest': a
 *   humanoid whose own bind pose already has its arms down)
 * @property {() => void} restore undo every change; safe to call more than once
 */

/**
 * Pose a loaded avatar for a still render, in place.
 *
 * A humanoid in a T-pose or A-pose takes the frozen standing frame through the
 * viewer's own retargeting path. One already authored with its arms down keeps
 * its own stance. A humanoid the clip cannot drive (coverage too low, or the fallen-pose
 * guard rejected it) still gets its arms swung down geometrically, so the result
 * is at worst an arms-down stance, never a T-pose. Anything else is untouched.
 *
 * @param {import('three').Object3D} root the loaded scene (gltf.scene)
 * @param {object|null} poseClipJson output of sampleClipPose()
 * @returns {Promise<ThumbnailPoseResult>}
 */
export async function applyThumbnailPose(root, poseClipJson) {
	if (!root || !poseClipJson) return { posed: false, mode: 'no-pose', restore: () => {} };

	const saved = snapshotTransforms(root);
	const manager = new AnimationManager();
	let restored = false;
	const restore = () => {
		if (restored) return;
		restored = true;
		manager.detach();
		restoreTransforms(root, saved);
	};

	// attach() measures the rest frames, so the rig must read its bind pose here.
	refreshSkinning(root);
	manager.attach(root);
	if (!manager.supportsCanonicalClips()) {
		restore();
		return { posed: false, mode: 'not-humanoid', restore };
	}
	if (armsAlreadyHanging(root)) {
		restore();
		return { posed: false, mode: 'authored-rest', restore };
	}

	// Same order the viewer uses: relax arms the clip cannot reach, then play.
	manager.relaxUndrivenArms();
	manager.injectClip(POSE_CLIP_NAME, poseClipJson);
	const playing = await manager.play(POSE_CLIP_NAME);
	if (playing) {
		manager.update(SETTLE_SECONDS);
		refreshSkinning(root);
		return { posed: true, mode: 'rest', restore };
	}

	// The rig is humanoid but the clip could not drive it. Swing the arms down
	// with no name-mapping gate, which is what a T-pose needs most.
	manager.detach();
	const relaxed = relaxUndrivenArms(root, new Map());
	refreshSkinning(root);
	return { posed: relaxed > 0, mode: relaxed > 0 ? 'arms-relaxed' : 'not-humanoid', restore };
}

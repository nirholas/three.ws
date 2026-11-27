// Forge: check a rigged model before it is shown.
//
// The rig worker answering "done" is not proof the model can move. On
// 2026-11-27 a katana and a pair of boots both came back "done" with a 52-bone
// human skeleton. A rig with broken skin weights or a skeleton that does not fit
// the mesh would load, then tear apart the moment anything played on it. So the
// Rig button checks the result in the browser before it replaces the static
// model, and this module is that check:
//   1. there is a skeleton: at least one SkinnedMesh with bones;
//   2. its skin weights are valid: finite, non-negative, summing to about 1,
//      and every weighted joint index points at a real bone;
//   3. a standard animation plays on it without the mesh exploding. A humanoid
//      plays the library idle (retargeted with the same code /pose uses); any
//      other rig plays a procedural sway on every bone. The skinned bounding box
//      is measured at several frames and must not grow or drift past a bound.
//
// Pure: three and the retargeter only, no DOM or WebGL, so the same code runs
// in the page and in vitest.

import {
	AnimationClip,
	AnimationMixer,
	Box3,
	Quaternion,
	QuaternionKeyframeTrack,
	Vector3,
} from 'three';
import { MIN_CANONICAL_BONES } from './canonical-clip-gate.js';
import {
	canonicalNodeMapFromObject,
	clipHipBaselineY,
	hipGroundLocalY,
	hipRestLocalHeight,
	parseClipJSON,
	retargetClipToObject,
} from './animation-retarget.js';

/** How far a vertex's weights may sum from 1 and still count as valid. */
export const WEIGHT_SUM_TOLERANCE = 0.02;
/**
 * Share of vertices whose weights may sum away from 1 before the rig fails. A
 * vertex with a non-finite or negative weight, or a weighted joint index past
 * the last bone, fails the rig on its own: three reads a bone that does not
 * exist for it, and the vertex lands anywhere.
 */
export const MAX_BAD_WEIGHT_SHARE = 0.01;
/** Most the skinned bounding-box diagonal may grow while the test clip plays. */
export const MAX_GROWTH = 1.75;
/** Most the skinned bounding-box centre may move, in rest diagonals. */
export const MAX_DRIFT = 0.6;
/** Frames sampled across the test clip. */
export const SAMPLE_FRAMES = 8;
/** The library clip a humanoid is tested with (public/animations/clips). */
export const HUMANOID_TEST_CLIP = '/animations/clips/av-idle-breath.json';

const RIG_PROBLEMS = {
	no_skeleton: 'The rigger returned this model without a skeleton, so nothing in it can move.',
	bad_weights: (share) =>
		`${share} of this model's vertices came back with broken skin weights, so parts of it would tear the moment it moves.`,
	not_finite: 'This model broke apart when a test animation played on it: some vertices left the scene entirely.',
	explodes: 'This model stretched out of shape when a test animation played on it, so the skeleton does not fit the mesh.',
};

/** Every SkinnedMesh under `root` that has a skeleton with at least one bone. */
export function skinnedMeshesOf(root) {
	const out = [];
	root?.traverse?.((node) => {
		if (node.isSkinnedMesh && node.skeleton?.bones?.length) out.push(node);
	});
	return out;
}

/**
 * Count the vertices of one skinned mesh whose weights are invalid.
 *
 * @param {import('three').SkinnedMesh} mesh
 * @returns {{ vertices: number, bad: number, broken: number }}  `bad` counts every
 *   invalid vertex; `broken` the ones a single occurrence of fails the rig.
 */
export function inspectSkinWeights(mesh) {
	const geometry = mesh.geometry;
	const weights = geometry?.getAttribute?.('skinWeight');
	const indices = geometry?.getAttribute?.('skinIndex');
	const vertices = geometry?.getAttribute?.('position')?.count ?? 0;
	if (!weights || !indices || weights.count < vertices || indices.count < vertices) {
		return { vertices, bad: vertices, broken: vertices };
	}
	const boneCount = mesh.skeleton.bones.length;
	const size = Math.min(weights.itemSize, indices.itemSize);
	let bad = 0;
	let brokenCount = 0;
	for (let i = 0; i < vertices; i++) {
		let sum = 0;
		let broken = false;
		for (let c = 0; c < size; c++) {
			const w = weights.getComponent(i, c);
			if (!Number.isFinite(w) || w < -1e-4) {
				broken = true;
				break;
			}
			if (w > 1e-6) {
				const j = indices.getComponent(i, c);
				if (!Number.isInteger(j) || j < 0 || j >= boneCount) {
					broken = true;
					break;
				}
			}
			sum += w;
		}
		if (broken) brokenCount++;
		if (broken || Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) bad++;
	}
	return { vertices, bad, broken: brokenCount };
}

/** True when the rig names enough canonical human bones for the clip library. */
export function isHumanoidRig(root) {
	return canonicalNodeMapFromObject(root).size >= MIN_CANONICAL_BONES;
}

/**
 * The library idle retargeted onto a humanoid rig, with the hip track scaled to
 * the rig's own height the way apply_animation and the in-app player do it.
 * Returns null when too few of the clip's tracks find a bone.
 *
 * @param {import('three').Object3D} root
 * @param {object} clipJson  A library clip as AnimationClip.toJSON wrote it.
 */
export function humanoidTestClip(root, clipJson) {
	const base = parseClipJSON(clipJson, clipJson.name || 'Idle');
	let hipScale = 1;
	const hipLocalY = hipRestLocalHeight(root);
	const hipBaseline = clipHipBaselineY(base);
	if (hipLocalY > 0.05 && hipBaseline > 0.05) {
		hipScale = Math.min(200, Math.max(0.2, hipLocalY / hipBaseline));
	}
	const result = retargetClipToObject(base, root, { hipScale, hipOffsetY: hipGroundLocalY(root) });
	return result.clip;
}

/**
 * A looping sway for a rig the clip library cannot drive (a quadruped, a
 * creature, a tail): every bone rocks a few degrees about its own axes, each a
 * little later than its parent, so a spine undulates and a tail wags. Track
 * names use the bone's uuid when its name is missing or shared, which both
 * AnimationMixer and GLTFExporter resolve.
 *
 * @param {import('three').Object3D} root
 * @param {{ seconds?: number, degrees?: number, steps?: number }} [opts]
 */
export function swayClip(root, { seconds = 2.4, degrees = 7, steps = 12 } = {}) {
	const bones = [];
	const seenNames = new Map();
	for (const mesh of skinnedMeshesOf(root)) {
		for (const bone of mesh.skeleton.bones) {
			if (bones.includes(bone)) continue;
			bones.push(bone);
			if (bone.name) seenNames.set(bone.name, (seenNames.get(bone.name) || 0) + 1);
		}
	}
	const amp = (degrees * Math.PI) / 180;
	const times = Array.from({ length: steps + 1 }, (_, k) => (seconds * k) / steps);
	const swing = new Quaternion();
	const axis = new Vector3();
	const tracks = bones.map((bone) => {
		let depth = 0;
		for (let p = bone.parent; p && p.isBone; p = p.parent) depth++;
		const rest = bone.quaternion.clone();
		const values = [];
		for (const t of times) {
			const phase = (2 * Math.PI * t) / seconds - depth * 0.5;
			axis.set(Math.sin(phase) * 0.6, 0, Math.cos(phase)).normalize();
			swing.setFromAxisAngle(axis, amp * Math.sin(phase));
			const q = rest.clone().multiply(swing);
			values.push(q.x, q.y, q.z, q.w);
		}
		const unique = bone.name && seenNames.get(bone.name) === 1;
		return new QuaternionKeyframeTrack(`${unique ? bone.name : bone.uuid}.quaternion`, times, values);
	});
	return new AnimationClip('Sway', seconds, tracks);
}

function skinnedBox(meshes, target) {
	target.makeEmpty();
	const box = new Box3();
	for (const mesh of meshes) {
		mesh.computeBoundingBox();
		box.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
		target.union(box);
	}
	return target;
}

/**
 * Play `clip` on the rig at SAMPLE_FRAMES points and measure the skinned
 * bounding box against the rest pose. The bones are put back exactly where
 * they were afterwards, so the caller can export the model in its bind pose.
 *
 * @param {import('three').Object3D} root
 * @param {AnimationClip} clip
 * @returns {{ finite: boolean, growth: number, drift: number, restDiagonal: number }}
 */
export function measureDeformation(root, clip, frames = SAMPLE_FRAMES) {
	const meshes = skinnedMeshesOf(root);
	const bones = new Set();
	for (const mesh of meshes) for (const bone of mesh.skeleton.bones) bones.add(bone);
	const saved = [...bones].map((b) => [b, b.position.clone(), b.quaternion.clone(), b.scale.clone()]);

	root.updateMatrixWorld(true);
	const rest = skinnedBox(meshes, new Box3());
	const restSize = rest.getSize(new Vector3());
	const restCenter = rest.getCenter(new Vector3());
	const restDiagonal = restSize.length();

	const mixer = new AnimationMixer(root);
	const action = mixer.clipAction(clip);
	action.play();
	const box = new Box3();
	const center = new Vector3();
	let finite = Number.isFinite(restDiagonal) && restDiagonal > 0;
	let growth = 1;
	let drift = 0;
	for (let k = 0; k < frames && finite; k++) {
		mixer.setTime((clip.duration * (k + 0.5)) / frames);
		root.updateMatrixWorld(true);
		skinnedBox(meshes, box);
		const diag = box.getSize(new Vector3()).length();
		box.getCenter(center);
		if (!Number.isFinite(diag) || !Number.isFinite(center.x + center.y + center.z)) {
			finite = false;
			break;
		}
		growth = Math.max(growth, diag / restDiagonal);
		drift = Math.max(drift, center.distanceTo(restCenter) / restDiagonal);
	}
	action.stop();
	mixer.uncacheRoot(root);
	for (const [b, p, q, s] of saved) {
		b.position.copy(p);
		b.quaternion.copy(q);
		b.scale.copy(s);
	}
	root.updateMatrixWorld(true);
	return { finite, growth, drift, restDiagonal };
}

function formatShare(share) {
	const pct = share * 100;
	if (pct > 0 && pct < 0.1) return 'Under 0.1%';
	return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

/**
 * The whole check. `clipJson` is the library idle (HUMANOID_TEST_CLIP), used
 * when the rig is a humanoid; pass null to test with the sway only.
 *
 * @param {import('three').Object3D} root
 * @param {{ clipJson?: object|null }} [opts]
 * @returns {{ ok: boolean, kind: 'humanoid'|'creature'|null, clip: AnimationClip|null,
 *   problem: { code: string, message: string }|null,
 *   stats: { meshes: number, bones: number, vertices: number, badWeights: number, growth?: number, drift?: number } }}
 */
export function verifyRiggedModel(root, { clipJson = null } = {}) {
	const meshes = skinnedMeshesOf(root);
	const bones = new Set();
	for (const mesh of meshes) for (const bone of mesh.skeleton.bones) bones.add(bone);
	const stats = { meshes: meshes.length, bones: bones.size, vertices: 0, badWeights: 0 };
	let broken = 0;
	const fail = (code, message, kind = null) => ({ ok: false, kind, clip: null, problem: { code, message }, stats });

	if (!meshes.length) return fail('no_skeleton', RIG_PROBLEMS.no_skeleton);

	for (const mesh of meshes) {
		const inspected = inspectSkinWeights(mesh);
		stats.vertices += inspected.vertices;
		stats.badWeights += inspected.bad;
		broken += inspected.broken;
	}
	const badShare = stats.vertices ? stats.badWeights / stats.vertices : 1;
	if (broken > 0 || badShare > MAX_BAD_WEIGHT_SHARE) {
		return fail('bad_weights', RIG_PROBLEMS.bad_weights(formatShare(badShare)));
	}

	const humanoid = isHumanoidRig(root);
	const kind = humanoid ? 'humanoid' : 'creature';
	const clip = (humanoid && clipJson && humanoidTestClip(root, clipJson)) || swayClip(root);
	const { finite, growth, drift } = measureDeformation(root, clip);
	stats.growth = Number(growth.toFixed(3));
	stats.drift = Number(drift.toFixed(3));
	if (!finite) return fail('not_finite', RIG_PROBLEMS.not_finite, kind);
	if (growth > MAX_GROWTH || drift > MAX_DRIFT) return fail('explodes', RIG_PROBLEMS.explodes, kind);
	return { ok: true, kind, clip, problem: null, stats };
}

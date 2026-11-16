/**
 * Audio2Face-3D emotion: from "how should this line feel" to the whole face and head.
 *
 * NVIDIA Audio2Face-3D takes per-time-code emotion input alongside the audio
 * (ten channels: amazement, anger, cheekiness, disgust, fear, grief, joy,
 * outofbreath, pain, sadness) and reports back the emotion it actually animated
 * (`emotion_aggregate` metadata: the caller's input, the audio-inferred
 * Audio2Emotion estimate and the smoothed blend it applied). The blendshape track
 * already carries that emotion on the mouth and, for ARKit rigs, the brows and
 * eyes. This module carries it the rest of the way:
 *
 *   1. intentToA2fEmotion(): the agent's intended feeling (our six-emotion
 *      vocabulary from src/embodiment/emotion.js, the agent-avatar transient
 *      emotions, raw A2F channel names, or a channel map) becomes A2F input.
 *   2. EmotionLayer: the emotion track A2F returns drives
 *        - upper-face ARKit shapes (brows, eye squint/wide/look, cheeks, nose),
 *          merged with max() into the A2F frame so they never double-stack;
 *        - single-morph extras on half-body rigs (mouthSmile, eyesLookDown);
 *        - VRM expression presets (happy, angry, sad, relaxed, surprised) and,
 *          for VRMs whose mouth only exists as aa/ih/ou/ee/oh presets, the
 *          visemes themselves;
 *        - a subtle head nod/tilt and eye-bone gaze offset, coupled to the
 *          speech envelope, layered additively on top of whatever idle clip the
 *          mixer is playing.
 *      Gains are tuned per rig kind (ARKit / VRM / viseme / bones-only).
 *
 * Pure apart from the three.js math objects; shared by the browser player and
 * the server route (which only uses the intent half).
 */

import { Quaternion, Euler } from 'three';
import { canonicalARKitName, ARKIT_GROUPS, VRM_TO_ARKIT } from './arkit-blendshapes.js';
import { A2F_EMOTIONS, DEFAULT_EMOTION_STRENGTH } from './a2f-emotion-intent.js';

export {
	A2F_EMOTIONS,
	INTENT_TO_A2F,
	INTENT_LABELS,
	DEFAULT_EMOTION_STRENGTH,
	intentToA2fEmotion,
	dominantEmotion,
} from './a2f-emotion-intent.js';

// ── Face targets ────────────────────────────────────────────────────────────
// Upper-face ARKit activation per A2F emotion at value 1. Values were tuned
// against the hosted model's own brow/eye output on the same line, so the layer
// reads as an accent of what A2F does rather than a second, competing face.
const L = 'Left';
const R = 'Right';
function both(base, v) {
	return { [base + L]: v, [base + R]: v };
}
export const EMOTION_FACE = Object.freeze({
	joy: { ...both('cheekSquint', 0.55), ...both('eyeSquint', 0.35), ...both('browOuterUp', 0.15) },
	amazement: { ...both('eyeWide', 0.7), browInnerUp: 0.65, ...both('browOuterUp', 0.6) },
	anger: { ...both('browDown', 0.8), ...both('eyeSquint', 0.35), ...both('noseSneer', 0.4) },
	sadness: { browInnerUp: 0.7, ...both('eyeLookDown', 0.25), ...both('eyeSquint', 0.1) },
	grief: { browInnerUp: 0.85, ...both('eyeSquint', 0.3), ...both('eyeLookDown', 0.3) },
	fear: { browInnerUp: 0.75, ...both('browOuterUp', 0.4), ...both('eyeWide', 0.6) },
	disgust: { ...both('noseSneer', 0.7), ...both('browDown', 0.4), ...both('cheekSquint', 0.3), ...both('eyeSquint', 0.25) },
	cheekiness: { browOuterUpLeft: 0.45, eyeSquintRight: 0.3, cheekSquintLeft: 0.3 },
	pain: { ...both('browDown', 0.55), browInnerUp: 0.4, ...both('eyeSquint', 0.6), ...both('cheekSquint', 0.4), ...both('noseSneer', 0.3) },
	outofbreath: { browInnerUp: 0.3, ...both('eyeSquint', 0.15) },
});

/** The ARKit channels the emotion layer is allowed to touch (never the mouth or jaw). */
export const UPPER_FACE = Object.freeze(new Set([...ARKIT_GROUPS.brow, ...ARKIT_GROUPS.cheek, ...ARKIT_GROUPS.eye, ...ARKIT_GROUPS.nose]));

/**
 * Upper-face ARKit targets for an emotion frame.
 * @param {Record<string,number>} emotion A2F channel → 0..1
 * @param {number} gain overall multiplier (strength x rig tuning)
 * @returns {Record<string,number>} canonical ARKit name → 0..1
 */
export function faceTargetsFor(emotion, gain = 1) {
	const out = {};
	if (!(gain > 0)) return out;
	for (const [name, v] of Object.entries(emotion || {})) {
		const table = EMOTION_FACE[name];
		if (!table || !(v > 0)) continue;
		for (const [shape, w] of Object.entries(table)) out[shape] = (out[shape] || 0) + w * v * gain;
	}
	for (const k in out) out[k] = clamp01(out[k]);
	return out;
}

// Half-body rigs (Ready Player Me style) often carry a few single morphs outside
// ARKit naming. Each maps to an emotion mix.
export const EXTRA_MORPHS = Object.freeze({
	mouthsmile: { joy: 0.6, cheekiness: 0.4 },
	eyeslookdown: { sadness: 0.35, grief: 0.4, pain: 0.15 },
	eyeslookup: { amazement: 0.15 },
});

// VRM expression presets driven from emotion (three-vrm expressionManager names).
export const EMOTION_VRM = Object.freeze({
	happy: { joy: 0.8, cheekiness: 0.3 },
	angry: { anger: 0.8, disgust: 0.35, pain: 0.2 },
	sad: { sadness: 0.8, grief: 0.9, pain: 0.3 },
	surprised: { amazement: 0.8, fear: 0.5 },
	relaxed: { cheekiness: 0.4 },
});

/** Weighted sum of an emotion frame against a channel mix, clamped 0..1. */
export function mixWeight(emotion, mix, gain = 1) {
	let s = 0;
	for (const k in mix) s += (emotion[k] || 0) * mix[k];
	return clamp01(s * gain);
}

// ── Head and eyes ───────────────────────────────────────────────────────────
// Static posture per emotion at value 1, radians in the avatar's root frame
// (+Z forward, +Y up): pitch > 0 drops the chin, roll > 0 tilts toward the
// avatar's left shoulder, yaw > 0 turns toward its left.
export const EMOTION_HEAD = Object.freeze({
	joy: { pitch: -0.05, roll: 0.03 },
	amazement: { pitch: -0.09 },
	anger: { pitch: 0.07 },
	sadness: { pitch: 0.12, roll: 0.05 },
	grief: { pitch: 0.14, roll: 0.04 },
	fear: { pitch: -0.03, roll: -0.03 },
	cheekiness: { roll: 0.09, yaw: 0.04 },
	disgust: { pitch: -0.03, yaw: -0.06 },
	pain: { pitch: 0.06, roll: -0.04 },
	outofbreath: { pitch: -0.04 },
});
// How much each emotion animates the speech-coupled nod (emphasis beats).
export const EMOTION_NOD = Object.freeze({ joy: 1, anger: 0.8, amazement: 0.6, cheekiness: 0.5, disgust: 0.3 });
// Gaze offset of the eye bones (pitch > 0 looks down).
export const EMOTION_GAZE = Object.freeze({ sadness: 0.1, grief: 0.12, pain: 0.05, amazement: -0.04, fear: -0.02 });

const NOD_BASE = 0.35; // even a mild line keeps a little emphasis
const NOD_GAIN = 0.32; // rad per unit of jaw-onset energy
const NOD_MAX = 0.06;

/** Head posture (pitch/yaw/roll radians) for an emotion frame, before nod. */
export function headPostureFor(emotion, gain = 1) {
	let pitch = 0;
	let yaw = 0;
	let roll = 0;
	for (const [name, v] of Object.entries(emotion || {})) {
		const p = EMOTION_HEAD[name];
		if (!p || !(v > 0)) continue;
		pitch += (p.pitch || 0) * v;
		yaw += (p.yaw || 0) * v;
		roll += (p.roll || 0) * v;
	}
	return { pitch: pitch * gain, yaw: yaw * gain, roll: roll * gain };
}

/** Nod scale for an emotion frame (multiplies the jaw-onset signal). */
export function nodScaleFor(emotion) {
	let s = NOD_BASE;
	for (const [name, v] of Object.entries(emotion || {})) s += (EMOTION_NOD[name] || 0) * (v > 0 ? v : 0);
	return s;
}

/** Eye-bone gaze pitch for an emotion frame. */
export function gazePitchFor(emotion, gain = 1) {
	let p = 0;
	for (const [name, v] of Object.entries(emotion || {})) p += (EMOTION_GAZE[name] || 0) * (v > 0 ? v : 0);
	return p * gain;
}

/**
 * Per-rig tuning. ARKit rigs already receive emotion on their upper face from
 * A2F's own blendshapes, so the face layer is an accent there; rigs that only
 * get derived shapes (VRM, visemes) lean on it, and bones-only rigs carry the
 * feeling through head and gaze alone.
 */
export const RIG_TUNING = Object.freeze({
	arkit: { face: 0.55, extras: 1, vrm: 0, head: 1, gaze: 1 },
	vrm: { face: 1, extras: 1, vrm: 0.85, head: 1, gaze: 1 },
	viseme: { face: 1, extras: 1, vrm: 0, head: 1.15, gaze: 1 },
	bones: { face: 0, extras: 0, vrm: 0, head: 1.25, gaze: 1.2 },
});

// ── Track sampling ──────────────────────────────────────────────────────────

/**
 * Sample an emotion track { names, frames: [{ t, v: number[] }] } at time `t`,
 * interpolating between keyframes. Writes into and returns `out`.
 */
export function sampleEmotionTrack(track, t, out = {}) {
	for (const k in out) out[k] = 0;
	const frames = track?.frames;
	const names = track?.names;
	if (!Array.isArray(frames) || !frames.length || !Array.isArray(names)) return out;
	let i = 0;
	if (t <= frames[0].t) i = 0;
	else {
		let lo = 0;
		let hi = frames.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (frames[mid].t <= t) lo = mid;
			else hi = mid - 1;
		}
		i = lo;
	}
	const a = frames[i];
	const b = frames[i + 1];
	const blend = b && b.t > a.t ? clamp01((t - a.t) / (b.t - a.t)) : 0;
	for (let c = 0; c < names.length; c++) {
		const va = a.v[c] || 0;
		const vb = b ? b.v[c] || 0 : va;
		out[names[c]] = va + (vb - va) * blend;
	}
	return out;
}

// ── Rig binding ─────────────────────────────────────────────────────────────

const HEAD_NAMES = /^(?:mixamorig[:_]?)?(?:j_bip_c_)?head$/i;
const EYE_NAMES = /^(?:mixamorig[:_]?)?(?:j_adj_[lr]_faceeye|(?:left|right)_?eye|eye_?(?:l|r|left|right))$/i;
const VRM_VISEMES = Object.freeze({ aa: 'Aa', ih: 'Ih', ou: 'Ou', ee: 'Ee', oh: 'Oh' });

/**
 * Detect the rig kind of a loaded avatar, for tuning and diagnostics.
 * @returns {'vrm'|'arkit'|'viseme'|'bones'}
 */
export function detectRigKind(root) {
	if (vrmOf(root)?.expressionManager) return 'vrm';
	let arkitUpper = 0;
	let viseme = 0;
	root?.traverse?.((n) => {
		if (!n.isMesh || !n.morphTargetDictionary) return;
		for (const name of Object.keys(n.morphTargetDictionary)) {
			const c = canonicalARKitName(name);
			if (c && UPPER_FACE.has(c)) arkitUpper++;
			if (/^viseme_/i.test(name)) viseme++;
		}
	});
	if (arkitUpper >= 4) return 'arkit';
	if (viseme) return 'viseme';
	return 'bones';
}

function vrmOf(root) {
	let n = root;
	while (n) {
		if (n.userData?.vrm) return n.userData.vrm;
		n = n.parent;
	}
	return null;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _qDelta = new Quaternion();
const _qRoot = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');

/**
 * A bone the layer offsets additively. Each frame it re-derives the base pose:
 * if nothing rewrote the bone since our last write (no mixer clip on it), the
 * previous delta is removed first; otherwise the mixer's fresh pose is the base.
 */
class BoneOffset {
	constructor(bone) {
		this.bone = bone;
		this.written = new Quaternion();
		this.lastDelta = new Quaternion();
		this.hasWritten = false;
	}

	/** Apply a rotation given in the avatar root frame (pitch/yaw/roll radians). */
	apply(root, pitch, yaw, roll) {
		const bone = this.bone;
		if (this.hasWritten && bone.quaternion.equals(this.written)) {
			// Untouched since our last write: restore the base pose (q = P^-1 D P L).
			bone.quaternion.premultiply(_q.copy(this.lastDelta).invert());
		}
		_e.set(pitch, yaw, roll, 'YXZ');
		const rootDelta = _qDelta.setFromEuler(_e);
		// Express the root-frame delta in the bone's parent frame.
		const parent = bone.parent;
		if (parent) {
			parent.getWorldQuaternion(_q);
			root.getWorldQuaternion(_qRoot);
			_q.premultiply(_qRoot.invert()); // parent relative to root
			_q2.copy(_q).invert();
			rootDelta.premultiply(_q2).multiply(_q); // P^-1 D P
		}
		this.lastDelta.copy(rootDelta);
		bone.quaternion.premultiply(rootDelta);
		this.written.copy(bone.quaternion);
		this.hasWritten = true;
	}

	/** Remove our offset (only if nothing else rewrote the bone since). */
	release() {
		if (this.hasWritten && this.bone.quaternion.equals(this.written)) {
			this.bone.quaternion.premultiply(_q.copy(this.lastDelta).invert());
		}
		this.hasWritten = false;
		this.lastDelta.identity();
	}
}

/**
 * The emotion layer for one avatar. Lives inside A2FPlayer; usable standalone.
 *
 *   layer.attach(root)
 *   layer.setTrack(animation.emotion)
 *   layer.setOptions({ enabled, strength })
 *   per frame: layer.sample(timeSec) → faceTargets (merge into the ARKit frame)
 *              layer.applyRig(arkitFrame, dtSec)
 *   layer.release() when playback stops
 */
export class EmotionLayer {
	constructor() {
		this.enabled = true;
		this.strength = DEFAULT_EMOTION_STRENGTH;
		this.kind = 'bones';
		this._root = null;
		this._vrm = null;
		this._head = null;
		this._eyes = [];
		this._extras = []; // { mesh, index, mix }
		this._track = null;
		this._emotion = Object.create(null); // last sampled (pre-strength) frame
		this._smooth = Object.create(null); // eased frame actually applied
		this._face = Object.create(null);
		this._vrmTouched = new Set();
		this._jawFast = 0;
		this._jawSlow = 0;
		this._nod = 0;
	}

	attach(root) {
		this.release();
		this._root = root || null;
		this._vrm = vrmOf(root);
		this._head = null;
		this._eyes = [];
		this._extras = [];
		if (!root?.traverse) return;
		this.kind = detectRigKind(root);
		const humanoid = this._vrm?.humanoid;
		const vrmHead = humanoid?.getRawBoneNode?.('head');
		if (vrmHead) this._head = new BoneOffset(vrmHead);
		const vrmEyes = ['leftEye', 'rightEye'].map((b) => humanoid?.getRawBoneNode?.(b)).filter(Boolean);
		for (const e of vrmEyes) this._eyes.push(new BoneOffset(e));
		root.traverse((n) => {
			if (!n.isMesh) {
				const name = n.name || '';
				if (!this._head && HEAD_NAMES.test(name)) this._head = new BoneOffset(n);
				else if (!vrmEyes.length && EYE_NAMES.test(name)) this._eyes.push(new BoneOffset(n));
			}
			if (n.isMesh && n.morphTargetDictionary && n.morphTargetInfluences) {
				for (const [morph, index] of Object.entries(n.morphTargetDictionary)) {
					const mix = EXTRA_MORPHS[String(morph).toLowerCase()];
					if (mix) this._extras.push({ mesh: n, index, mix });
				}
			}
		});
	}

	setOptions({ enabled, strength } = {}) {
		if (typeof enabled === 'boolean') this.enabled = enabled;
		if (strength != null && Number.isFinite(Number(strength))) this.strength = clamp01(Number(strength));
	}

	/** @param {{ names:string[], frames:Array<{t:number,v:number[]}> }|null} track */
	setTrack(track) {
		this._track = track && Array.isArray(track.frames) && track.frames.length && Array.isArray(track.names) ? track : null;
	}

	get hasTrack() {
		return !!this._track;
	}

	/** Eased emotion frame currently applied (after strength), for meters. */
	current() {
		return this._smooth;
	}

	/** True when the VRM's mouth exists only as expression presets (no ARKit or viseme morph path). */
	vrmDrivesVisemes() {
		return !!this._vrm?.expressionManager;
	}

	/**
	 * Sample the emotion at `timeSec` and return the upper-face ARKit targets to
	 * merge (max) into the A2F frame. Returns an empty object when disabled.
	 */
	sample(timeSec, dtSec = 1 / 60) {
		const active = this.enabled && this.strength > 0 && this._track;
		if (active) sampleEmotionTrack(this._track, Number(timeSec) || 0, this._emotion);
		else for (const k in this._emotion) this._emotion[k] = 0;
		// Ease toward the target so a muted or ending line relaxes instead of snapping.
		const a = 1 - Math.exp(-Math.max(0, dtSec) / 0.12);
		const s = active ? this.strength : 0;
		for (const k of A2F_EMOTIONS) {
			const target = (this._emotion[k] || 0) * s;
			const cur = this._smooth[k] || 0;
			this._smooth[k] = cur + (target - cur) * a;
		}
		const tune = RIG_TUNING[this.kind] || RIG_TUNING.arkit;
		const face = faceTargetsFor(this._smooth, tune.face);
		for (const k in this._face) delete this._face[k];
		Object.assign(this._face, face);
		return this._face;
	}

	/**
	 * Apply everything that is not an ARKit morph: extras, VRM expressions
	 * (emotion presets and, for preset-only mouths, the visemes derived from the
	 * A2F frame), head nod/tilt and eye gaze.
	 * @param {Record<string,number>} arkit the merged canonical ARKit frame
	 */
	applyRig(arkit, dtSec = 1 / 60) {
		const root = this._root;
		if (!root) return;
		const tune = RIG_TUNING[this.kind] || RIG_TUNING.arkit;
		const emo = this._smooth;

		for (const x of this._extras) {
			const v = mixWeight(emo, x.mix, tune.extras);
			if (v > x.mesh.morphTargetInfluences[x.index]) x.mesh.morphTargetInfluences[x.index] = v;
		}

		const em = this._vrm?.expressionManager;
		if (em) {
			for (const [preset, mix] of Object.entries(EMOTION_VRM)) this._setVrm(em, preset, mixWeight(emo, mix, tune.vrm || 0.85));
			for (const [preset, key] of Object.entries(VRM_VISEMES)) {
				this._setVrm(em, preset, deriveFromArkit(arkit, VRM_TO_ARKIT[key]));
			}
			this._setVrm(em, 'blink', Math.min(arkit.eyeBlinkLeft || 0, arkit.eyeBlinkRight || 0));
		}

		// Speech-coupled nod: the fast-minus-slow jaw envelope peaks on syllable
		// onsets, which is where a speaker's head naturally dips for emphasis.
		const jaw = arkit.jawOpen || 0;
		const af = 1 - Math.exp(-dtSec / 0.05);
		const as = 1 - Math.exp(-dtSec / 0.35);
		this._jawFast += (jaw - this._jawFast) * af;
		this._jawSlow += (jaw - this._jawSlow) * as;
		const onset = Math.max(0, this._jawFast - this._jawSlow);
		const energy = A2F_EMOTIONS.reduce((s, k) => s + (emo[k] || 0), 0);
		const nodTarget = energy > 0.01 ? Math.min(NOD_MAX, onset * NOD_GAIN * nodScaleFor(emo)) : 0;
		this._nod += (nodTarget - this._nod) * (1 - Math.exp(-dtSec / 0.08));

		if (this._head) {
			const p = headPostureFor(emo, tune.head);
			this._head.apply(root, p.pitch + this._nod * tune.head, p.yaw, p.roll);
		}
		if (this._eyes.length) {
			const g = gazePitchFor(emo, tune.gaze);
			for (const e of this._eyes) e.apply(root, g, 0, 0);
		}
	}

	_setVrm(em, preset, v) {
		if (!em.getExpression?.(preset)) return;
		em.setValue(preset, clamp01(v));
		this._vrmTouched.add(preset);
	}

	/** Remove head/eye offsets and VRM expression values the layer set. */
	release() {
		this._head?.release();
		for (const e of this._eyes) e.release();
		const em = this._vrm?.expressionManager;
		if (em) for (const p of this._vrmTouched) em.setValue(p, 0);
		this._vrmTouched.clear();
		for (const k in this._smooth) this._smooth[k] = 0;
		this._jawFast = this._jawSlow = this._nod = 0;
	}
}

function deriveFromArkit(arkit, components) {
	if (!components) return 0;
	let sum = 0;
	let denom = 0;
	for (const k in components) {
		sum += (arkit[k] || 0) * components[k];
		denom += components[k];
	}
	return denom > 0 ? clamp01(sum / denom) : 0;
}

function clamp01(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

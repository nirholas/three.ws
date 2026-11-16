/**
 * Audio2Face-3D playback — drive a loaded GLB from an A2F blendshape track.
 *
 * NVIDIA Audio2Face-3D (api/_lib/a2f-nvidia.js) returns a per-frame ARKit-52
 * blendshape track aligned to the spoken audio's timeline:
 *
 *   { fps, blendShapeNames: ["EyeBlinkLeft", …, "JawOpen", …],
 *     frames: [{ t: <seconds>, w: [<weight per name>] }, …] }
 *
 * This class maps that track onto whatever morph-target convention the avatar's
 * GLB actually ships — the SAME problem glb-canonicalize.js solves for bones,
 * solved here for face morphs by reusing the cross-format vocabulary in
 * arkit-blendshapes.js:
 *
 *   • ARKit / RPM / Avaturn / MetaHuman (jawOpen, JawOpen, jaw_open, …)
 *     → driven DIRECTLY: each A2F shape writes to its canonical morph.
 *   • VRM / VRoid (A, I, U, E, O / Aa, Ih, Ou, Ee, Oh, Blink, emotions)
 *     and Oculus / Meta visemes (viseme_aa, viseme_O, …)
 *     → driven by DERIVING each expression's activation from the A2F ARKit
 *       frame (the inverse of arkit-blendshapes' VRM/Oculus→ARKit maps), so a
 *       rig that exposes only monolithic vowel shapes still lip-syncs.
 *
 * The avatar plays the ORIGINAL audio; `update(audioTimeSec)` samples the track
 * by the audio element's currentTime (interpolating between the 30 fps A2F
 * frames for smooth motion at display refresh), so the lips track the real
 * voice. No rig allowlist: an unknown convention degrades to "no coverage", and
 * the caller falls back to amplitude lipsync — never a frozen face.
 *
 * Emotion: when the track carries A2F's emotion output (`track.emotion`, see
 * api/_lib/a2f-emotion-wire.js), an EmotionLayer (./a2f-emotion.js) carries it
 * past the mouth: upper-face accents merged into the frame with max(), VRM
 * expression presets, and a subtle head nod/tilt plus eye gaze layered on top of
 * the idle clip. `setEmotionOptions({ enabled, strength })` is the off switch
 * and dial. VRMs whose mouth exists only as expression presets (VRoid's
 * Fcl_MTH_* morphs behind aa/ih/ou/ee/oh) are driven through expressionManager.
 */

import {
	canonicalARKitName,
	VRM_TO_ARKIT,
	OCULUS_TO_ARKIT,
	ARKIT_GROUPS,
} from './arkit-blendshapes.js';
import { EmotionLayer } from './a2f-emotion.js';

// Canonical ARKit shapes that move the mouth/jaw — used to decide whether a mesh
// already has DIRECT mouth coverage (so we don't also drive its vowel morphs and
// double-stack the lips).
const MOUTH_SHAPES = new Set([...ARKIT_GROUPS.jaw, ...ARKIT_GROUPS.mouth]);

// Expression morph names we know how to derive from an ARKit frame. Built from
// the VRM + Oculus maps so the set stays in lockstep with arkit-blendshapes.js.
const EXPRESSION_COMPONENTS = buildExpressionComponents();

function buildExpressionComponents() {
	const out = new Map(); // lowercased morph name → { arkitName: weight }
	for (const [name, components] of Object.entries(VRM_TO_ARKIT)) {
		out.set(name.toLowerCase(), components);
	}
	for (const [name, components] of Object.entries(OCULUS_TO_ARKIT)) {
		out.set(name.toLowerCase(), components);
	}
	return out;
}

export class A2FPlayer {
	constructor() {
		/** @type {Array<{mesh:any, index:number, canonical:string}>} */
		this._direct = [];
		/** @type {Array<{mesh:any, index:number, components:Record<string,number>, denom:number}>} */
		this._expression = [];
		this._track = null; // { fps, names, frames, canonForName: (string|null)[] }
		this._cursor = 0;
		this._lastTime = -1;
		this._attached = false;
		this._emotion = new EmotionLayer();
	}

	/**
	 * Bind to a freshly loaded GLB scene. Re-callable after a model hot-swap.
	 * @param {import('three').Object3D} root
	 */
	attach(root) {
		this._direct = [];
		this._expression = [];
		this._attached = false;
		if (!root || typeof root.traverse !== 'function') return;

		const meshes = [];
		root.traverse((node) => {
			if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
				meshes.push(node);
			}
		});

		for (const mesh of meshes) {
			const dict = mesh.morphTargetDictionary;
			const directHere = [];
			for (const [morphName, index] of Object.entries(dict)) {
				const canonical = canonicalARKitName(morphName);
				if (canonical) directHere.push({ mesh, index, canonical });
			}
			const hasDirectMouth = directHere.some((b) => MOUTH_SHAPES.has(b.canonical));
			this._direct.push(...directHere);

			// Only derive vowel/viseme expressions for a mesh that lacks direct
			// mouth morphs — otherwise we'd fight the ARKit mouth shapes.
			if (!hasDirectMouth) {
				for (const [morphName, index] of Object.entries(dict)) {
					const components = EXPRESSION_COMPONENTS.get(String(morphName).toLowerCase());
					if (!components) continue;
					const denom = Object.values(components).reduce((s, w) => s + w, 0);
					if (denom > 0) this._expression.push({ mesh, index, components, denom });
				}
			}
		}

		this._emotion.attach(root);
		this._attached = true;
	}

	/** True when at least one morph (or VRM expression preset) is wired. */
	hasCoverage() {
		return (
			this._attached &&
			(this._direct.length > 0 || this._expression.length > 0 || this._emotion.vrmDrivesVisemes())
		);
	}

	/**
	 * Emotion layer controls: `enabled` false is the off switch (the face falls
	 * back to A2F's mouth-only track), `strength` 0..1 scales every channel.
	 */
	setEmotionOptions(opts) {
		this._emotion.setOptions(opts);
	}

	/** Eased A2F emotion frame currently applied (channel → 0..1), for meters. */
	currentEmotion() {
		return this._emotion.current();
	}

	/** Rig kind the emotion layer tuned for: 'arkit' | 'vrm' | 'viseme' | 'bones'. */
	get rigKind() {
		return this._emotion.kind;
	}

	/** Diagnostics: which morphs are wired and by which path. */
	describe() {
		return {
			direct: this._direct.map((b) => `${b.mesh.name}:${b.canonical}`),
			expression: this._expression.map((b) => `${b.mesh.name}:#${b.index}`),
			frames: this._track?.frames.length ?? 0,
			fps: this._track?.fps ?? 0,
			rig: this._emotion.kind,
			vrmExpressions: this._emotion.vrmDrivesVisemes(),
			emotionFrames: this._emotion.hasTrack ? this._track?.emotionFrames ?? 0 : 0,
		};
	}

	/**
	 * Load an A2F animation track. Precomputes the canonical ARKit name for each
	 * blendshape column so per-frame sampling does no string work.
	 * @param {{ fps:number, blendShapeNames:string[], frames:Array<{t:number,w:number[]}> }} track
	 */
	setTrack(track) {
		if (!track || !Array.isArray(track.frames) || !track.frames.length) {
			this._track = null;
			this._emotion.setTrack(null);
			return;
		}
		const names = Array.isArray(track.blendShapeNames) ? track.blendShapeNames : [];
		this._track = {
			fps: track.fps || 30,
			names,
			frames: track.frames,
			canonForName: names.map((n) => canonicalARKitName(n)),
			emotionFrames: track.emotion?.frames?.length ?? 0,
		};
		this._emotion.setTrack(track.emotion || null);
		this._cursor = 0;
		this._lastTime = -1;
	}

	/**
	 * Attach (or replace) the emotion track on its own, for a streamed turn whose
	 * emotion frames arrive after the blendshape track was set. The arrays may
	 * keep growing in place.
	 * @param {{ names:string[], frames:Array<{t:number,v:number[]}> }|null} track
	 */
	setEmotionTrack(track) {
		this._emotion.setTrack(track || null);
		if (this._track) this._track.emotionFrames = track?.frames?.length ?? 0;
	}

	get duration() {
		const f = this._track?.frames;
		return f && f.length ? f[f.length - 1].t : 0;
	}

	/**
	 * Sample the track at `timeSec` (the playing audio's currentTime) and write
	 * the resulting weights onto the bound morphs. Safe before attach/setTrack
	 * (no-op). Interpolates between the two bracketing A2F frames.
	 *
	 * @param {number} timeSec
	 */
	update(timeSec) {
		if (!this._attached || !this._track) return;
		const frames = this._track.frames;
		const t = Number(timeSec) || 0;

		// Forward playback advances the cursor; a backward seek (replay) rewinds it.
		const dt = this._lastTime >= 0 && t >= this._lastTime ? Math.min(0.1, t - this._lastTime) : 1 / 60;
		if (t < this._lastTime) this._cursor = 0;
		this._lastTime = t;
		let i = this._cursor;
		while (i < frames.length - 1 && frames[i + 1].t <= t) i++;
		this._cursor = i;

		const cur = frames[i];
		const nxt = frames[i + 1];
		let blend = 0;
		if (nxt && nxt.t > cur.t) blend = Math.min(1, Math.max(0, (t - cur.t) / (nxt.t - cur.t)));

		// Build the canonical ARKit frame (name → interpolated weight) once, then
		// fan out to direct + derived bindings.
		const arkit = this._arkit || (this._arkit = Object.create(null));
		for (const k in arkit) arkit[k] = 0;
		const { canonForName } = this._track;
		const cw = cur.w;
		const nw = nxt ? nxt.w : null;
		for (let c = 0; c < canonForName.length; c++) {
			const canon = canonForName[c];
			if (!canon) continue;
			const a = cw[c] || 0;
			const b = nw ? (nw[c] || 0) : a;
			arkit[canon] = a + (b - a) * blend;
		}
		// Upper-face emotion accents: max(), never add, so a brow A2F already
		// raised for this emotion is not raised twice.
		const face = this._emotion.sample(t, dt);
		for (const k in face) if (face[k] > (arkit[k] || 0)) arkit[k] = face[k];

		for (const bind of this._direct) {
			bind.mesh.morphTargetInfluences[bind.index] = arkit[bind.canonical] || 0;
		}
		for (const bind of this._expression) {
			let sum = 0;
			for (const name in bind.components) sum += (arkit[name] || 0) * bind.components[name];
			bind.mesh.morphTargetInfluences[bind.index] = clamp01(sum / bind.denom);
		}
		this._emotion.applyRig(arkit, dt);
	}

	/**
	 * Last sampled weight for a canonical ARKit shape (e.g. 'jawOpen') — for live
	 * activity meters / diagnostics. Returns 0 before the first update().
	 * @param {string} canonical
	 */
	currentWeight(canonical) {
		return (this._arkit && this._arkit[canonical]) || 0;
	}

	/** Settle every bound morph to rest. Call when playback ends/stops. */
	reset() {
		for (const bind of this._direct) {
			if (bind.mesh.morphTargetInfluences) bind.mesh.morphTargetInfluences[bind.index] = 0;
		}
		for (const bind of this._expression) {
			if (bind.mesh.morphTargetInfluences) bind.mesh.morphTargetInfluences[bind.index] = 0;
		}
		this._emotion.release();
		this._cursor = 0;
		this._lastTime = -1;
	}

	dispose() {
		this.reset();
		this._direct = [];
		this._expression = [];
		this._track = null;
		this._attached = false;
	}
}

function clamp01(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}

// Pure helper exported for tests: derive an expression morph's activation from a
// canonical ARKit frame given its component weights (the inverse of the
// VRM/Oculus→ARKit maps).
export function deriveExpressionWeight(arkitFrame, components) {
	let sum = 0;
	let denom = 0;
	for (const name in components) {
		const w = components[name];
		denom += w;
		sum += (arkitFrame[name] || 0) * w;
	}
	return denom > 0 ? clamp01(sum / denom) : 0;
}

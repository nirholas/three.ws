// SceneController — wraps a Viewer instance with the scene-tool API the runtime
// and skills expect (playClipByName, lookAt, setExpression, loadClip, loadGLB).
//
// Keeps viewer.js untouched while giving agents a coherent control surface.

import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveURI } from '../ipfs.js';
import { resolveSlot } from './animation-slots.js';

const EXPRESSION_MAP = {
	neutral: { /* reset all */ },
	happy: { mouthSmile: 1, browInnerUp: 0.3, cheekSquintL: 0.4, cheekSquintR: 0.4 },
	sad: { mouthFrownL: 0.8, mouthFrownR: 0.8, browDownL: 0.6, browDownR: 0.6 },
	surprised: { jawOpen: 0.5, eyeWideL: 0.8, eyeWideR: 0.8, browInnerUp: 0.9 },
	confused: { browInnerUp: 0.5, browOuterUpL: 0.4, mouthPressL: 0.3, mouthPressR: 0.3 },
	focused: { browDownL: 0.4, browDownR: 0.4, eyeSquintL: 0.3, eyeSquintR: 0.3 },
};

export class SceneController {
	constructor(viewer) {
		this.viewer = viewer;
		this._loader = new GLTFLoader();
		this._userTarget = new Vector3(0, 1.6, 2); // approx user head position
		this._animationMap = {};
	}

	// Expose the underlying Three.js handles skills may need
	get scene() { return this.viewer.scene; }
	get mixer() { return this.viewer.mixer; }
	get clips() { return this.viewer.clips || []; }
	get content() { return this.viewer.content; }

	/**
	 * Set the agent's animation slot override map (from meta.edits.animations).
	 * @param {Object|null} map — { slotName: clipName, … }
	 */
	setAnimationMap(map) {
		this._animationMap = map || {};
	}

	/**
	 * Resolve a slot name (e.g. 'celebrate') to the actual clip name.
	 * Falls back to DEFAULT_ANIMATION_MAP, then the slot name itself.
	 * @param {string} name
	 * @returns {string}
	 */
	resolveAnimationSlot(name) {
		return resolveSlot(name, this._animationMap);
	}

	// Delegate raw load for ad-hoc cases
	async load(url, rootPath = '', assetMap = new Map()) {
		return this.viewer.load(url, rootPath, assetMap);
	}

	// --- Animation ---

	playClipByName(name, { loop = false, fade_ms = 200 } = {}) {
		// Try embedded clips (viewer.clips / viewer.mixer) first
		const clip = this._findClip(name);
		if (clip && this.viewer.mixer) {
			const action = this.viewer.mixer.clipAction(clip);
			action.reset();
			action.setLoop(loop ? 2201 /* LoopRepeat */ : 2200 /* LoopOnce */);
			action.clampWhenFinished = !loop;
			action.fadeIn(fade_ms / 1000);
			action.play();
			this.viewer.state.actionStates[clip.name] = true;
			this.viewer.invalidate();
			return true;
		}
		// Fall back to animation manager (external clips from manifest)
		const am = this.viewer?.animationManager;
		if (!am?.isLoaded(name)) return false;
		if (loop) am.crossfadeTo(name, fade_ms / 1000);
		else am.play(name);
		return true;
	}

	playAnimationByHint(hint, opts) {
		const lower = hint.toLowerCase();
		// Search embedded clips
		const match = this.clips.find((c) => c.name.toLowerCase().includes(lower));
		if (match) return this.playClipByName(match.name, opts);
		// Search external clips in animation manager
		const am = this.viewer?.animationManager;
		if (am) {
			for (const name of am.clips.keys()) {
				if (name.toLowerCase().includes(lower)) {
					return this.playClipByName(name, opts);
				}
			}
		}
		return false;
	}

	stopClip(name) {
		if (!this.viewer.mixer) return;
		const clip = name ? this._findClip(name) : null;
		if (clip) {
			const action = this.viewer.mixer.existingAction(clip);
			if (action) action.fadeOut(0.2);
			this.viewer.state.actionStates[clip.name] = false;
		} else {
			this.viewer.mixer.stopAllAction();
			for (const k in this.viewer.state.actionStates) this.viewer.state.actionStates[k] = false;
		}
		this.viewer.invalidate();
	}

	async play(clip, opts) {
		// Accept either a clip name or an AnimationClip instance.
		if (typeof clip === 'string') return this.playClipByName(clip, opts);
		if (!this.viewer.mixer || !clip) return false;
		const action = this.viewer.mixer.clipAction(clip);
		action.reset();
		action.fadeIn((opts?.blend ?? 0.2));
		action.play();
		this.viewer.invalidate();
		return true;
	}

	async loadClip(uri) {
		const resolved = resolveURI(uri);
		return new Promise((resolve, reject) => {
			this._loader.load(
				resolved,
				(gltf) => resolve(gltf.animations?.[0] || null),
				undefined,
				reject,
			);
		});
	}

	async loadGLB(uri) {
		const resolved = resolveURI(uri);
		return new Promise((resolve, reject) => {
			this._loader.load(resolved, resolve, undefined, reject);
		});
	}

	// --- Gaze ---

	lookAt(target) {
		const t = this._resolveTarget(target);
		if (!t || !this.viewer.content) return;
		// Simple head-bone gaze if rig has Head, otherwise root rotation.
		const head = this._findBone(['Head', 'head', 'mixamorigHead']);
		if (head) {
			head.lookAt(t);
		} else {
			this.viewer.content.lookAt(t.x, this.viewer.content.position.y, t.z);
		}
		this.viewer.invalidate();
	}

	_resolveTarget(target) {
		if (target instanceof Vector3) return target;
		if (target === 'camera') return this.viewer.activeCamera.position.clone();
		if (target === 'center') return new Vector3(0, 1, 0);
		if (target === 'user') {
			// In WebXR, track the live XR camera position so lookAt('user') follows the wearer
			if (this.viewer.renderer?.xr?.isPresenting) {
				return this.viewer.renderer.xr.getCamera().position.clone();
			}
			return this._userTarget.clone();
		}
		return null;
	}

	_findBone(names) {
		if (!this.viewer.content) return null;
		let found = null;
		this.viewer.content.traverse((n) => {
			if (found) return;
			if (n.isBone && names.includes(n.name)) found = n;
		});
		return found;
	}

	// --- Expression (morph targets) ---

	setExpression(preset, intensity = 1) {
		const influences = EXPRESSION_MAP[preset] || EXPRESSION_MAP.neutral;
		if (!this.viewer.content) return;
		this.viewer.content.traverse((mesh) => {
			if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
			// Reset all first
			for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
				mesh.morphTargetInfluences[i] = 0;
			}
			// Apply preset influences by morph target name
			for (const [morphName, value] of Object.entries(influences)) {
				const idx = mesh.morphTargetDictionary[morphName];
				if (idx !== undefined) {
					mesh.morphTargetInfluences[idx] = value * intensity;
				}
			}
		});
		this.viewer.invalidate();
	}

	// --- Movement ---

	moveTo(position, { duration = 600 } = {}) {
		if (!this.viewer.content) return;
		const start = this.viewer.content.position.clone();
		const end = new Vector3(position.x || 0, position.y || start.y, position.z || 0);
		const startT = performance.now();
		const tick = (dt) => {
			const elapsed = performance.now() - startT;
			const t = Math.min(elapsed / duration, 1);
			const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
			this.viewer.content.position.lerpVectors(start, end, eased);
			this.viewer.invalidate();
			if (t >= 1) this._removeHook(tick);
		};
		this._addHook(tick);
	}

	// --- Per-frame hooks (uses Viewer._afterAnimateHooks extension point) ---

	_addHook(fn) {
		if (!this.viewer._afterAnimateHooks) this.viewer._afterAnimateHooks = [];
		this.viewer._afterAnimateHooks.push(fn);
		this.viewer._animating = true;
		this.viewer.invalidate();
	}

	_removeHook(fn) {
		const hooks = this.viewer._afterAnimateHooks;
		if (!hooks) return;
		const i = hooks.indexOf(fn);
		if (i >= 0) hooks.splice(i, 1);
	}

	// --- Helpers ---

	_findClip(name) {
		if (!this.clips.length) return null;
		const exact = this.clips.find((c) => c.name === name);
		if (exact) return exact;
		const ci = name.toLowerCase();
		return this.clips.find((c) => c.name.toLowerCase() === ci)
			|| this.clips.find((c) => c.name.toLowerCase().includes(ci));
	}
}

/**
 * The review stage's 3D surface: the three.ws kiosk Viewer plus the few hooks
 * the meeting needs. These are reading and setting the orbit camera,
 * raycasting a click or pointer onto the mesh in model space, projecting
 * model-space points to the screen every frame (pins and lasers), and driving
 * one clip at an exact time so every participant sees the same frame.
 */

import { Raycaster, Vector2, Vector3 } from 'three';
import { Viewer } from '../viewer.js';
import { packPose, isPose } from './stage-model.js';

let manifestPromise = null;
function loadLibraryDefs() {
	manifestPromise ??= fetch('/animations/manifest.json')
		.then((r) => (r.ok ? r.json() : []))
		.catch(() => []);
	return manifestPromise;
}

export class StageViewer {
	/**
	 * @param {HTMLElement} el  container the canvas fills
	 * @param {{ onUserCamera?: (pose) => void, onUserCameraStart?: () => void, onFrame?: () => void }} hooks
	 */
	constructor(el, hooks = {}) {
		this.el = el;
		this.hooks = hooks;
		this.viewer = new Viewer(el, { kiosk: true });
		this.viewer.state.autoRotate = false;
		this.viewer.controls.enablePan = true;
		this.raycaster = new Raycaster();
		this.clipList = [];
		this.current = null;
		this._applying = false;
		this._userDriving = false;

		const controls = this.viewer.controls;
		controls.addEventListener('start', () => {
			this._userDriving = true;
			this.hooks.onUserCameraStart?.();
		});
		controls.addEventListener('end', () => {
			this._userDriving = false;
			this.hooks.onUserCamera?.(this.getPose());
		});
		controls.addEventListener('change', () => {
			if (this._applying || !this._userDriving) return;
			this.hooks.onUserCamera?.(this.getPose());
		});

		this.viewer._afterAnimateHooks ??= [];
		this.viewer._afterAnimateHooks.push(() => this.hooks.onFrame?.());
	}

	get canvas() {
		return this.viewer.renderer?.domElement;
	}

	/** Load a model; resolves with the clip list once the rig is ready. */
	async load(url) {
		this.stopClip();
		await this.viewer.load(url, '', new Map());
		// Kiosk load autoplays the first baked clip; playback belongs to the meeting.
		this.viewer.mixer?.stopAllAction();
		this.viewer.state.actionStates = {};
		this.current = null;
		this.clipList = (this.viewer.clips || []).map((clip, i) => ({
			id: `glb:${i}`,
			label: clip.name.replace(/^\d+\.\s*/, '') || `Clip ${i + 1}`,
			duration: clip.duration,
			loop: true,
			clip,
		}));
		const mgr = this.viewer.animationManager;
		if (mgr.supportsCanonicalClips?.()) {
			const defs = await loadLibraryDefs();
			if (Array.isArray(defs) && defs.length) {
				mgr.setAnimationDefs(defs);
				mgr.relaxUndrivenArms?.();
				for (const d of defs) {
					this.clipList.push({ id: `lib:${d.name}`, label: d.label || d.name, duration: d.duration || 0, loop: d.loop !== false, lib: d.name });
				}
			}
		}
		this.viewer.invalidate();
		return this.clipList;
	}

	getPose() {
		const cam = this.viewer.activeCamera || this.viewer.defaultCamera;
		return packPose(cam.position, this.viewer.controls.target);
	}

	setPose(pose) {
		if (!isPose(pose)) return;
		const cam = this.viewer.defaultCamera;
		this._applying = true;
		cam.position.fromArray(pose.p);
		this.viewer.controls.target.fromArray(pose.t);
		this.viewer.controls.update();
		this._applying = false;
		this.viewer.invalidate();
	}

	/** Raycast a client-space point onto the model. Returns model-space { position, normal } or null. */
	pick(clientX, clientY) {
		const content = this.viewer.content;
		const canvas = this.canvas;
		if (!content || !canvas) return null;
		const rect = canvas.getBoundingClientRect();
		const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		this.raycaster.setFromCamera(ndc, this.viewer.activeCamera);
		const hit = this.raycaster.intersectObject(content, true).find((h) => h.object.visible !== false && (h.object.isMesh || h.object.isSkinnedMesh));
		if (!hit) return null;
		const local = content.worldToLocal(hit.point.clone());
		let normal = null;
		if (hit.face) {
			const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
			const inv = content.matrixWorld.clone().invert();
			normal = n.transformDirection(inv).toArray();
		}
		return { position: local.toArray(), normal };
	}

	/** Model-space point to CSS pixels on the canvas (null when off-model or behind the camera). */
	project(localPoint) {
		const content = this.viewer.content;
		if (!content || !localPoint) return null;
		const world = content.localToWorld(new Vector3().fromArray(localPoint));
		const s = this.viewer.projectToScreen(world);
		if (!s || s.behindCamera) return null;
		return s;
	}

	/** Find the clip entry for an id on the loaded model. */
	clipById(id) {
		return this.clipList.find((c) => c.id === id) || null;
	}

	duration() {
		const a = this.current?.action;
		return a ? a.getClip().duration : this.current?.entry.duration || 0;
	}

	currentTime() {
		return this.current?.action?.time || 0;
	}

	/**
	 * Show a clip at a time, playing or paused. Re-applying the same clip only
	 * moves the playhead, so following a presenter never restarts the motion.
	 */
	async applyClip(id, { time = 0, playing = true, rate = 1 } = {}) {
		const entry = this.clipById(id);
		if (!entry) {
			this.stopClip();
			return false;
		}
		if (this.current?.entry.id !== id) {
			this.stopClip();
			let action = null;
			if (entry.clip) {
				action = this.viewer.mixer?.clipAction(entry.clip) || null;
				if (action) action.reset().play();
			} else if (entry.lib) {
				const mgr = this.viewer.animationManager;
				const ok = await mgr.play(entry.lib);
				action = ok ? mgr.currentAction : null;
			}
			if (!action) return false;
			this.current = { entry, action };
		}
		const { action } = this.current;
		const dur = action.getClip().duration || 0;
		const t = typeof time === 'function' ? time(dur) : time;
		action.time = dur > 0 ? Math.min(Math.max(t, 0), dur) : 0;
		action.setEffectiveTimeScale(rate);
		action.paused = !playing;
		if (entry.clip) this.viewer.state.actionStates = playing ? { [entry.clip.name]: true } : {};
		this.viewer._recomputeAnimating?.();
		this.viewer.invalidate();
		return true;
	}

	stopClip() {
		if (!this.current) return;
		const { action, entry } = this.current;
		if (entry.lib) this.viewer.animationManager.stopAll();
		else action.stop();
		this.viewer.state.actionStates = {};
		this.current = null;
		this.viewer._recomputeAnimating?.();
		this.viewer.invalidate();
	}

	resetCamera() {
		this.viewer.controls.reset();
		this.viewer.invalidate();
	}

	dispose() {
		this.viewer.dispose();
	}
}

// WebXR immersive-ar session controller.
//
// Reuses the element's existing Three.js renderer by enabling XR mode on start
// and restoring the RAF loop on end. Hit-test places the agent on tap.
//
// XR also enables half-body mode by scaling every lower-body bone (leg, foot,
// toe…) to zero, collapsing the corresponding skinned geometry to the bone's
// rest position. This mirrors what the half-body GLB variant does, but at
// runtime, without reloading the model — so the AgentAvatar empathy bindings
// and animation manager stay attached.

import { Matrix4, Vector3 } from 'three';

const LOWER_BODY_FRAGMENTS = [
	'upleg', 'leg', 'thigh', 'knee', 'shin', 'calf',
	'foot', 'toe', 'ankle',
];

function _normalizeBone(name) {
	return String(name || '')
		.toLowerCase()
		.replace(/^mixamorig:?_?/, '')
		.replace(/^cc_base_/, '')
		.replace(/^armature[:_|]/, '')
		.replace(/^rig[:_]/, '');
}

function _isLowerBody(name) {
	const norm = _normalizeBone(name);
	return LOWER_BODY_FRAGMENTS.some((f) => norm.includes(f));
}

export class WebXRSession {
	constructor(viewer, { onEnd } = {}) {
		this._viewer = viewer;
		this._onEnd = onEnd;
		this._session = null;
		this._hitTestSource = null;
		this._localSpace = null;
		this._anchored = false;
		this._userPosition = new Vector3();
		this._savedBg = null;
		this._savedPos = null;
		this._savedRot = null;
		/** @type {Array<{ bone: import('three').Bone, scale: Vector3 }>} */
		this._halfBodyBones = [];
		this._handleEnd = this._handleEnd.bind(this);
		this._handleSelect = this._handleSelect.bind(this);
	}

	static async isSupported() {
		try {
			return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')));
		} catch {
			return false;
		}
	}

	async start() {
		const viewer = this._viewer;
		const renderer = viewer.renderer;

		// Must be set before requestSession
		renderer.xr.enabled = true;

		const session = await navigator.xr.requestSession('immersive-ar', {
			requiredFeatures: ['hit-test'],
		});
		this._session = session;
		session.addEventListener('end', this._handleEnd);
		// 'select' fires on controller trigger or screen tap
		session.addEventListener('select', this._handleSelect);

		await renderer.xr.setSession(session);

		this._localSpace = await session.requestReferenceSpace('local');
		const viewerSpace = await session.requestReferenceSpace('viewer');
		this._hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

		// Transparent background — device camera provides the pass-through
		this._savedBg = viewer.scene.background;
		viewer.scene.background = null;
		renderer.setClearColor(0x000000, 0);

		// Save agent content transform for clean restoration on exit
		const content = viewer.content;
		this._savedPos = content?.position.clone() ?? null;
		this._savedRot = content?.rotation.clone() ?? null;

		// Collapse lower-body bones so the avatar reads as a half-body bust in
		// VR/AR — the user doesn't see their own legs in a passthrough rig.
		this._enterHalfBody();

		// Hand the render loop to the XR system (replaces RAF)
		if (viewer._rafId !== null) {
			cancelAnimationFrame(viewer._rafId);
			viewer._rafId = null;
		}
		viewer.controls.enabled = false;

		renderer.setAnimationLoop((time, frame) => this._tick(time, frame));
	}

	_tick(time, frame) {
		const viewer = this._viewer;
		const renderer = viewer.renderer;

		const dt = viewer.prevTime ? (time - viewer.prevTime) / 1000 : 0.016;
		viewer.prevTime = time;

		if (viewer.mixer) viewer.mixer.update(dt);
		viewer.animationManager.update(dt);

		// Empathy layer and any other per-frame hooks continue uninterrupted
		if (viewer._afterAnimateHooks) {
			for (const hook of viewer._afterAnimateHooks) hook(dt);
		}

		// Track user head position from the XR camera — used by lookAt('user')
		const xrCam = renderer.xr.getCamera();
		if (xrCam) this._userPosition.setFromMatrixPosition(xrCam.matrixWorld);

		// Follow hit-test surface until the agent is anchored by a tap
		if (!this._anchored && frame && this._hitTestSource) {
			const hits = frame.getHitTestResults(this._hitTestSource);
			if (hits.length > 0 && viewer.content) {
				const pose = hits[0].getPose(this._localSpace);
				if (pose) {
					viewer.content.position.setFromMatrixPosition(
						new Matrix4().fromArray(pose.transform.matrix),
					);
				}
			}
		}

		renderer.render(viewer.scene, viewer.activeCamera);
	}

	// First tap anchors the agent at the current hit-test position
	_handleSelect() {
		this._anchored = true;
	}

	// Returns the current XR camera (user head) position for lookAt('user')
	getUserPosition() {
		return this._userPosition.clone();
	}

	async end() {
		if (this._session) {
			try {
				await this._session.end();
			} catch {}
			// _handleEnd fires from the 'end' event
		}
	}

	_handleEnd() {
		const viewer = this._viewer;
		const renderer = viewer.renderer;

		renderer.setAnimationLoop(null);
		renderer.xr.enabled = false;

		if (this._hitTestSource) {
			try {
				this._hitTestSource.cancel();
			} catch {}
			this._hitTestSource = null;
		}
		this._session = null;
		this._anchored = false;

		// Restore background
		viewer.scene.background = this._savedBg;
		renderer.setClearColor(0x000000, 1);

		// Restore agent content to its pre-AR transform
		if (viewer.content && this._savedPos) viewer.content.position.copy(this._savedPos);
		if (viewer.content && this._savedRot) viewer.content.rotation.copy(this._savedRot);

		// Restore full-body bone scales captured at XR start.
		this._exitHalfBody();

		viewer.controls.enabled = true;
		viewer._needsRender = true;
		viewer._updateRenderLoop();

		this._onEnd?.();
	}

	// ── Half-body mode ────────────────────────────────────────────────────────

	_enterHalfBody() {
		const content = this._viewer.content;
		if (!content) return;
		this._halfBodyBones = [];

		content.traverse((obj) => {
			if (!obj.isSkinnedMesh || !obj.skeleton) return;
			for (const bone of obj.skeleton.bones || []) {
				if (!_isLowerBody(bone.name)) continue;
				// Each bone may appear in multiple meshes; only record it once.
				if (this._halfBodyBones.some((b) => b.bone === bone)) continue;
				this._halfBodyBones.push({ bone, scale: bone.scale.clone() });
				bone.scale.set(0.0001, 0.0001, 0.0001);
			}
		});
		// Skeleton matrices need a fresh update so the zero-scale propagates
		// to every dependent vertex on the next render.
		content.traverse((obj) => {
			if (obj.isSkinnedMesh && obj.skeleton) obj.skeleton.update();
		});
	}

	_exitHalfBody() {
		for (const { bone, scale } of this._halfBodyBones) {
			bone.scale.copy(scale);
		}
		this._halfBodyBones = [];
		const content = this._viewer.content;
		if (content) {
			content.traverse((obj) => {
				if (obj.isSkinnedMesh && obj.skeleton) obj.skeleton.update();
			});
		}
	}
}

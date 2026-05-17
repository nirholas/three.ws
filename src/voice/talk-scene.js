/**
 * TalkScene — minimal three.js renderer used during "Talk to avatar" mode.
 *
 * model-viewer 4.x doesn't expose its internal three.js scene as a stable API,
 * so we render the avatar ourselves whenever lipsync needs to drive morphs in
 * real time. The showcase view (rotation, environment lighting) is still
 * served by model-viewer when talk mode is inactive — this module mounts only
 * on demand and unmounts cleanly when talk mode ends.
 *
 * Public surface:
 *   const scene = new TalkScene();
 *   await scene.mount({ container, glbUrl });
 *   scene.attachMouthTarget(target);   // AvatarMouthTarget
 *   scene.playAnimation('Idle');       // optional, if the GLB has clips
 *   scene.unmount();
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class TalkScene {
	constructor() {
		this.container = null;
		this.renderer = null;
		this.scene = null;
		this.camera = null;
		this.controls = null;
		this.gltf = null;
		this.root = null;
		this.mixer = null;
		this._clips = [];
		this._currentAction = null;
		this._clock = new THREE.Clock();
		this._rafId = 0;
		this._running = false;
		this._resizeObserver = null;
		this._mouthTarget = null;
	}

	async mount({ container, glbUrl }) {
		if (!container) throw new Error('TalkScene.mount: container required');
		if (!glbUrl) throw new Error('TalkScene.mount: glbUrl required');
		this.container = container;

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.0;

		const { width, height } = sizeOf(container);
		this.renderer.setSize(width, height, false);
		this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
		container.appendChild(this.renderer.domElement);

		this.scene = new THREE.Scene();
		this.scene.background = null; // transparent so the page bg shows through

		// Image-based lighting via RoomEnvironment — same look-and-feel choice
		// model-viewer uses when no environment-image is set.
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

		// Fill + key + rim for visual depth.
		this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
		const key = new THREE.DirectionalLight(0xffffff, 1.4);
		key.position.set(2, 4, 3);
		this.scene.add(key);
		const rim = new THREE.DirectionalLight(0x90a0ff, 0.6);
		rim.position.set(-3, 2, -2);
		this.scene.add(rim);

		this.camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 100);
		this.camera.position.set(0, 1.55, 2.0);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.target.set(0, 1.4, 0);
		this.controls.minDistance = 0.5;
		this.controls.maxDistance = 6;
		this.controls.update();

		// Load the GLB.
		const loader = new GLTFLoader();
		const gltf = await new Promise((resolve, reject) => {
			loader.load(glbUrl, resolve, undefined, reject);
		});
		this.gltf = gltf;
		this.root = gltf.scene;
		this.scene.add(this.root);

		// Frame the avatar: aim the camera at its head (estimated as the top
		// 15% of the bounding box) and back off proportional to its height.
		this._frameAvatar();

		// If the GLB ships any animations, set up a mixer and remember the
		// clips so the caller can request one (e.g. 'Idle' for a base loop).
		if (gltf.animations?.length) {
			this.mixer = new THREE.AnimationMixer(this.root);
			this._clips = gltf.animations;
			// Auto-play an idle if one is present.
			const idle = gltf.animations.find((c) => /idle|breath/i.test(c.name));
			if (idle) this.playAnimation(idle.name);
		}

		this._installResizeObserver();
		this._start();
		return this.root;
	}

	attachMouthTarget(target) {
		this._mouthTarget = target;
		if (this.root) target.attach(this.root);
	}

	/** Play a clip by exact or fuzzy name. Returns true if a clip was started. */
	playAnimation(nameOrHint) {
		if (!this.mixer || !this._clips.length) return false;
		const hint = String(nameOrHint).toLowerCase();
		const clip =
			this._clips.find((c) => c.name === nameOrHint) ||
			this._clips.find((c) => c.name.toLowerCase().includes(hint));
		if (!clip) return false;
		const next = this.mixer.clipAction(clip);
		next.reset();
		next.fadeIn(0.25).play();
		if (this._currentAction && this._currentAction !== next) {
			this._currentAction.fadeOut(0.25);
		}
		this._currentAction = next;
		return true;
	}

	unmount() {
		this._running = false;
		if (this._rafId) cancelAnimationFrame(this._rafId);
		this._rafId = 0;

		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}

		if (this.controls) {
			this.controls.dispose();
			this.controls = null;
		}

		// Dispose GPU resources.
		if (this.root) {
			this.root.traverse((node) => {
				node.geometry?.dispose?.();
				const mats = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : [];
				for (const m of mats) {
					m.map?.dispose?.();
					m.normalMap?.dispose?.();
					m.roughnessMap?.dispose?.();
					m.metalnessMap?.dispose?.();
					m.emissiveMap?.dispose?.();
					m.dispose?.();
				}
			});
		}

		this.scene?.environment?.dispose?.();
		this.renderer?.dispose?.();

		if (this.renderer?.domElement && this.renderer.domElement.parentNode === this.container) {
			this.container.removeChild(this.renderer.domElement);
		}

		this.renderer = null;
		this.scene = null;
		this.camera = null;
		this.root = null;
		this.gltf = null;
		this.mixer = null;
		this._clips = [];
		this._currentAction = null;
		this._mouthTarget = null;
	}

	// ── internals ────────────────────────────────────────────────────────

	_frameAvatar() {
		if (!this.root || !this.camera || !this.controls) return;
		const box = new THREE.Box3().setFromObject(this.root);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		// Aim slightly above the model center — closer to the face on a humanoid.
		const headY = center.y + size.y * 0.32;
		this.controls.target.set(center.x, headY, center.z);
		// Pull the camera back proportionally to the model height; keep a
		// portrait-friendly framing (slightly above the head, slightly forward).
		const dist = Math.max(0.7, size.y * 1.05);
		this.camera.position.set(center.x, headY + size.y * 0.05, center.z + dist);
		this.controls.update();
	}

	_installResizeObserver() {
		if (typeof ResizeObserver === 'undefined') return;
		this._resizeObserver = new ResizeObserver(() => {
			if (!this.renderer || !this.camera) return;
			const { width, height } = sizeOf(this.container);
			if (width === 0 || height === 0) return;
			this.renderer.setSize(width, height, false);
			this.camera.aspect = width / height;
			this.camera.updateProjectionMatrix();
		});
		this._resizeObserver.observe(this.container);
	}

	_start() {
		if (this._running) return;
		this._running = true;
		const tick = () => {
			if (!this._running) return;
			const dt = this._clock.getDelta();
			this.controls?.update();
			this.mixer?.update(dt);
			this.renderer?.render(this.scene, this.camera);
			this._rafId = requestAnimationFrame(tick);
		};
		this._rafId = requestAnimationFrame(tick);
	}
}

function sizeOf(el) {
	const rect = el.getBoundingClientRect();
	return {
		width: Math.max(1, Math.floor(rect.width)),
		height: Math.max(1, Math.floor(rect.height)),
	};
}

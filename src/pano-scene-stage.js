// PanoSceneStage: stand inside a depth shell (the GLB /api/pano-scene returns).
//
// The camera sits at the origin of a metric, textured shell and looks around
// with a drag, the arrow or WASD keys, or the phone's gyroscope. "Step" slides
// the camera a little off-centre so the depth shows as parallax. The shell is
// shown unlit: its texture already carries the photo's own light.

import {
	Scene,
	PerspectiveCamera,
	WebGLRenderer,
	Mesh,
	MeshBasicMaterial,
	DoubleSide,
	SRGBColorSpace,
	NoToneMapping,
	Quaternion,
	Euler,
	Color,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getMeshoptDecoder } from './viewer/internal.js';
import { clampOffset, deviceQuaternion, walkRadius } from './pano-scene-core.js';

const DRAG_SPEED = 0.0042;
const KEY_SPEED_MPS = 0.9;
const STEP_FRACTION = 0.8;
const MAX_PITCH = Math.PI / 2 - 0.02;

export class PanoSceneStage {
	constructor(host) {
		this.host = host;
		this._disposed = false;
		this._yaw = 0;
		this._pitch = 0;
		this._offset = { x: 0, z: 0 };
		this._target = { x: 0, z: 0 };
		this._radius = 1;
		this._stepped = false;
		this._keys = new Set();
		this._gyro = null;
		this._gyroBase = null;
		this._drag = null;
		this._last = performance.now();
		this._raf = 0;
		this._shell = null;
		this._euler = new Euler(0, 0, 0, 'YXZ');
		this._quat = new Quaternion();

		this.scene = new Scene();
		this.scene.background = new Color('#0a0a0a');
		this.camera = new PerspectiveCamera(75, 1, 0.01, 500);

		this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
		this.renderer.outputColorSpace = SRGBColorSpace;
		this.renderer.toneMapping = NoToneMapping;
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		const canvas = this.renderer.domElement;
		canvas.tabIndex = 0;
		canvas.setAttribute('aria-label', 'Your 360 photo as a 3D scene. Drag to look around, W A S D to move, arrow keys to turn.');
		canvas.style.touchAction = 'none';
		canvas.style.cursor = 'grab';
		host.appendChild(canvas);

		this._onDown = (e) => {
			this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
			canvas.setPointerCapture?.(e.pointerId);
			canvas.style.cursor = 'grabbing';
		};
		this._onMove = (e) => {
			if (!this._drag || e.pointerId !== this._drag.id) return;
			const dx = e.clientX - this._drag.x;
			const dy = e.clientY - this._drag.y;
			this._drag.x = e.clientX;
			this._drag.y = e.clientY;
			this._yaw += dx * DRAG_SPEED;
			this._pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this._pitch + dy * DRAG_SPEED));
			this.invalidate();
		};
		this._onUp = (e) => {
			if (this._drag && e.pointerId === this._drag.id) this._drag = null;
			canvas.style.cursor = 'grab';
		};
		this._onKeyDown = (e) => {
			const k = e.key.toLowerCase();
			if ('wasd'.includes(k) && k.length === 1) this._keys.add(k);
			else if (k.startsWith('arrow')) this._keys.add(k);
			else return;
			e.preventDefault();
			this.invalidate();
		};
		this._onKeyUp = (e) => this._keys.delete(e.key.toLowerCase());
		this._onBlur = () => this._keys.clear();
		this._onOrientation = (e) => {
			if (e.alpha == null && e.beta == null) return;
			this._gyro = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
			this.invalidate();
		};
		canvas.addEventListener('pointerdown', this._onDown);
		canvas.addEventListener('pointermove', this._onMove);
		canvas.addEventListener('pointerup', this._onUp);
		canvas.addEventListener('pointercancel', this._onUp);
		canvas.addEventListener('keydown', this._onKeyDown);
		canvas.addEventListener('keyup', this._onKeyUp);
		canvas.addEventListener('blur', this._onBlur);

		this._ro = new ResizeObserver(() => this._resize());
		this._ro.observe(host);
		this._resize();
	}

	/** Load the GLB and stand inside it. Resolves with the shell's face count. */
	async load(url, { medianDepthM = null } = {}) {
		const loader = new GLTFLoader();
		loader.setMeshoptDecoder(await getMeshoptDecoder());
		const gltf = await loader.loadAsync(url);
		if (this._disposed) return { faces: 0 };
		let faces = 0;
		gltf.scene.traverse((node) => {
			if (!node.isMesh) return;
			const old = node.material;
			node.material = new MeshBasicMaterial({
				map: old.map || null,
				color: old.map ? 0xffffff : old.color || 0xffffff,
				vertexColors: Boolean(node.geometry.getAttribute('color')),
				side: DoubleSide,
			});
			if (node.material.map) node.material.map.colorSpace = SRGBColorSpace;
			old.dispose?.();
			node.frustumCulled = false;
			const idx = node.geometry.index;
			faces += idx ? idx.count / 3 : node.geometry.getAttribute('position').count / 3;
		});
		if (this._shell) this.scene.remove(this._shell);
		this._shell = gltf.scene;
		this.scene.add(this._shell);
		this.setMedianDepth(medianDepthM);
		this.invalidate();
		return { faces: Math.round(faces) };
	}

	setMedianDepth(m) {
		this._radius = walkRadius(m);
	}

	get radius() {
		return this._radius;
	}

	get stepped() {
		return this._stepped;
	}

	/** Slide off-centre and back. Returns the new state. */
	toggleStep() {
		this._stepped = !this._stepped;
		this._target = this._stepped ? { x: this._radius * STEP_FRACTION, z: 0 } : { x: 0, z: 0 };
		this.invalidate();
		return this._stepped;
	}

	recenter() {
		this._yaw = 0;
		this._pitch = 0;
		this._stepped = false;
		this._target = { x: 0, z: 0 };
		this._gyroBase = this._gyro ? { ...this._gyro } : null;
		this.invalidate();
	}

	get gyroActive() {
		return this._gyro != null;
	}

	/** Turn the gyroscope on. iOS needs the permission prompt from a tap. */
	async enableGyro() {
		const DOE = window.DeviceOrientationEvent;
		if (!DOE) return { ok: false, reason: 'unsupported' };
		if (typeof DOE.requestPermission === 'function') {
			const answer = await DOE.requestPermission().catch(() => 'denied');
			if (answer !== 'granted') return { ok: false, reason: 'denied' };
		}
		window.addEventListener('deviceorientation', this._onOrientation);
		const first = await new Promise((resolve) => {
			const t = setTimeout(() => resolve(false), 1500);
			const probe = (e) => {
				if (e.alpha == null && e.beta == null) return;
				clearTimeout(t);
				window.removeEventListener('deviceorientation', probe);
				resolve(true);
			};
			window.addEventListener('deviceorientation', probe);
		});
		if (!first) {
			window.removeEventListener('deviceorientation', this._onOrientation);
			return { ok: false, reason: 'no_sensor' };
		}
		this._yaw = 0;
		return { ok: true };
	}

	disableGyro() {
		window.removeEventListener('deviceorientation', this._onOrientation);
		this._gyro = null;
		this._gyroBase = null;
		this.invalidate();
	}

	screenshot() {
		this._render();
		return this.renderer.domElement.toDataURL('image/png');
	}

	invalidate() {
		if (this._raf || this._disposed) return;
		this._last = performance.now();
		this._raf = requestAnimationFrame((t) => this._tick(t));
	}

	_resize() {
		const w = Math.max(1, this.host.clientWidth);
		const h = Math.max(1, this.host.clientHeight);
		this.renderer.setSize(w, h, false);
		this.renderer.domElement.style.width = '100%';
		this.renderer.domElement.style.height = '100%';
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.invalidate();
	}

	_tick(now) {
		this._raf = 0;
		if (this._disposed) return;
		const dt = Math.min(0.1, Math.max(0, (now - this._last) / 1000));
		this._last = now;
		let moving = false;

		const turn = 1.8 * dt;
		if (this._keys.has('arrowleft')) { this._yaw += turn; moving = true; }
		if (this._keys.has('arrowright')) { this._yaw -= turn; moving = true; }
		if (this._keys.has('arrowup')) { this._pitch = Math.min(MAX_PITCH, this._pitch + turn); moving = true; }
		if (this._keys.has('arrowdown')) { this._pitch = Math.max(-MAX_PITCH, this._pitch - turn); moving = true; }

		// Keys steer the target; the camera eases toward it.
		const f = (this._keys.has('w') ? 1 : 0) - (this._keys.has('s') ? 1 : 0);
		const r = (this._keys.has('d') ? 1 : 0) - (this._keys.has('a') ? 1 : 0);
		if (f || r) {
			const sin = Math.sin(this._yaw), cos = Math.cos(this._yaw);
			// Facing -Z at yaw 0; yaw grows counter-clockwise seen from above.
			const fx = -sin, fz = -cos;
			const rx = cos, rz = -sin;
			this._target = clampOffset(
				this._target.x + (fx * f + rx * r) * KEY_SPEED_MPS * dt,
				this._target.z + (fz * f + rz * r) * KEY_SPEED_MPS * dt,
				this._radius,
			);
			this._stepped = Math.hypot(this._target.x, this._target.z) > 0.01;
			moving = true;
		}

		const k = 1 - Math.exp(-9 * dt);
		this._offset.x += (this._target.x - this._offset.x) * k;
		this._offset.z += (this._target.z - this._offset.z) * k;
		const settling = Math.hypot(this._target.x - this._offset.x, this._target.z - this._offset.z) > 0.0005;
		if (!settling) { this._offset.x = this._target.x; this._offset.z = this._target.z; }

		this._render();
		if (moving || settling || this._drag) this.invalidate();
	}

	_render() {
		this.camera.position.set(this._offset.x, 0, this._offset.z);
		this._euler.set(this._pitch, this._yaw, 0, 'YXZ');
		this._quat.setFromEuler(this._euler);
		if (this._gyro) {
			const base = this._gyroBase || { alpha: 0 };
			const q = deviceQuaternion(this._gyro.alpha - (base.alpha || 0), this._gyro.beta, this._gyro.gamma, screenAngle());
			this._quat.set(q[0], q[1], q[2], q[3]);
			this._quat.premultiply(new Quaternion().setFromEuler(new Euler(0, this._yaw, 0, 'YXZ')));
		}
		this.camera.quaternion.copy(this._quat);
		this.renderer.render(this.scene, this.camera);
	}

	dispose() {
		this._disposed = true;
		cancelAnimationFrame(this._raf);
		this._ro.disconnect();
		window.removeEventListener('deviceorientation', this._onOrientation);
		const c = this.renderer.domElement;
		c.removeEventListener('pointerdown', this._onDown);
		c.removeEventListener('pointermove', this._onMove);
		c.removeEventListener('pointerup', this._onUp);
		c.removeEventListener('pointercancel', this._onUp);
		c.removeEventListener('keydown', this._onKeyDown);
		c.removeEventListener('keyup', this._onKeyUp);
		c.removeEventListener('blur', this._onBlur);
		this._shell?.traverse((n) => {
			if (!n.isMesh) return;
			n.geometry?.dispose();
			n.material?.map?.dispose();
			n.material?.dispose();
		});
		this.renderer.dispose();
		c.remove();
	}
}

function screenAngle() {
	const a = screen.orientation?.angle;
	return Number.isFinite(a) ? a : window.orientation || 0;
}

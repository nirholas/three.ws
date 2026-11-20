// The 3D stage: a studio-lit three.js scene that loads one GLB at a time.
// GLTFLoader gets the meshopt and Draco decoders, because three.ws models
// and catalog assets may use either compression.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const IDLE_RESUME_MS = 4000;
const FIT_SIZE = 2;

function disposeTree(root) {
	root.traverse((node) => {
		if (node.geometry) node.geometry.dispose();
		const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
		for (const material of materials) {
			for (const value of Object.values(material)) if (value && value.isTexture) value.dispose();
			material.dispose();
		}
	});
}

/** Fetch with byte progress. onProgress(loaded, total|null). */
async function fetchBytes(url, { signal, onProgress }) {
	const res = await fetch(url, { signal, mode: 'cors' });
	if (!res.ok) throw new Error(`The model host answered HTTP ${res.status}.`);
	const total = Number.parseInt(res.headers.get('content-length') || '', 10) || null;
	if (!res.body) {
		const buffer = await res.arrayBuffer();
		onProgress(buffer.byteLength, total);
		return buffer;
	}
	const reader = res.body.getReader();
	const chunks = [];
	let loaded = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		chunks.push(value);
		loaded += value.byteLength;
		onProgress(loaded, total);
	}
	const bytes = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes.buffer;
}

export function createStage(canvas) {
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	const pmrem = new THREE.PMREMGenerator(renderer);
	const room = new RoomEnvironment();
	scene.environment = pmrem.fromScene(room, 0.04).texture;
	room.dispose?.();

	const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
	camera.position.set(2.6, 1.7, 3.4);

	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(3, 5, 2.5);
	key.castShadow = true;
	key.shadow.mapSize.set(1024, 1024);
	key.shadow.camera.near = 0.5;
	key.shadow.camera.far = 20;
	key.shadow.camera.left = -3;
	key.shadow.camera.right = 3;
	key.shadow.camera.top = 3;
	key.shadow.camera.bottom = -3;
	key.shadow.bias = -0.0005;
	scene.add(key);
	scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.35));

	const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.autoRotateSpeed = 1.2;
	controls.minDistance = 0.4;
	controls.maxDistance = 14;
	controls.target.set(0, 0.8, 0);

	let turntable = !reducedMotion;
	let idleTimer = 0;
	controls.autoRotate = turntable;
	controls.addEventListener('start', () => {
		controls.autoRotate = false;
		clearTimeout(idleTimer);
	});
	controls.addEventListener('end', () => {
		clearTimeout(idleTimer);
		if (turntable) idleTimer = setTimeout(() => (controls.autoRotate = true), IDLE_RESUME_MS);
	});

	const dracoLoader = new DRACOLoader().setDecoderPath('/vendor/three/examples/jsm/libs/draco/gltf/');
	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(dracoLoader);

	let current = null;
	let home = { position: camera.position.clone(), target: controls.target.clone() };
	let loadToken = 0;
	let abort = null;

	function resize() {
		const { clientWidth: w, clientHeight: h } = canvas;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}
	new ResizeObserver(resize).observe(canvas);
	resize();

	let running = true;
	renderer.setAnimationLoop(() => {
		if (!running) return;
		controls.update();
		renderer.render(scene, camera);
	});
	document.addEventListener('visibilitychange', () => {
		running = !document.hidden;
	});

	function frame(object) {
		const box = new THREE.Box3().setFromObject(object);
		const size = box.getSize(new THREE.Vector3());
		const largest = Math.max(size.x, size.y, size.z) || 1;
		const scale = FIT_SIZE / largest;
		object.scale.multiplyScalar(scale);
		box.setFromObject(object);
		const center = box.getCenter(new THREE.Vector3());
		object.position.x -= center.x;
		object.position.z -= center.z;
		object.position.y -= box.min.y;
		box.setFromObject(object);
		const fitted = box.getSize(new THREE.Vector3());
		const target = new THREE.Vector3(0, fitted.y / 2, 0);
		const radius = fitted.length() / 2;
		const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
		const direction = new THREE.Vector3(0.62, 0.38, 0.86).normalize();
		camera.position.copy(target).addScaledVector(direction, distance);
		camera.near = Math.max(0.01, distance / 100);
		camera.far = distance * 20;
		camera.updateProjectionMatrix();
		controls.target.copy(target);
		controls.update();
		home = { position: camera.position.clone(), target: target.clone() };
	}

	return {
		/**
		 * Load a GLB onto the stage. Resolves to { bytes, buffer } when it is
		 * showing; rejects with a readable Error. A newer load cancels an older one.
		 */
		async load(url, { onProgress = () => {} } = {}) {
			const token = ++loadToken;
			abort?.abort();
			abort = new AbortController();
			const buffer = await fetchBytes(url, { signal: abort.signal, onProgress });
			if (token !== loadToken) throw new DOMException('superseded', 'AbortError');
			const base = url.slice(0, url.lastIndexOf('/') + 1);
			const gltf = await loader.parseAsync(buffer, base);
			if (token !== loadToken) {
				disposeTree(gltf.scene);
				throw new DOMException('superseded', 'AbortError');
			}
			gltf.scene.traverse((node) => {
				if (node.isMesh) {
					node.castShadow = true;
					node.receiveShadow = true;
				}
			});
			if (current) {
				scene.remove(current);
				disposeTree(current);
			}
			current = gltf.scene;
			scene.add(current);
			frame(current);
			if (turntable) controls.autoRotate = true;
			return { buffer, bytes: buffer.byteLength };
		},
		cancel() {
			loadToken += 1;
			abort?.abort();
		},
		resetView() {
			camera.position.copy(home.position);
			controls.target.copy(home.target);
			controls.update();
		},
		setTurntable(on) {
			turntable = on;
			clearTimeout(idleTimer);
			controls.autoRotate = on;
		},
		get turntable() {
			return turntable;
		},
		/** Keyboard orbit and zoom for the focused canvas. Returns true when it handled the key. */
		handleKey(event) {
			const offset = camera.position.clone().sub(controls.target);
			const spherical = new THREE.Spherical().setFromVector3(offset);
			const step = THREE.MathUtils.degToRad(event.shiftKey ? 30 : 10);
			switch (event.key) {
				case 'ArrowLeft':
					spherical.theta -= step;
					break;
				case 'ArrowRight':
					spherical.theta += step;
					break;
				case 'ArrowUp':
					spherical.phi = Math.max(0.15, spherical.phi - step);
					break;
				case 'ArrowDown':
					spherical.phi = Math.min(Math.PI / 2 - 0.02, spherical.phi + step);
					break;
				case '+':
				case '=':
					spherical.radius = Math.max(controls.minDistance, spherical.radius * 0.85);
					break;
				case '-':
				case '_':
					spherical.radius = Math.min(controls.maxDistance, spherical.radius / 0.85);
					break;
				case 'Home':
				case '0':
					this.resetView();
					return true;
				default:
					return false;
			}
			controls.autoRotate = false;
			camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
			controls.update();
			return true;
		},
	};
}

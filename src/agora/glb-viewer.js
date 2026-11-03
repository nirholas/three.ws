// Agora — a tiny, self-contained GLB orbit viewer for a VERIFIED deliverable.
// It parses the exact bytes the verifier just hashed (no second fetch — what you
// see is provably what matched the on-chain proofHash) and renders them on a
// plinth you can orbit. Lazy-loaded by verify.js so the three.js + addons weight
// only lands when a model actually needs rendering.

import {
	Scene, PerspectiveCamera, WebGLRenderer, Box3, Vector3, Group,
	AmbientLight, DirectionalLight, HemisphereLight, Color,
	CylinderGeometry, MeshStandardMaterial, Mesh,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { meshoptReady, dracoLoader } from '../game/avatar-rig.js';
import { applyStudioLook, createRenderLoop } from '../render/index.js';

// Reuse the app-wide draco decoder (vendored at /three/draco/gltf/) and meshopt
// decoder so forge GLBs — which are often compressed — parse here too.
let _loader = null;
async function getLoader() {
	if (_loader) return _loader;
	const loader = new GLTFLoader();
	try { loader.setDRACOLoader(dracoLoader || new DRACOLoader().setDecoderPath('/three/draco/gltf/')); } catch { /* draco optional */ }
	try { const m = await meshoptReady; if (m) loader.setMeshoptDecoder(m); } catch { /* meshopt optional */ }
	_loader = loader;
	return loader;
}

// Parse `bytes` (Uint8Array of a .glb) and mount an orbiting preview into
// `container`. Returns a teardown handle ({ destroy }). Throws on parse failure
// so the caller can show an honest "could not render" note.
export default async function makeViewer(container, bytes) {
	const loader = await getLoader();
	const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
		? bytes.buffer
		: bytes.slice().buffer;

	const gltf = await new Promise((resolve, reject) => {
		loader.parse(buffer, '', resolve, reject);
	});

	const width = container.clientWidth || 320;
	const height = container.clientHeight || 220;

	const scene = new Scene();
	scene.background = new Color(0x0b0c10);

	const camera = new PerspectiveCamera(45, width / height, 0.01, 1000);

	const renderer = new WebGLRenderer({ antialias: true, alpha: false });
	renderer.setSize(width, height);
	const undoLook = applyStudioLook(renderer, scene, {
		toneMapping: 'aces',
		exposure: 1.0,
		environmentIntensity: 0.7,
	});
	container.replaceChildren(renderer.domElement);

	scene.add(new AmbientLight(0xc8d4e8, 0.35));
	const key = new DirectionalLight(0xffffff, 2.0);
	key.position.set(3, 5, 4);
	scene.add(key);
	scene.add(new HemisphereLight(0x9fbad8, 0x2a2f3a, 0.4));

	const root = new Group();
	const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
	if (!model) throw new Error('GLB contained no scene');
	model.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
	root.add(model);
	scene.add(root);

	// Frame the model: center it, scale to a unit-ish size, rest it on a plinth.
	const box = new Box3().setFromObject(model);
	const size = box.getSize(new Vector3());
	const center = box.getCenter(new Vector3());
	const maxDim = Math.max(size.x, size.y, size.z) || 1;
	const scale = 1.6 / maxDim;
	model.scale.setScalar(scale);
	model.position.sub(center.multiplyScalar(scale));
	// Drop onto the plinth top (y=0).
	const scaledBox = new Box3().setFromObject(model);
	model.position.y -= scaledBox.min.y;

	const plinth = new Mesh(
		new CylinderGeometry(1.1, 1.25, 0.12, 48),
		new MeshStandardMaterial({ color: 0x14161c, roughness: 0.85, metalness: 0.1 }),
	);
	plinth.position.y = -0.06;
	scene.add(plinth);

	camera.position.set(1.8, 1.5, 2.4);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.target.set(0, 0.8, 0);
	controls.minDistance = 1.2;
	controls.maxDistance = 8;
	controls.autoRotate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	controls.autoRotateSpeed = 1.1;
	controls.update();

	const loop = createRenderLoop({
		renderer,
		observe: container,
		frame: () => {
			controls.update();
			renderer.render(scene, camera);
		},
	});
	loop.start();

	const ro = new ResizeObserver(() => {
		const w = container.clientWidth || width;
		const hgt = container.clientHeight || height;
		renderer.setSize(w, hgt);
		camera.aspect = w / hgt;
		camera.updateProjectionMatrix();
	});
	ro.observe(container);

	let destroyed = false;
	const destroy = () => {
		if (destroyed) return;
		destroyed = true;
		loop.dispose();
		undoLook();
		ro.disconnect();
		controls.dispose();
		scene.traverse((n) => {
			if (n.isMesh) {
				n.geometry?.dispose?.();
				const mat = n.material;
				if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
				else mat?.dispose?.();
			}
		});
		renderer.dispose();
		// renderer.dispose() frees GL objects but not always the CONTEXT itself.
		// Each verified GLB spins up its own WebGLRenderer/context; browsers cap
		// live contexts (~16) and evict the oldest — which can be the main world's.
		// Force the context loss so verifying many deliverables in one session never
		// starves the Commons of its renderer.
		try { renderer.forceContextLoss(); } catch { /* not all backends support it */ }
		if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
		if (container._agoraViewerDestroy === destroy) delete container._agoraViewerDestroy;
	};
	container._agoraViewerDestroy = destroy;
	return { destroy };
}

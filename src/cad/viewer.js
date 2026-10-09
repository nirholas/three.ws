// CAD Forge viewer: a measured, engineering-style look at one part.
//
// CAD Forge GLBs are exported in metres at true scale with Z-up converted to
// glTF's Y-up, so the viewer never rescales the model: the grid is laid out in
// real millimetres and the dimension callouts read the kernel's exact extents
// (passed in by the caller) rather than the tessellated mesh's.
//
// Axis mapping (CAD → three): X → X, Y → -Z, Z → Y.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const FINISHES = Object.freeze({
	pla: { color: 0xd8dde6, metalness: 0.0, roughness: 0.62 },
	petg: { color: 0x9fd3e6, metalness: 0.0, roughness: 0.3 },
	nylon: { color: 0xece8de, metalness: 0.0, roughness: 0.85 },
	aluminum: { color: 0xc4cad3, metalness: 0.9, roughness: 0.32 },
	steel: { color: 0x9ea4ad, metalness: 0.95, roughness: 0.38 },
	brass: { color: 0xd6b35c, metalness: 0.95, roughness: 0.3 },
});

const EDGE_THRESHOLD_DEG = 24;

function niceStep(rawMm) {
	const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
	return steps.find((s) => s >= rawMm) || 1000;
}

function formatMm(mm) {
	if (mm >= 100) return `${mm.toFixed(0)} mm`;
	if (mm >= 10) return `${mm.toFixed(1)} mm`;
	return `${mm.toFixed(2)} mm`;
}

export function createCadViewer(container) {
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	container.appendChild(renderer.domElement);

	const overlay = document.createElement('div');
	overlay.className = 'cad-dims';
	overlay.setAttribute('aria-hidden', 'true');
	container.appendChild(overlay);

	const scene = new THREE.Scene();
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

	const camera = new THREE.PerspectiveCamera(35, 1, 0.0005, 100);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;

	const key = new THREE.DirectionalLight(0xffffff, 1.4);
	key.castShadow = true;
	key.shadow.mapSize.set(2048, 2048);
	scene.add(key, new THREE.HemisphereLight(0xffffff, 0x445066, 0.5));

	const stage = new THREE.Group();
	scene.add(stage);

	const loader = new GLTFLoader();
	const state = {
		part: null,
		edges: [],
		meshes: [],
		grid: null,
		shadow: null,
		dimsGroup: null,
		labels: [],
		showEdges: true,
		showDims: true,
		finish: 'pla',
		dirty: true,
		raf: 0,
		disposed: false,
	};

	const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x1a1f29, transparent: true, opacity: 0.85 });
	const dimMaterial = new THREE.LineDashedMaterial({ color: 0x5b8def, dashSize: 1, gapSize: 0.6, transparent: true, opacity: 0.9 });
	const partMaterial = new THREE.MeshStandardMaterial({ ...FINISHES.pla, side: THREE.DoubleSide });

	function clearStage() {
		for (const child of [...stage.children]) {
			stage.remove(child);
			child.traverse?.((o) => {
				if (o.geometry) o.geometry.dispose();
			});
		}
		overlay.replaceChildren();
		state.labels = [];
		state.edges = [];
		state.meshes = [];
	}

	function buildGrid(sizeX, sizeZ) {
		const spanMm = Math.max(sizeX, sizeZ) * 1000 * 1.8;
		const stepMm = niceStep(spanMm / 16);
		const cells = Math.max(8, Math.ceil(spanMm / stepMm));
		const extent = (cells * stepMm) / 1000;
		const grid = new THREE.GridHelper(extent, cells, 0x8a94a6, 0x8a94a6);
		grid.material.transparent = true;
		grid.material.opacity = 0.22;
		grid.position.y = 0.00002;
		const shadow = new THREE.Mesh(
			new THREE.PlaneGeometry(extent, extent),
			new THREE.ShadowMaterial({ opacity: 0.18 }),
		);
		shadow.rotation.x = -Math.PI / 2;
		shadow.receiveShadow = true;
		return { grid, shadow, stepMm };
	}

	function dimLine(a, b) {
		const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
		const line = new THREE.Line(geometry, dimMaterial);
		line.computeLineDistances();
		return line;
	}

	function buildDimensions(box, sizeMm) {
		const group = new THREE.Group();
		const pad = box.getSize(new THREE.Vector3()).length() * 0.06;
		const { min, max } = box;
		dimMaterial.dashSize = pad * 0.35;
		dimMaterial.gapSize = pad * 0.2;
		// Width along X at the front-bottom edge, depth along Z at the right-bottom
		// edge, height up the front-right corner. Labels sit at each midpoint.
		const specs = [
			{ a: new THREE.Vector3(min.x, min.y, max.z + pad), b: new THREE.Vector3(max.x, min.y, max.z + pad), mm: sizeMm[0], axis: 'X' },
			{ a: new THREE.Vector3(max.x + pad, min.y, min.z), b: new THREE.Vector3(max.x + pad, min.y, max.z), mm: sizeMm[1], axis: 'Y' },
			{ a: new THREE.Vector3(max.x + pad, min.y, max.z + pad), b: new THREE.Vector3(max.x + pad, max.y, max.z + pad), mm: sizeMm[2], axis: 'Z' },
		];
		for (const spec of specs) {
			group.add(dimLine(spec.a, spec.b));
			const label = document.createElement('span');
			label.className = `cad-dim cad-dim--${spec.axis.toLowerCase()}`;
			label.textContent = formatMm(spec.mm);
			overlay.appendChild(label);
			state.labels.push({ el: label, at: spec.a.clone().add(spec.b).multiplyScalar(0.5) });
		}
		return group;
	}

	function applyFinish() {
		const finish = FINISHES[state.finish] || FINISHES.pla;
		partMaterial.color.setHex(finish.color);
		partMaterial.metalness = finish.metalness;
		partMaterial.roughness = finish.roughness;
		partMaterial.needsUpdate = true;
		state.dirty = true;
	}

	function frame(box) {
		const sphere = box.getBoundingSphere(new THREE.Sphere());
		const radius = Math.max(sphere.radius, 0.001);
		const fov = THREE.MathUtils.degToRad(camera.fov);
		const distance = (radius / Math.sin(fov / 2)) * 1.25;
		const direction = new THREE.Vector3(1, 0.85, 1.25).normalize();
		controls.target.copy(sphere.center);
		camera.position.copy(sphere.center).addScaledVector(direction, distance);
		camera.near = distance / 200;
		camera.far = distance * 50;
		camera.updateProjectionMatrix();
		controls.minDistance = radius * 0.4;
		controls.maxDistance = distance * 6;
		key.position.copy(sphere.center).add(new THREE.Vector3(radius * 2, radius * 4, radius * 3));
		key.target.position.copy(sphere.center);
		key.shadow.camera.left = key.shadow.camera.bottom = -radius * 2;
		key.shadow.camera.right = key.shadow.camera.top = radius * 2;
		key.shadow.camera.near = radius * 0.1;
		key.shadow.camera.far = radius * 12;
		key.shadow.camera.updateProjectionMatrix();
		scene.add(key.target);
		controls.update();
	}

	function updateLabels() {
		if (!state.labels.length) return;
		const rect = renderer.domElement.getBoundingClientRect();
		const v = new THREE.Vector3();
		for (const { el, at } of state.labels) {
			v.copy(at).project(camera);
			const hidden = !state.showDims || v.z > 1;
			el.hidden = hidden;
			if (hidden) continue;
			el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * rect.width}px, ${((1 - v.y) / 2) * rect.height}px)`;
		}
	}

	function render() {
		renderer.render(scene, camera);
		updateLabels();
	}

	function tick() {
		state.raf = requestAnimationFrame(tick);
		const moved = controls.update();
		if (moved || state.dirty) {
			state.dirty = false;
			render();
		}
	}

	function resize() {
		const { clientWidth: w, clientHeight: h } = container;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		state.dirty = true;
	}

	const ro = new ResizeObserver(resize);
	ro.observe(container);
	controls.addEventListener('change', () => {
		state.dirty = true;
	});
	function onVisibility() {
		if (document.hidden) {
			cancelAnimationFrame(state.raf);
			state.raf = 0;
		} else if (!state.raf && !state.disposed) {
			state.dirty = true;
			tick();
		}
	}
	document.addEventListener('visibilitychange', onVisibility);
	resize();
	tick();

	return {
		/** Load a part. sizeMm is the kernel's exact [x, y, z] extent. */
		async load(glbUrl, sizeMm) {
			const gltf = await loader.loadAsync(glbUrl);
			clearStage();
			const part = gltf.scene;
			part.traverse((o) => {
				if (!o.isMesh) return;
				o.material = partMaterial;
				o.castShadow = true;
				o.receiveShadow = true;
				state.meshes.push(o);
			});
			stage.add(part);
			part.updateMatrixWorld(true);
			for (const mesh of state.meshes) {
				const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, EDGE_THRESHOLD_DEG), edgeMaterial);
				edges.matrixAutoUpdate = false;
				edges.matrix.copy(mesh.matrixWorld);
				edges.visible = state.showEdges;
				stage.add(edges);
				state.edges.push(edges);
			}
			const box = new THREE.Box3().setFromObject(part);
			const size = box.getSize(new THREE.Vector3());
			const { grid, shadow, stepMm } = buildGrid(size.x, size.z);
			grid.position.x = shadow.position.x = (box.min.x + box.max.x) / 2;
			grid.position.z = shadow.position.z = (box.min.z + box.max.z) / 2;
			grid.position.y = box.min.y + 0.00002;
			shadow.position.y = box.min.y;
			stage.add(grid, shadow);
			const dims = buildDimensions(box, sizeMm || [size.x * 1000, size.z * 1000, size.y * 1000]);
			dims.visible = state.showDims;
			stage.add(dims);
			state.dimsGroup = dims;
			const first = !state.part;
			state.part = part;
			if (first) frame(box);
			applyFinish();
			state.dirty = true;
			return { gridStepMm: stepMm };
		},
		reframe() {
			if (!state.part) return;
			frame(new THREE.Box3().setFromObject(state.part));
			state.dirty = true;
		},
		setEdges(on) {
			state.showEdges = Boolean(on);
			for (const e of state.edges) e.visible = state.showEdges;
			state.dirty = true;
		},
		setDimensions(on) {
			state.showDims = Boolean(on);
			if (state.dimsGroup) state.dimsGroup.visible = state.showDims;
			state.dirty = true;
		},
		setFinish(id) {
			state.finish = FINISHES[id] ? id : 'pla';
			applyFinish();
		},
		dispose() {
			state.disposed = true;
			cancelAnimationFrame(state.raf);
			document.removeEventListener('visibilitychange', onVisibility);
			ro.disconnect();
			clearStage();
			controls.dispose();
			pmrem.dispose();
			renderer.dispose();
			renderer.domElement.remove();
			overlay.remove();
		},
	};
}

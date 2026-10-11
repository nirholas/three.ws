// The Workbench 3D viewport: renderer, camera, fading floor grid, lighting,
// view modes (shaded, wireframe, normals, clay), turntable, framing,
// screenshot, and a bounded undo/redo stack over mesh geometry.
//
// three.js and its addons load lazily from mountViewport() so the workflow
// panel paints before the WebGL bundle arrives.

import { getDecoders } from '../viewer/internal.js';
import { collectMeshes, countScene } from './mesh-tools.js';

const HISTORY_LIMIT = 6;

const GRID_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
	vec4 w = modelMatrix * vec4(position, 1.0);
	vWorld = w.xyz;
	gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GRID_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uMinor;
uniform float uMajor;
uniform float uFade;
varying vec3 vWorld;
float gridLine(float size) {
	vec2 c = vWorld.xz / size;
	vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
	return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
	float minor = gridLine(uMinor) * 0.35;
	float major = gridLine(uMajor) * 0.7;
	float d = length(vWorld.xz - cameraPosition.xz);
	float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
	float a = max(minor, major) * fade;
	if (a <= 0.003) discard;
	gl_FragColor = vec4(uColor, a);
}`;

export async function mountViewport(container, { onStats, onHistory } = {}) {
	const [THREE, { OrbitControls }, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
		import('three'),
		import('three/addons/controls/OrbitControls.js'),
		import('three/addons/loaders/GLTFLoader.js'),
		import('three/addons/environments/RoomEnvironment.js'),
	]);

	const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	container.appendChild(renderer.domElement);
	renderer.domElement.setAttribute('aria-label', '3D viewport. Drag to orbit, scroll to zoom, right-drag to pan.');
	renderer.domElement.setAttribute('role', 'img');

	const scene = new THREE.Scene();
	const bg = getComputedStyle(container).getPropertyValue('--wb-viewport-bg').trim() || '#17171a';
	scene.background = new THREE.Color(bg);

	const pmrem = new THREE.PMREMGenerator(renderer);
	const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	scene.environment = envTexture;
	const key = new THREE.DirectionalLight(0xffffff, 1.4);
	key.position.set(3, 6, 4);
	scene.add(key, new THREE.HemisphereLight(0xffffff, 0x222233, 0.35));

	const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
	camera.position.set(2.6, 1.7, 3.4);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.autoRotateSpeed = 1.6;

	const grid = new THREE.Mesh(
		new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
		new THREE.ShaderMaterial({
			vertexShader: GRID_VERT,
			fragmentShader: GRID_FRAG,
			transparent: true,
			depthWrite: false,
			extensions: { derivatives: true },
			uniforms: {
				uColor: { value: new THREE.Color(0x8a8a99) },
				uMinor: { value: 0.25 },
				uMajor: { value: 1 },
				uFade: { value: 18 },
			},
		}),
	);
	grid.renderOrder = -1;
	scene.add(grid);

	const stage = new THREE.Group();
	scene.add(stage);

	let model = null;
	let mode = 'shaded';
	let originalMaterials = new Map();
	const overrideMaterials = {
		wireframe: new THREE.MeshBasicMaterial({ color: 0xb59cff, wireframe: true }),
		normals: new THREE.MeshNormalMaterial(),
		clay: new THREE.MeshStandardMaterial({ color: 0xbdbdc6, roughness: 0.85, metalness: 0 }),
	};
	const undoStack = [];
	const redoStack = [];

	const resize = () => {
		const w = container.clientWidth || 1;
		const h = container.clientHeight || 1;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	const ro = new ResizeObserver(resize);
	ro.observe(container);
	resize();

	let running = true;
	renderer.setAnimationLoop(() => {
		if (!running) return;
		controls.update();
		renderer.render(scene, camera);
	});

	const emitStats = () => onStats?.(model ? countScene(model) : null);
	const emitHistory = () => onHistory?.({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

	function frame() {
		if (!model) return;
		const box = new THREE.Box3().setFromObject(model);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const radius = Math.max(size.length() / 2, 0.001);
		const dist = radius / Math.sin((camera.fov * Math.PI) / 360);
		const dir = new THREE.Vector3(0.62, 0.42, 0.66).normalize();
		controls.target.copy(center);
		camera.position.copy(center).addScaledVector(dir, dist * 1.05);
		camera.near = dist / 200;
		camera.far = dist * 50;
		camera.updateProjectionMatrix();
		controls.update();
	}

	// Normalize any model to stand on the grid at roughly two units tall, so
	// the grid scale reads the same for a 2 cm scan and a 40 m building.
	function placeOnGrid(root) {
		const box = new THREE.Box3().setFromObject(root);
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z) || 1;
		const s = 2 / maxDim;
		root.scale.multiplyScalar(s);
		root.updateMatrixWorld(true);
		const placed = new THREE.Box3().setFromObject(root);
		const center = placed.getCenter(new THREE.Vector3());
		root.position.x -= center.x;
		root.position.z -= center.z;
		root.position.y -= placed.min.y;
	}

	function disposeObject(root) {
		const geos = new Set();
		const mats = new Set();
		root.traverse((o) => {
			if (o.geometry) geos.add(o.geometry);
			const m = o.material;
			if (Array.isArray(m)) m.forEach((x) => mats.add(x));
			else if (m) mats.add(m);
		});
		for (const m of originalMaterials.values()) {
			if (Array.isArray(m)) m.forEach((x) => mats.add(x));
			else mats.add(m);
		}
		geos.forEach((g) => g.dispose());
		for (const m of mats) {
			if (Object.values(overrideMaterials).includes(m)) continue;
			for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
			m.dispose();
		}
	}

	function clearHistory() {
		for (const snap of [...undoStack, ...redoStack]) snap.forEach((g) => g.dispose());
		undoStack.length = 0;
		redoStack.length = 0;
		emitHistory();
	}

	function setModel(root) {
		if (model) {
			applyMode('shaded');
			stage.remove(model);
			disposeObject(model);
		}
		clearHistory();
		originalMaterials = new Map();
		model = root;
		if (root) {
			placeOnGrid(root);
			stage.add(root);
			frame();
			applyMode(mode);
		}
		emitStats();
	}

	function applyMode(next) {
		mode = next;
		if (!model) return;
		for (const mesh of collectMeshes(model)) {
			if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, mesh.material);
			mesh.material = next === 'shaded' ? originalMaterials.get(mesh) : overrideMaterials[next];
		}
	}

	async function loadGLB(source) {
		const { dracoLoader, ktx2Loader, meshoptDecoder } = await getDecoders();
		const loader = new GLTFLoader()
			.setDRACOLoader(dracoLoader)
			.setKTX2Loader(ktx2Loader.detectSupport(renderer))
			.setMeshoptDecoder(meshoptDecoder);
		const gltf =
			typeof source === 'string'
				? await loader.loadAsync(source)
				: await loader.parseAsync(source, '');
		const root = gltf.scene || gltf.scenes?.[0];
		if (!root) throw new Error('The file has no scene to display.');
		setModel(root);
		return root;
	}

	async function loadFile(file) {
		const ext = (file.name.split('.').pop() || '').toLowerCase();
		const buf = await file.arrayBuffer();
		if (ext === 'glb' || ext === 'gltf') return loadGLB(buf);
		let root;
		if (ext === 'obj') {
			const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
			root = new OBJLoader().parse(new TextDecoder().decode(buf));
		} else if (ext === 'stl' || ext === 'ply') {
			const mod =
				ext === 'stl'
					? new (await import('three/addons/loaders/STLLoader.js')).STLLoader()
					: new (await import('three/addons/loaders/PLYLoader.js')).PLYLoader();
			const geometry = mod.parse(buf);
			if (!geometry.attributes.normal) geometry.computeVertexNormals();
			const material = new THREE.MeshStandardMaterial({
				color: 0xc9c9d2,
				roughness: 0.7,
				vertexColors: Boolean(geometry.attributes.color),
			});
			root = new THREE.Group();
			root.add(new THREE.Mesh(geometry, material));
		} else if (ext === 'fbx') {
			const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
			root = new FBXLoader().parse(buf, '');
		} else {
			throw new Error(`Unsupported file type ".${ext}". Use GLB, glTF, OBJ, STL, PLY or FBX.`);
		}
		setModel(root);
		return root;
	}

	function snapshot() {
		return new Map(collectMeshes(model).map((m) => [m, m.geometry.clone()]));
	}

	function restore(snap) {
		for (const [mesh, geometry] of snap) {
			mesh.geometry.dispose();
			mesh.geometry = geometry;
		}
	}

	/** Run a geometry-mutating operation with undo support. */
	async function mutate(op) {
		if (!model) throw new Error('Load or generate a model first.');
		const before = snapshot();
		try {
			const result = await op(model);
			undoStack.push(before);
			while (undoStack.length > HISTORY_LIMIT) undoStack.shift().forEach((g) => g.dispose());
			for (const snap of redoStack) snap.forEach((g) => g.dispose());
			redoStack.length = 0;
			emitHistory();
			emitStats();
			return result;
		} catch (err) {
			before.forEach((g) => g.dispose());
			throw err;
		}
	}

	function step(from, to) {
		if (!model || !from.length) return false;
		to.push(snapshot());
		restore(from.pop());
		emitHistory();
		emitStats();
		return true;
	}

	async function exportAs(format) {
		if (!model) throw new Error('Nothing to export yet.');
		applyMode('shaded');
		try {
			if (format === 'glb') {
				const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
				const ab = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true });
				return new Blob([ab], { type: 'model/gltf-binary' });
			}
			if (format === 'obj') {
				const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
				return new Blob([new OBJExporter().parse(model)], { type: 'text/plain' });
			}
			if (format === 'stl') {
				const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
				return new Blob([new STLExporter().parse(model, { binary: true })], { type: 'model/stl' });
			}
			if (format === 'ply') {
				const { PLYExporter } = await import('three/addons/exporters/PLYExporter.js');
				const ab = await new Promise((resolve) =>
					new PLYExporter().parse(model, resolve, { binary: true }),
				);
				return new Blob([ab], { type: 'application/octet-stream' });
			}
			throw new Error(`Unknown export format ${format}`);
		} finally {
			applyMode(mode);
		}
	}

	function screenshot() {
		renderer.render(scene, camera);
		return new Promise((resolve) => renderer.domElement.toBlob(resolve, 'image/png'));
	}

	return {
		THREE,
		get model() {
			return model;
		},
		get mode() {
			return mode;
		},
		loadGLB,
		loadFile,
		setModel,
		setMode: applyMode,
		frame,
		mutate,
		undo: () => step(undoStack, redoStack),
		redo: () => step(redoStack, undoStack),
		exportAs,
		screenshot,
		setGrid: (on) => (grid.visible = on),
		get gridVisible() {
			return grid.visible;
		},
		setEnvironment: (on) => {
			scene.environment = on ? envTexture : null;
		},
		get environmentOn() {
			return scene.environment !== null;
		},
		setAutoRotate: (on) => (controls.autoRotate = on),
		get autoRotate() {
			return controls.autoRotate;
		},
		/** Drop the model, its history and its GPU buffers. */
		free() {
			setModel(null);
			renderer.renderLists.dispose();
		},
		destroy() {
			running = false;
			renderer.setAnimationLoop(null);
			ro.disconnect();
			if (model) disposeObject(model);
			pmrem.dispose();
			envTexture.dispose();
			renderer.dispose();
		},
	};
}

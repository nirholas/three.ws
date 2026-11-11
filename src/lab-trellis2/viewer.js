// TRELLIS.2 lab: a GLB viewer with texture, wireframe and normal views.
//
// The GLB is fetched once as bytes, so the file size shown is the real payload
// and the download is a local blob of exactly what was inspected. Mesh stats
// (triangles, vertices, texture resolution) are read from the parsed scene,
// never from metadata. Renders on demand: a frame only when the camera moves,
// the view mode changes or the canvas resizes.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gltfLoader } from '../loaders/gltf.js';

export const VIEW_MODES = Object.freeze(['texture', 'wireframe', 'normal']);

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];

/** Mesh statistics read from a parsed glTF scene. */
export function sceneStats(root) {
	let triangles = 0;
	let vertices = 0;
	let meshes = 0;
	const textures = new Map();
	root.traverse((obj) => {
		if (!obj.isMesh || !obj.geometry) return;
		meshes++;
		const g = obj.geometry;
		const pos = g.attributes.position;
		if (pos) vertices += pos.count;
		triangles += g.index ? g.index.count / 3 : pos ? pos.count / 3 : 0;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const m of mats) {
			for (const slot of TEXTURE_SLOTS) {
				const tex = m?.[slot];
				const img = tex?.image;
				const w = img?.width || img?.videoWidth || 0;
				const h = img?.height || img?.videoHeight || 0;
				if (tex && w && h) textures.set(tex.uuid, { w, h });
			}
		}
	});
	let maxTexture = null;
	for (const t of textures.values()) {
		if (!maxTexture || t.w * t.h > maxTexture.w * maxTexture.h) maxTexture = t;
	}
	return { triangles: Math.round(triangles), vertices, meshes, textureCount: textures.size, maxTexture };
}

export class LabViewer {
	/** @param {HTMLElement} host */
	constructor(host) {
		this.host = host;
		this.mode = 'texture';
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.domElement.className = 'lt-canvas';
		this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D preview. Drag to orbit, scroll to zoom.');
		this.renderer.domElement.tabIndex = 0;
		host.append(this.renderer.domElement);

		this.scene = new THREE.Scene();
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
		pmrem.dispose();
		this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = false;
		this.controls.addEventListener('change', () => this.render());

		this.normalMaterial = new THREE.MeshNormalMaterial();
		this.wireMaterial = new THREE.MeshBasicMaterial({ color: 0x9aa4b2, wireframe: true });
		this.solidMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

		this.model = null;
		this.wireOverlay = null;
		this.originals = new Map();
		this.blobUrl = null;

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(host);
		this.resize();
	}

	resize() {
		const w = Math.max(1, this.host.clientWidth);
		const h = Math.max(1, this.host.clientHeight);
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.render();
	}

	render() {
		this.renderer.render(this.scene, this.camera);
	}

	/**
	 * Fetch and show a GLB. Resolves { stats, bytes, blobUrl }.
	 * @param {string} url
	 * @param {{ signal?: AbortSignal }} [opts]
	 */
	async load(url, { signal } = {}) {
		const res = await fetch(url, { signal });
		if (!res.ok) throw new Error(`The model file answered HTTP ${res.status}.`);
		const buffer = await res.arrayBuffer();
		const gltf = await new Promise((resolve, reject) => gltfLoader(this.renderer).parse(buffer, '', resolve, reject));
		this.clear();
		this.model = gltf.scene;
		this.model.traverse((o) => {
			if (o.isMesh) this.originals.set(o, o.material);
		});
		this.scene.add(this.model);
		this.frame();
		this.blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
		this.setMode(this.mode);
		return { stats: sceneStats(this.model), bytes: buffer.byteLength, blobUrl: this.blobUrl };
	}

	frame() {
		const box = new THREE.Box3().setFromObject(this.model);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
		const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360);
		this.camera.near = dist / 100;
		this.camera.far = dist * 100;
		this.camera.position.copy(center).add(new THREE.Vector3(0.6, 0.35, 1).normalize().multiplyScalar(dist * 1.1));
		this.camera.updateProjectionMatrix();
		this.controls.target.copy(center);
		this.controls.update();
	}

	/** @param {'texture'|'wireframe'|'normal'} mode */
	setMode(mode) {
		if (!VIEW_MODES.includes(mode)) return;
		this.mode = mode;
		if (!this.model) return;
		if (this.wireOverlay) {
			this.scene.remove(this.wireOverlay);
			this.wireOverlay = null;
		}
		for (const [mesh, original] of this.originals) {
			mesh.material = mode === 'texture' ? original : mode === 'normal' ? this.normalMaterial : this.solidMaterial;
		}
		if (mode === 'wireframe') {
			// A dark solid pass plus a line overlay reads as topology without the
			// back faces bleeding through.
			this.wireOverlay = this.model.clone(true);
			this.wireOverlay.traverse((o) => {
				if (o.isMesh) o.material = this.wireMaterial;
			});
			this.scene.add(this.wireOverlay);
		}
		this.render();
	}

	clear() {
		if (this.wireOverlay) this.scene.remove(this.wireOverlay);
		this.wireOverlay = null;
		if (this.model) {
			this.scene.remove(this.model);
			this.model.traverse((o) => {
				if (!o.isMesh) return;
				o.geometry?.dispose();
				const mats = Array.isArray(this.originals.get(o)) ? this.originals.get(o) : [this.originals.get(o)];
				for (const m of mats) {
					if (!m) continue;
					for (const slot of TEXTURE_SLOTS) m[slot]?.dispose?.();
					m.dispose?.();
				}
			});
		}
		this.model = null;
		this.originals.clear();
		if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
		this.blobUrl = null;
		this.render();
	}

	dispose() {
		this.clear();
		this.resizeObserver.disconnect();
		this.controls.dispose();
		this.normalMaterial.dispose();
		this.wireMaterial.dispose();
		this.solidMaterial.dispose();
		this.scene.environment?.dispose();
		this.renderer.dispose();
		this.renderer.domElement.remove();
	}
}

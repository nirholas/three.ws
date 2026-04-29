/**
 * Client-side GLB → PNG thumbnail renderer.
 *
 * ERC-8004's `image` field is for 2D ERC-721 marketplace compatibility
 * (OpenSea, wallets) which can't render GLB. When a user deploys a three.ws
 * without supplying a 2D poster, we render one from the GLB in an offscreen
 * canvas and pin it alongside the body.
 */

import {
	Scene,
	PerspectiveCamera,
	WebGLRenderer,
	HemisphereLight,
	DirectionalLight,
	Color,
	Box3,
	Vector3,
	SRGBColorSpace,
	ACESFilmicToneMapping,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Render a GLB/GLTF file to a PNG blob.
 *
 * @param {File|Blob} file      GLB/GLTF file
 * @param {object}    [opts]
 * @param {number}    [opts.size=512]
 * @param {string}    [opts.background='#1a1a1a']
 * @returns {Promise<Blob>}     PNG blob (has `.name = 'thumbnail.png'`)
 */
export async function glbFileToThumbnail(file, { size = 512, background = '#1a1a1a' } = {}) {
	const buffer = await file.arrayBuffer();
	const loader = new GLTFLoader();
	const gltf = await new Promise((resolve, reject) => {
		loader.parse(buffer, '', resolve, reject);
	});

	const scene = new Scene();
	scene.background = new Color(background);
	scene.add(gltf.scene);

	const box = new Box3().setFromObject(gltf.scene);
	const center = box.getCenter(new Vector3());
	const boxSize = box.getSize(new Vector3());
	const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z) || 1;

	const fov = 35;
	const camera = new PerspectiveCamera(fov, 1, 0.01, 1000);
	const dist = maxDim / (2 * Math.tan((Math.PI * fov) / 360));
	// Mixamo-style framing: eye-level, slightly above center, pulled back.
	camera.position.set(center.x, center.y + boxSize.y * 0.05, center.z + dist * 1.8);
	camera.lookAt(center.x, center.y, center.z);

	scene.add(new HemisphereLight(0xffffff, 0x444444, 2.0));
	const dir = new DirectionalLight(0xffffff, 2.5);
	dir.position.set(3, 10, 7);
	scene.add(dir);

	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
	renderer.setPixelRatio(1);
	renderer.setSize(size, size, false);
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;

	try {
		renderer.render(scene, camera);
		const blob = await new Promise((resolve, reject) => {
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
				'image/png',
			);
		});
		// File-like name so pinFile can label the upload.
		try {
			Object.defineProperty(blob, 'name', { value: 'thumbnail.png' });
		} catch {
			/* Blob is usually writable; ignore if not */
		}
		return blob;
	} finally {
		renderer.dispose();
		scene.traverse((obj) => {
			if (obj.geometry) obj.geometry.dispose?.();
			if (obj.material) {
				const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
				for (const m of mats) m.dispose?.();
			}
		});
	}
}

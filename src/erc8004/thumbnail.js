/**
 * Client-side GLB → image thumbnail renderer.
 *
 * ERC-8004's `image` field is for 2D ERC-721 marketplace compatibility
 * (OpenSea, wallets) which can't render GLB. When a user deploys a three.ws
 * without supplying a 2D poster, we render one from the GLB in an offscreen
 * canvas and pin it alongside the body. The account save flow (src/account.js)
 * uses the same renderer for the gallery thumbnail of every saved avatar.
 *
 * A humanoid is stood in the thumbnail rest pose first (src/thumbnail-pose.js,
 * the same posing the server renderers use), so a poster never shows the raw
 * bind pose with the arms straight out.
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
import { getDecoders } from '../viewer/internal.js';
import { applyThumbnailPose, sampleClipPose, THUMBNAIL_POSE_TIME, THUMBNAIL_POSE_URL } from '../thumbnail-pose.js';

let _poseClipPromise = null;

// The rest pose, fetched once per page from the motion library. A failed fetch
// is not cached, so the next thumbnail retries instead of rendering unposed for
// the rest of the session.
function loadPoseClip() {
	if (!_poseClipPromise) {
		_poseClipPromise = fetch(THUMBNAIL_POSE_URL)
			.then((res) => {
				if (!res.ok) throw new Error(`pose clip ${res.status}`);
				return res.json();
			})
			.then((json) => sampleClipPose(json, THUMBNAIL_POSE_TIME))
			.catch((err) => {
				_poseClipPromise = null;
				throw err;
			});
	}
	return _poseClipPromise;
}

/**
 * Render a GLB/GLTF file to an image blob.
 *
 * @param {File|Blob} file      GLB/GLTF file
 * @param {object}    [opts]
 * @param {number}    [opts.size=512]
 * @param {string}    [opts.background='#1a1a1a']
 * @param {string}    [opts.mimeType='image/png'] 'image/png' or 'image/jpeg'
 * @param {number}    [opts.quality=0.85] JPEG quality
 * @param {boolean}   [opts.pose=true] stand a humanoid in the rest pose
 * @returns {Promise<Blob>}     image blob (has `.name = 'thumbnail.png'` or `.jpg`)
 */
export async function glbFileToThumbnail(
	file,
	{ size = 512, background = '#1a1a1a', mimeType = 'image/png', quality = 0.85, pose = true } = {},
) {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(size, size, false);
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;

	const scene = new Scene();
	scene.background = new Color(background);
	try {
		const [buffer, { dracoLoader, ktx2Loader, meshoptDecoder }] = await Promise.all([
			file.arrayBuffer(),
			getDecoders(),
		]);
		// Saved avatars arrive Draco-, Meshopt- or KTX2-compressed depending on
		// which pipeline produced them, so register every decoder the viewer does.
		const loader = new GLTFLoader();
		loader.setDRACOLoader(dracoLoader);
		loader.setKTX2Loader(ktx2Loader.detectSupport(renderer));
		loader.setMeshoptDecoder(meshoptDecoder);
		const gltf = await new Promise((resolve, reject) => {
			loader.parse(buffer, '', resolve, reject);
		});
		scene.add(gltf.scene);

		// Posing is an improvement, never a requirement: if the clip cannot be
		// fetched the poster still renders, as authored.
		if (pose) {
			const clip = await loadPoseClip().catch(() => null);
			if (clip) await applyThumbnailPose(gltf.scene, clip);
		}

		return await renderPoster({ scene, root: gltf.scene, renderer, canvas, mimeType, quality });
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

async function renderPoster({ scene, root, renderer, canvas, mimeType, quality }) {
	const box = new Box3().setFromObject(root);
	const center = box.getCenter(new Vector3());
	const boxSize = box.getSize(new Vector3());
	const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z) || 1;

	const fov = 35;
	const camera = new PerspectiveCamera(fov, 1, 0.01, 1000);
	const dist = maxDim / (2 * Math.tan((Math.PI * fov) / 360));
	// Eye-level framing, slightly above center. The margin used to be 1.8x,
	// sized for a T-pose's arm span; a posed avatar stands well inside its own
	// height, so a tighter pull-back fills the card instead of floating in it.
	camera.position.set(center.x, center.y + boxSize.y * 0.05, center.z + boxSize.z / 2 + dist * 1.15);
	camera.lookAt(center.x, center.y, center.z);

	scene.add(new HemisphereLight(0xffffff, 0x444444, 2.0));
	const dir = new DirectionalLight(0xffffff, 2.5);
	dir.position.set(3, 10, 7);
	scene.add(dir);

	renderer.render(scene, camera);
	const blob = await new Promise((resolve, reject) => {
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
			mimeType,
			quality,
		);
	});
	// File-like name so pinFile can label the upload.
	try {
		Object.defineProperty(blob, 'name', { value: mimeType === 'image/jpeg' ? 'thumbnail.jpg' : 'thumbnail.png' });
	} catch {
		/* Blob is usually writable; ignore if not */
	}
	return blob;
}

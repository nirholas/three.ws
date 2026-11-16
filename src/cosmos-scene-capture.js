// Scene capture for /cosmos: turn the avatar on the stage into the conditioning
// a Cosmos 3 world is built from.
//
//   captureStill()    the avatar exactly as framed in <model-viewer>, composited
//                     over the stage backdrop at the output geometry. The worker
//                     uses it as frame 0 of an image-to-world clip.
//   recordControl()   a three.js render of the same avatar from the same camera,
//                     orbiting slowly while its first animation plays, recorded
//                     with MediaRecorder. "depth" renders a depth pass (near is
//                     bright, far is black, the convention Cosmos depth control
//                     expects); "edge" renders the lit avatar on flat grey so the
//                     worker's Canny pass finds clean silhouette and detail edges.
//
// Both return a data URL the API forwards untouched. MIME parameters (codecs=...)
// are dropped from the data URL: the worker accepts the bare container type.

const GEOMETRY = { 480: { width: 832, height: 480 }, 720: { width: 1280, height: 720 } };
const RECORD_SECONDS = 4;
const RECORD_FPS = 30;
const RECORD_BITRATE = 6_000_000;
const ORBIT_DEGREES = 40;
const STILL_QUALITY = 0.92;
const EDGE_BACKGROUND = 0x808080;

export function geometryFor(resolution) {
	return GEOMETRY[resolution] || GEOMETRY[720];
}

// MediaRecorder container support differs by browser: Chromium and Firefox record
// WebM, Safari records MP4. The first supported type wins.
export function pickRecorderType() {
	if (typeof MediaRecorder === 'undefined') return null;
	const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
	return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

export function sceneCaptureSupport() {
	const canvas = document.createElement('canvas');
	const webgl = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
	return {
		still: webgl,
		control: webgl && typeof canvas.captureStream === 'function' && Boolean(pickRecorderType()),
	};
}

function blobToDataUrl(blob, mime) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const raw = String(reader.result);
			const comma = raw.indexOf(',');
			resolve(`data:${mime};base64,${raw.slice(comma + 1)}`);
		};
		reader.onerror = () => reject(reader.error || new Error('could not read the capture'));
		reader.readAsDataURL(blob);
	});
}

function loadImage(blob) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => resolve({ img, url });
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('the avatar frame could not be decoded'));
		};
		img.src = url;
	});
}

// The stage backdrop when no world is playing: the same deep aurora the page
// shows, so the still reads as "the avatar in its scene", not a cut-out on white.
function paintAurora(ctx, width, height) {
	ctx.fillStyle = '#06070d';
	ctx.fillRect(0, 0, width, height);
	const glow = (x, y, r, color) => {
		const g = ctx.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, color);
		g.addColorStop(1, 'rgba(6,7,13,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, width, height);
	};
	glow(width * 0.22, height * 0.3, width * 0.55, 'rgba(118,224,194,0.32)');
	glow(width * 0.8, height * 0.25, width * 0.5, 'rgba(139,124,246,0.34)');
	glow(width * 0.5, height * 1.05, width * 0.6, 'rgba(60,90,190,0.30)');
}

// Draw the playing world frame as the backdrop when the browser lets us read it.
// A cross-origin clip without CORS taints the canvas; then the aurora stands in.
function paintWorld(ctx, video, width, height) {
	if (!video || video.readyState < 2 || !video.videoWidth) return false;
	const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
	const w = video.videoWidth * scale;
	const h = video.videoHeight * scale;
	ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
	try {
		ctx.getImageData(0, 0, 1, 1);
		return true;
	} catch {
		return false;
	}
}

export async function captureStill({ viewer, world, resolution }) {
	const { width, height } = geometryFor(resolution);
	if (!viewer?.loaded || typeof viewer.toBlob !== 'function') {
		throw new Error('The avatar is still loading. Capture again in a moment.');
	}
	const frame = await viewer.toBlob({ mimeType: 'image/png', idealAspect: false });
	const { img, url } = await loadImage(frame);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!paintWorld(ctx, world, width, height)) {
			ctx.clearRect(0, 0, width, height);
			paintAurora(ctx, width, height);
		}
		// Contain-fit the avatar frame so nothing of the framed avatar is cropped.
		const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
		const w = img.naturalWidth * scale;
		const h = img.naturalHeight * scale;
		ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
		const blob = await new Promise((resolve, reject) =>
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the still could not be encoded'))), 'image/jpeg', STILL_QUALITY),
		);
		return { kind: 'image', dataUrl: await blobToDataUrl(blob, 'image/jpeg'), previewUrl: URL.createObjectURL(blob), bytes: blob.size, width, height };
	} finally {
		URL.revokeObjectURL(url);
	}
}

// Read the live camera from <model-viewer> so the control render frames the
// avatar the way the user framed it on the stage.
function viewerCamera(viewer) {
	const orbit = viewer.getCameraOrbit?.();
	const fov = viewer.getFieldOfView?.();
	return {
		theta: Number.isFinite(orbit?.theta) ? orbit.theta : 0,
		phi: Number.isFinite(orbit?.phi) ? orbit.phi : (88 * Math.PI) / 180,
		radius: Number.isFinite(orbit?.radius) && orbit.radius > 0 ? orbit.radius : null,
		fov: Number.isFinite(fov) && fov > 0 ? fov : 32,
	};
}

async function loadAvatar(THREE, renderer, url) {
	const [{ GLTFLoader }, { getDecoders }] = await Promise.all([
		import('three/addons/loaders/GLTFLoader.js'),
		import('./viewer/internal.js'),
	]);
	const { dracoLoader, ktx2Loader, meshoptDecoder } = await getDecoders();
	ktx2Loader.detectSupport(renderer);
	const loader = new GLTFLoader().setDRACOLoader(dracoLoader).setKTX2Loader(ktx2Loader).setMeshoptDecoder(meshoptDecoder);
	return loader.loadAsync(url);
}

function disposeScene(root) {
	root.traverse((node) => {
		node.geometry?.dispose?.();
		const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
		for (const m of mats) {
			for (const value of Object.values(m)) if (value?.isTexture) value.dispose();
			m.dispose?.();
		}
	});
}

export async function recordControl({ viewer, avatarUrl, mode, resolution, onProgress }) {
	if (mode !== 'depth' && mode !== 'edge') throw new Error(`unknown control mode ${mode}`);
	const mime = pickRecorderType();
	if (!mime) throw new Error('This browser cannot record the scene. Use Text or Still mode, or try Chrome, Edge, Firefox or Safari.');
	const { width, height } = geometryFor(resolution);
	const THREE = await import('three');

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height, false);
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	let gltf;
	try {
		gltf = await loadAvatar(THREE, renderer, avatarUrl);
	} catch (err) {
		renderer.dispose();
		throw new Error(`The avatar model could not be loaded for recording (${err?.message || 'unknown error'}).`);
	}

	const scene = new THREE.Scene();
	const root = gltf.scene;
	scene.add(root);
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const center = box.getCenter(new THREE.Vector3());
	const sphere = box.getBoundingSphere(new THREE.Sphere());

	const cam = viewerCamera(viewer);
	const radius = cam.radius ?? sphere.radius * 2.4;
	const camera = new THREE.PerspectiveCamera(cam.fov, width / height, 0.01, 1000);

	if (mode === 'depth') {
		scene.background = new THREE.Color(0x000000);
		scene.overrideMaterial = new THREE.MeshDepthMaterial();
	} else {
		scene.background = new THREE.Color(EDGE_BACKGROUND);
		scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.4));
		const key = new THREE.DirectionalLight(0xffffff, 2.2);
		key.position.set(2, 4, 3);
		scene.add(key);
		const rim = new THREE.DirectionalLight(0xffffff, 1.0);
		rim.position.set(-3, 2, -2);
		scene.add(rim);
	}
	camera.updateProjectionMatrix();

	const mixer = gltf.animations?.length ? new THREE.AnimationMixer(root) : null;
	if (mixer) mixer.clipAction(gltf.animations[0]).play();

	const place = (t) => {
		const theta = cam.theta + ((ORBIT_DEGREES * Math.PI) / 180) * t;
		const s = Math.sin(cam.phi);
		camera.position.set(
			center.x + radius * s * Math.sin(theta),
			center.y + radius * Math.cos(cam.phi),
			center.z + radius * s * Math.cos(theta),
		);
		camera.lookAt(center);
		if (mode === 'depth') fitDepthRange();
	};

	// Depth: near and far hug the avatar's box from this exact viewpoint, so the
	// whole 0-1 range is spent on the body instead of empty air around it.
	const corners = [];
	for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
	const viewPoint = new THREE.Vector3();
	function fitDepthRange() {
		camera.updateMatrixWorld(true);
		let near = Infinity;
		let far = 0;
		for (const c of corners) {
			const d = -viewPoint.copy(c).applyMatrix4(camera.matrixWorldInverse).z;
			near = Math.min(near, d);
			far = Math.max(far, d);
		}
		camera.near = Math.max(0.01, near * 0.97);
		camera.far = Math.max(camera.near + 0.05, far * 1.01);
		camera.updateProjectionMatrix();
	}

	place(0);
	renderer.render(scene, camera);

	const stream = canvas.captureStream(RECORD_FPS);
	const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: RECORD_BITRATE });
	const chunks = [];
	recorder.ondataavailable = (e) => {
		if (e.data?.size) chunks.push(e.data);
	};
	const stopped = new Promise((resolve, reject) => {
		recorder.onstop = resolve;
		recorder.onerror = (e) => reject(e?.error || new Error('the recorder failed'));
	});

	const durationMs = RECORD_SECONDS * 1000;
	try {
		recorder.start(250);
		await new Promise((resolve) => {
			const start = performance.now();
			let last = start;
			const tick = (now) => {
				const elapsed = now - start;
				const t = Math.min(1, elapsed / durationMs);
				if (mixer) mixer.update((now - last) / 1000);
				last = now;
				place(t);
				renderer.render(scene, camera);
				onProgress?.(t);
				if (t < 1) requestAnimationFrame(tick);
				else resolve();
			};
			requestAnimationFrame(tick);
		});
		recorder.stop();
		await stopped;
	} finally {
		for (const track of stream.getTracks()) track.stop();
		disposeScene(root);
		scene.overrideMaterial?.dispose();
		renderer.dispose();
	}

	const container = mime.split(';')[0];
	const blob = new Blob(chunks, { type: container });
	if (!blob.size) throw new Error('The scene recording came out empty. Record it again.');
	return {
		kind: mode,
		dataUrl: await blobToDataUrl(blob, container),
		previewUrl: URL.createObjectURL(blob),
		bytes: blob.size,
		width,
		height,
	};
}

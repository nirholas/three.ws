// splat-stage: mount a Gaussian-splat scene into a DOM element.
//
// Shared by the Splat Viewer (`src/splat-viewer.js`) and the Forge Studio Lab
// (`src/forge-studio/lab/lab.js`), which need exactly the same thing: hand it an
// element and a buffer of splat bytes, get back an orbiting scene and a handle
// that tears itself down completely.
//
// It runs on Spark (`@sparkjsdev/spark`, MIT, World Labs). Spark renders splats
// as ordinary objects inside a normal three.js scene, which is what lets us
// frame the camera on the actual scene and, later, put splats and meshes in one
// stage. It also reads the compressed containers real captures ship as: .spz is
// about a tenth of the equivalent PLY and .sog about a fifteenth to a twentieth.
//
// Three behaviours here look like a broken page if you skip them, which is the
// reason this module exists instead of the same code twice:
//
//   1. The canvas must be OPAQUE. Spark accumulates colour with premultiplied
//      alpha and leaves destination alpha at zero, so on a transparent canvas
//      the browser composites a fully rendered scene away to nothing.
//   2. The camera must be framed in WORLD space. A loaded capture wears a
//      180-degree flip (3DGS files are authored Y-down), so framing the mesh's
//      own bounding box aims at the mirror image of where the scene is.
//   3. The first frame must be WAITED for. Spark sorts splats on a worker and
//      paints once that lands, up to about a second on a weak GPU. Going live
//      before then shows an empty stage.

import { Box3, Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FOV = 55;
const FIRST_PAINT_TIMEOUT_MS = 8000;
const DEFAULT_BACKGROUND = 0x0f0e16;

/** Every container Spark can decode, in the order a file picker should list them. */
export const SPLAT_EXTENSIONS = ['.ply', '.spz', '.splat', '.ksplat', '.sog'];

/** Human-readable form of the above, for error copy and page text. */
export const SPLAT_EXTENSIONS_LABEL = '.ply, .spz, .splat, .ksplat, or .sog';

let _spark = null;

/** Load Spark once, lazily: it is far too large to sit on a page's critical path. */
export async function loadSpark() {
	if (!_spark) _spark = await import('@sparkjsdev/spark');
	return _spark;
}

// Spark sniffs the container from its magic bytes, which is the reliable answer
// and the only one available for a URL that ends in a query string or carries no
// extension at all. Two formats it cannot sniff fall back to the name: `.splat`
// is a raw 32-byte-per-splat array with no header, and a bundled `.sog` is a zip
// whose signature it does not claim.
export function detectSplatFormat(name, bytes, SPARK) {
	const sniffed = SPARK.getSplatFileType(new Uint8Array(bytes.slice(0, 1024)));
	if (sniffed) return sniffed;
	const n = (name || '').toLowerCase();
	if (n.endsWith('.sog')) return SPARK.SplatFileType.PCSOGSZIP;
	if (n.endsWith('meta.json')) return SPARK.SplatFileType.PCSOGS;
	if (n.endsWith('.ksplat')) return SPARK.SplatFileType.KSPLAT;
	if (n.endsWith('.spz')) return SPARK.SplatFileType.SPZ;
	if (n.endsWith('.ply')) return SPARK.SplatFileType.PLY;
	return SPARK.SplatFileType.SPLAT;
}

// Fit the camera to whatever came out of the file. `centers_only` ignores the
// per-splat radii, so one stray oversized splat cannot blow the frame out to
// nothing, which is the usual failure of naive splat framing.
function frameCamera(camera, controls, mesh) {
	let box;
	try { box = mesh.getBoundingBox(true); } catch { box = null; }
	if (!box || box.isEmpty()) box = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
	mesh.updateMatrixWorld(true);
	box.applyMatrix4(mesh.matrixWorld);
	const center = box.getCenter(new Vector3());
	const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.001);
	const distance = (radius / Math.sin((FOV * Math.PI) / 360)) * 1.15;
	camera.near = Math.max(distance / 1000, 0.001);
	camera.far = distance * 100;
	camera.updateProjectionMatrix();
	camera.position.set(center.x, center.y, center.z + distance);
	controls.target.copy(center);
	controls.update();
	return { center: center.clone(), position: camera.position.clone() };
}

/**
 * Mount `buffer` into `host` and resolve once the scene is actually on screen.
 *
 * @param {HTMLElement} host          element to fill; its contents are replaced
 * @param {ArrayBuffer} buffer        splat bytes in any container Spark reads
 * @param {object}   [options]
 * @param {*}        [options.fileType]      Spark SplatFileType; sniffed if absent
 * @param {string}   [options.fileName]      name, used only to disambiguate the format
 * @param {boolean}  [options.flip=true]     apply the 3DGS Y-down convention flip.
 *                                           Pass false for splats authored Y-up,
 *                                           such as procedurally generated samples.
 * @param {number}   [options.background]    clear colour behind the scene
 * @param {Function} [options.onSorting]     called once decoding is done and the
 *                                           first sort is pending, with the splat count
 * @param {Function} [options.onContextLost] called if the browser drops the GL context
 * @returns {Promise<{count:number, recenter:Function, dispose:Function}>}
 * @throws if the bytes are not a splat scene this build can decode
 */
export async function mountSplatScene(host, buffer, {
	fileType,
	fileName,
	flip = true,
	background = DEFAULT_BACKGROUND,
	onSorting,
	onContextLost,
} = {}) {
	const SPARK = await loadSpark();
	host.innerHTML = '';

	// Antialias off on Spark's own advice: MSAA does nothing for splats and costs
	// real frame time.
	const renderer = new WebGLRenderer({ antialias: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	const width = () => host.clientWidth || 640;
	const height = () => host.clientHeight || 420;
	renderer.setSize(width(), height());
	host.appendChild(renderer.domElement);

	const scene = new Scene();
	scene.background = new Color(background);
	const camera = new PerspectiveCamera(FOV, width() / height(), 0.01, 1000);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;

	let onFirstPaint;
	const firstPaint = new Promise((resolve) => { onFirstPaint = resolve; });
	const spark = new SPARK.SparkRenderer({ renderer, onDirty: () => onFirstPaint() });
	scene.add(spark);

	let frame = 0;
	let mesh = null;
	let disposed = false;
	const resize = () => {
		renderer.setSize(width(), height());
		camera.aspect = width() / height();
		camera.updateProjectionMatrix();
	};

	function dispose() {
		if (disposed) return;
		disposed = true;
		if (frame) cancelAnimationFrame(frame);
		window.removeEventListener('resize', resize);
		// Order matters: drop the splat data, then the Spark renderer holding GPU
		// buffers for it, then the controls' listeners, then the context itself.
		try { mesh?.dispose?.(); } catch { /* already torn down */ }
		try { spark.dispose?.(); } catch { /* already torn down */ }
		try { controls.dispose?.(); } catch { /* already torn down */ }
		// renderer.dispose() frees the three.js caches and leaves the WebGL context
		// alive. Without an explicit release every scene swap leaks a live context,
		// and a browser grants a page only a handful before it starts reclaiming
		// the oldest out from under a running scene.
		try {
			renderer.forceContextLoss?.();
			renderer.dispose?.();
		} catch { /* context already lost */ }
		host.innerHTML = '';
	}

	try {
		mesh = new SPARK.SplatMesh({ fileBytes: buffer, fileType, fileName });
		if (flip) mesh.quaternion.set(1, 0, 0, 0);
		await mesh.initialized;
	} catch (err) {
		dispose();
		throw err;
	}
	if (disposed) throw new Error('splat stage was disposed while decoding');

	scene.add(mesh);
	const home = frameCamera(camera, controls, mesh);
	window.addEventListener('resize', resize);
	resize();

	const tick = () => {
		if (disposed) return;
		frame = requestAnimationFrame(tick);
		controls.update();
		renderer.render(scene, camera);
	};
	frame = requestAnimationFrame(tick);

	renderer.domElement.addEventListener('webglcontextlost', (e) => {
		e.preventDefault();
		if (disposed) return;
		dispose();
		onContextLost?.();
	}, { once: true });

	const count = mesh.packedSplats?.numSplats ?? 0;
	onSorting?.(count);
	await Promise.race([firstPaint, new Promise((r) => setTimeout(r, FIRST_PAINT_TIMEOUT_MS))]);

	return {
		count,
		dispose,
		recenter() {
			if (disposed) return;
			camera.position.copy(home.position);
			controls.target.copy(home.center);
			controls.update();
		},
	};
}

// splat-stage: mount a Gaussian-splat scene into a DOM element.
//
// Shared by the Splat Viewer (`src/splat-viewer.js`) and the Forge Studio Lab
// (`src/forge-studio/lab/lab.js`), which need exactly the same thing: hand it an
// element and a buffer of splat bytes, get back an orbiting scene and a handle
// that tears itself down completely.
//
// It runs on Spark (`@sparkjsdev/spark`, MIT, World Labs), 2.3.x. Spark renders
// splats as ordinary objects inside a normal three.js scene, which is what lets
// us frame the camera on the actual scene and, later, put splats and meshes in
// one stage. It also reads the compressed containers real captures ship as:
// .spz is about a tenth of the equivalent PLY and .sog about a fifteenth to a
// twentieth.
//
// Spark 2.3 added an LoD tree this module uses: `mesh.createLodSplats()` builds
// a coarser-at-distance splat set entirely from the mesh's own decoded buffer,
// off the main thread in Spark's worker pool, no network involved. It is built
// here automatically once a scene clears `LOD_AUTO_THRESHOLD` splats, the same
// idea as mesh LOD chains (`packages/glb-tools`) applied per-splat.
//
// Spark 2.3 also ships a GPU-memory pager (`SplatPager`/`PagedSplats`, the
// `paged` SplatMesh option), deliberately NOT wired up here: it is a streaming
// primitive for a chunked remote source (Spark's own RAD container, or a
// `-lod-N.<ext>` layout fetched over HTTP) and has no code path that pages an
// already-in-memory buffer of any format this viewer reads (.ply/.spz/.splat/
// .ksplat/.sog), confirmed by reading `PagedSplats.fetchDecodeChunk` in the
// installed package: its `fileBytes` branch is a no-op for every format but
// Spark's own RAD. Passing `paged: true` against a one-shot in-memory buffer
// does not throw, but it builds an empty, data-source-less pager that the
// renderer's LOD-drive loop then tries to fetch chunks from every frame,
// logging "No url or fileBytes provided" forever while paging nothing. Setting
// `mesh.paged` at all, even to that empty pager, is also what pulls the mesh
// into the renderer's LOD bookkeeping in the first place, so the fix is not to
// configure the pager correctly (there is no correct in-memory configuration)
// but to never set `paged` and let `createLodSplats()` populate
// `packedSplats.lodSplats` instead, which is the other, independent input the
// same bookkeeping already checks for.
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
const DEFAULT_LOD = true;
// Below this many splats, building the LoD tree is pure overhead: the full
// set already renders at full speed, so there is nothing for a coarser tier
// to save.
const LOD_AUTO_THRESHOLD = 50_000;

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
 * @param {boolean}  [options.lod=true]      once the scene clears {@link LOD_AUTO_THRESHOLD}
 *                                           splats, build Spark's per-splat LoD tree so
 *                                           distant geometry renders fewer, coarser
 *                                           splats instead of the full-detail set
 * @param {number}   [options.maxSplats]     hard cap on resident splats; omit for
 *                                           Spark's own default
 * @param {Function} [options.onSorting]     called once decoding is done and the
 *                                           first sort is pending, with the splat count
 * @param {Function} [options.onContextLost] called if the browser drops the GL context
 * @returns {Promise<{count:number, recenter:Function, dispose:Function, camera:PerspectiveCamera, controls:OrbitControls, canvas:HTMLCanvasElement, scene:Scene, mesh:object}>}
 * @throws if the bytes are not a splat scene this build can decode
 */
export async function mountSplatScene(host, buffer, {
	fileType,
	fileName,
	flip = true,
	background = DEFAULT_BACKGROUND,
	lod = DEFAULT_LOD,
	maxSplats,
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
	// Set when a scene clears LOD_AUTO_THRESHOLD and createLodSplats() is fired
	// off below. dispose() waits on it: Spark's worker pool rejects any in-flight
	// job the moment the renderer that owns it is disposed, and that job can
	// still be running if the user navigates away seconds after a big scene loads.
	let lodPromise = null;
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
		host.innerHTML = '';
		Promise.resolve(lodPromise).finally(() => {
			// Order matters: drop the splat data, then the Spark renderer holding GPU
			// buffers for it, then the controls' listeners, then the context itself.
			try { mesh?.dispose?.(); } catch { /* already torn down */ }
			// SparkRenderer drives an active LoD tree with its own per-frame worker
			// calls, independent of our one-shot createLodSplats() promise above. Its
			// dispose() terminates the shared worker pool and rejects every call still
			// in flight (SplatWorker.dispose, read from the installed package), with no
			// handler of its own, so the rejection lands here as unhandled on the next
			// microtask regardless of how long we wait. Catching it in a dispose-scoped
			// window is the correct fix, not a longer delay: no timeout is provably
			// long enough, since a new per-frame call can be dispatched on literally
			// the last rendered frame before this runs.
			let quietUntil = true;
			const quietRejection = (e) => { if (quietUntil) e.preventDefault(); };
			window.addEventListener('unhandledrejection', quietRejection);
			setTimeout(() => {
				quietUntil = false;
				window.removeEventListener('unhandledrejection', quietRejection);
			}, 50);
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
		});
	}

	try {
		mesh = new SPARK.SplatMesh({
			fileBytes: buffer,
			fileType,
			fileName,
			...(Number.isFinite(maxSplats) && maxSplats > 0 ? { maxSplats: Math.floor(maxSplats) } : {}),
		});
		if (flip) mesh.quaternion.set(1, 0, 0, 0);
		await mesh.initialized;
	} catch (err) {
		dispose();
		throw err;
	}
	if (disposed) throw new Error('splat stage was disposed while decoding');

	const count = mesh.packedSplats?.numSplats ?? mesh.splats?.numSplats ?? 0;
	if (lod && count >= LOD_AUTO_THRESHOLD) {
		// Fire-and-forget: this runs in Spark's worker pool and must not delay
		// first paint. SparkRenderer re-reads `packedSplats.lodSplats` every
		// frame, so the scene starts at full detail and switches itself over
		// the moment the tree lands, with no visible seam to wait for here.
		lodPromise = mesh.createLodSplats().catch((err) => console.error('[splat] LoD tree build failed', err));
	}

	scene.add(mesh);
	const home = frameCamera(camera, controls, mesh);
	window.addEventListener('resize', resize);
	resize();

	// Set by splat-hotspots.js while a camera-path keyframe sequence plays back:
	// runs once per rendered frame, ahead of controls.update()/render, so camera
	// playback and the one render loop this stage owns never fall out of sync.
	let onFrame = null;
	const tick = () => {
		if (disposed) return;
		frame = requestAnimationFrame(tick);
		onFrame?.();
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
		camera,
		controls,
		canvas: renderer.domElement,
		renderer,
		scene,
		mesh,
		/** Install (or clear, with `null`) a per-frame hook for camera playback. */
		setOnFrame(fn) {
			onFrame = typeof fn === 'function' ? fn : null;
		},
	};
}

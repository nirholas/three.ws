// Splat Viewer — render Gaussian-splat / radiance-field avatars in the browser.
//
// Runs on Spark (`@sparkjsdev/spark`, MIT, World Labs), which renders splats as
// ordinary objects inside a normal three.js scene rather than inside a private
// viewer of its own. Two things follow from that, and both are the reason this
// page moved off `@mkkellogg/gaussian-splats-3d`:
//
//   1. It reads the formats real captures actually ship. A scene that is a 1 GB
//      PLY is roughly a 42 MB SOG or a 100 MB SPZ, and those are the files
//      people are handed today. Extension-sniffing is also gone: the format is
//      read from the bytes, so a URL with no extension (or the wrong one) still
//      decodes.
//   2. The camera can frame the scene it actually loaded. The old viewer parked
//      the camera at a fixed z=3.2 for every file, which is correct for a scene
//      authored at unit scale and nothing else.
//
// Loads a .ply (plain or compressed), .spz, .splat, .ksplat, or .sog from a URL
// (?src=), a file upload, or a procedurally generated sample. Every state is
// designed: idle, loading, error, and the live HUD.

import { Box3, Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (s, r = document) => r.querySelector(s);

const STAGE = () => $('#sp-stage');
const HOST = () => $('#sp-host');

// ── Splat lib (lazy) ─────────────────────────────────────────────────────────
let _spark = null;
async function loadSplatLib() {
	if (!_spark) _spark = await import('@sparkjsdev/spark');
	return _spark;
}

// ── Active scene lifecycle ───────────────────────────────────────────────────
let _stage = null; // { renderer, scene, camera, controls, spark, mesh, frame }
let _downloadUrl = null; // blob URL backing the download button
let _lastRender = null; // { buffer, fileType, label, flip }, for recenter / re-render

function teardown() {
	const s = _stage;
	if (!s) return;
	_stage = null;
	if (s.frame) cancelAnimationFrame(s.frame);
	// Order matters: drop the splat data, then the Spark renderer that holds GPU
	// buffers for it, then the controls' listeners, then the context itself.
	try { s.mesh?.dispose?.(); } catch { /* already torn down */ }
	try { s.spark?.dispose?.(); } catch { /* already torn down */ }
	try { s.controls?.dispose?.(); } catch { /* already torn down */ }
	// renderer.dispose() frees the three.js caches and leaves the WebGL context
	// alive. Without an explicit release, every scene swap leaks a live context,
	// and a browser only grants a page a handful before it starts reclaiming the
	// oldest ones out from under a running scene.
	try {
		s.renderer?.forceContextLoss?.();
		s.renderer?.dispose?.();
	} catch { /* context already lost */ }
	s.resize && window.removeEventListener('resize', s.resize);
	const host = HOST();
	if (host) host.innerHTML = '';
}

// ── State overlays ───────────────────────────────────────────────────────────
function showOnly(id) {
	for (const k of ['sp-idle', 'sp-loading', 'sp-error']) {
		const node = $(`#${k}`);
		if (node) node.hidden = k !== id;
	}
}

function setLoading(title, detail) {
	showOnly('sp-loading');
	const t = $('#sp-loading-title');
	const d = $('#sp-loading-detail');
	if (t) t.textContent = title;
	if (d) d.textContent = detail || '';
	setHud(null);
}

function setError(title, detail) {
	showOnly('sp-error');
	const t = $('#sp-error-title');
	const d = $('#sp-error-detail');
	if (t) t.textContent = title;
	if (d) d.textContent = detail || '';
	setHud(null);
}

function setLive(label) {
	showOnly(null);
	setHud(label);
}

function setHud(label) {
	const hud = $('#sp-hud');
	if (!hud) return;
	hud.hidden = !label;
	if (label) hud.textContent = label;
	const recenter = $('#sp-recenter');
	if (recenter) recenter.hidden = !label;
}

function setDownload(url, filename) {
	const btn = $('#sp-download');
	if (!btn) return;
	if (_downloadUrl) URL.revokeObjectURL(_downloadUrl);
	_downloadUrl = url;
	if (!url) { btn.hidden = true; btn.removeAttribute('href'); return; }
	btn.href = url;
	btn.download = filename || 'avatar.splat';
	btn.hidden = false;
}

// ── Format detection ─────────────────────────────────────────────────────────
// Spark sniffs the container from its magic bytes, which is the reliable answer
// and the only one available for a URL that ends in a query string or no
// extension at all. Two formats it cannot sniff fall back to the name: `.splat`
// is a raw 32-byte-per-splat array with no header, and a bundled `.sog` is a zip
// whose signature it does not claim.
function formatFor(name, bytes, SPARK) {
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

const ACCEPTED = '.ply, .spz, .splat, .ksplat, or .sog';

// ── Core render ──────────────────────────────────────────────────────────────
const FOV = 55;
const FIRST_PAINT_TIMEOUT_MS = 8000;

// Fit the camera to whatever came out of the file. `centers_only` ignores the
// per-splat radii, so one stray oversized splat cannot blow the frame out to
// nothing, which is the usual failure of naive splat framing.
//
// getBoundingBox reports the mesh's OWN coordinates, and a loaded capture wears
// the 180-degree flip below. Framing the local box would aim the camera at the
// mirror image of where the scene actually is, which is invisible for anything
// not centred on the origin, so push the box through the world matrix first.
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

async function renderBuffer(buffer, { label, fileType, fileName, flip = true }) {
	_lastRender = { buffer, fileType, fileName, label, flip };
	setLoading('Decoding radiance field…', `${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
	const SPARK = await loadSplatLib();
	teardown();
	const host = HOST();
	host.innerHTML = '';

	// Opaque, and antialias off on Spark's own advice: MSAA does nothing for
	// splats and costs real frame time. Opaque is not a style choice either.
	// Spark accumulates splat colour with premultiplied alpha and leaves the
	// destination alpha at zero, so on a transparent canvas the browser
	// composites a fully rendered scene away to nothing. The clear colour stands
	// in for the stage's own gradient, which the canvas covers.
	const renderer = new WebGLRenderer({ antialias: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(host.clientWidth || 640, host.clientHeight || 420);
	host.appendChild(renderer.domElement);

	const scene = new Scene();
	scene.background = new Color(0x0f0e16);
	const camera = new PerspectiveCamera(FOV, (host.clientWidth || 640) / (host.clientHeight || 420), 0.01, 1000);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	// Spark sorts the splats on a worker and only paints once that first sort
	// lands, which on a weak GPU is a visible second or more. Without this the
	// stage would go live over an empty canvas and read as a broken page, so
	// hold the loading state until Spark says it has something to draw. The
	// timeout is the safety net: a scene that never reports back still gets
	// handed to the user rather than hanging on the overlay forever.
	let onFirstPaint;
	const firstPaint = new Promise((resolve) => { onFirstPaint = resolve; });
	const spark = new SPARK.SparkRenderer({ renderer, onDirty: () => onFirstPaint() });
	scene.add(spark);

	const stage = { renderer, scene, camera, controls, spark, mesh: null, frame: 0, home: null };
	_stage = stage;

	let mesh;
	try {
		mesh = new SPARK.SplatMesh({ fileBytes: buffer, fileType, fileName });
		// 3DGS captures are authored Y-down, so every viewer in the ecosystem
		// flips them 180 degrees about X to stand them up. Our procedural samples
		// are authored Y-up and pass flip:false.
		if (flip) mesh.quaternion.set(1, 0, 0, 0);
		await mesh.initialized;
	} catch (err) {
		teardown();
		setError('That file isn’t a valid splat', `Expected a ${ACCEPTED} Gaussian-splat scene. Check the file and try again.`);
		console.error('[splat] decode failed', err);
		return false;
	}
	if (_stage !== stage) { try { mesh.dispose(); } catch { /* superseded mid-decode */ } return false; }

	stage.mesh = mesh;
	scene.add(mesh);
	stage.home = frameCamera(camera, controls, mesh);

	const resize = () => {
		const w = host.clientWidth || 640;
		const h = host.clientHeight || 420;
		renderer.setSize(w, h);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	stage.resize = resize;
	window.addEventListener('resize', resize);
	resize();

	const tick = () => {
		if (_stage !== stage) return;
		stage.frame = requestAnimationFrame(tick);
		controls.update();
		renderer.render(scene, camera);
	};
	stage.frame = requestAnimationFrame(tick);

	watchContextLoss(stage);
	const count = mesh.packedSplats?.numSplats;
	setLoading('Sorting splats…', count ? `${count.toLocaleString()} splats` : '');
	await Promise.race([firstPaint, new Promise((r) => setTimeout(r, FIRST_PAINT_TIMEOUT_MS))]);
	if (_stage !== stage) return false;
	setLive(count ? `${label} · ${count.toLocaleString()} splats` : label);
	return true;
}

// A GPU driver reset or a browser-reclaimed context leaves a live canvas painting
// nothing. Say so instead of showing a frozen frame, and offer the way back.
function watchContextLoss(stage) {
	const canvas = stage.renderer?.domElement;
	if (!canvas) return;
	canvas.addEventListener('webglcontextlost', (e) => {
		e.preventDefault();
		if (_stage !== stage) return;
		teardown();
		setError('The 3D context was lost', 'Your browser released the WebGL context, usually after a GPU reset or heavy memory pressure. Load the scene again to restore it.');
	}, { once: true });
}

// Reset the camera on the live scene. Rebuilding from the cached buffer also
// works, but it drops and recreates a WebGL context for what is a two-line
// transform change, and the stage flashes through the loading overlay.
function recenter() {
	const s = _stage;
	if (s?.home) {
		s.camera.position.copy(s.home.position);
		s.controls.target.copy(s.home.center);
		s.controls.update();
		return;
	}
	if (_lastRender) renderBuffer(_lastRender.buffer, _lastRender);
}

// Rewrite the page/redirect URLs of common asset hosts to their CORS-enabled
// raw form. GitHub and Hugging Face host most public splat scenes, but their
// human-facing URLs (github.com/.../raw, .../blob, HF /blob) 302-redirect or
// serve HTML, and the redirect target's CORS headers break a browser fetch.
// The canonical raw hosts (raw.githubusercontent.com, HF /resolve) send
// `Access-Control-Allow-Origin: *`, so the same file loads cleanly.
function normalizeAssetUrl(parsed) {
	const host = parsed.hostname.toLowerCase();
	if (host === 'github.com') {
		// /<owner>/<repo>/(raw|blob)/<ref>/<path…>  →  raw.githubusercontent.com/<owner>/<repo>/<ref>/<path…>
		const m = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:raw|blob)\/(.+)$/);
		if (m) return new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}${parsed.search}`);
	}
	if (host === 'huggingface.co' || host === 'www.huggingface.co') {
		// .../blob/<ref>/<path>  →  .../resolve/<ref>/<path>  (raw bytes, with CORS)
		if (parsed.pathname.includes('/blob/')) {
			return new URL(`https://huggingface.co${parsed.pathname.replace('/blob/', '/resolve/')}${parsed.search}`);
		}
	}
	if (host === 'www.dropbox.com' || host === 'dropbox.com') {
		// Force a direct download instead of the HTML preview page.
		const direct = new URL(parsed.href);
		direct.searchParams.set('dl', '1');
		return direct;
	}
	return parsed;
}

async function loadFromUrl(url, label) {
	if (!url) return;
	let parsed;
	try { parsed = new URL(url, location.href); } catch { setError('That doesn’t look like a URL', url); return; }
	parsed = normalizeAssetUrl(parsed);
	setLoading('Fetching splat…', parsed.hostname);
	const SPARK = await loadSplatLib();
	let buffer;
	try {
		const res = await fetch(parsed.href);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		buffer = await res.arrayBuffer();
	} catch (err) {
		setError('Couldn’t fetch that splat', `${err.message}. The host may block cross-origin requests (CORS). Download the file and upload it instead.`);
		console.error('[splat] fetch failed', err);
		return;
	}
	const name = parsed.pathname.split('/').pop() || 'remote.splat';
	const ok = await renderBuffer(buffer, { label: label || name, fileName: name, fileType: formatFor(name, buffer, SPARK) });
	// The bytes are already in memory, so a remote scene is as saveable as an
	// uploaded one. Handing back the fetched buffer also spares the user a second
	// round trip to a host that may not allow one.
	setDownload(ok ? URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })) : null, name);
}

async function loadFromFile(file) {
	const SPARK = await loadSplatLib();
	setLoading('Reading file…', file.name);
	let buffer;
	try { buffer = await file.arrayBuffer(); }
	catch (err) { setError('Couldn’t read that file', err.message); return; }
	const ok = await renderBuffer(buffer, { label: file.name, fileName: file.name, fileType: formatFor(file.name, buffer, SPARK) });
	setDownload(ok ? URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })) : null, file.name);
}

// ── Procedural samples (antimatter15 .splat layout, 32 bytes/splat) ──────────
function writeSplat(view, base, x, y, z, sx, sy, sz, r, g, b, a) {
	view.setFloat32(base, x, true);
	view.setFloat32(base + 4, y, true);
	view.setFloat32(base + 8, z, true);
	view.setFloat32(base + 12, sx, true);
	view.setFloat32(base + 16, sy, true);
	view.setFloat32(base + 20, sz, true);
	view.setUint8(base + 24, r);
	view.setUint8(base + 25, g);
	view.setUint8(base + 26, b);
	view.setUint8(base + 27, a);
	// identity-ish rotation quaternion, encoded around 128
	view.setUint8(base + 28, 255);
	view.setUint8(base + 29, 128);
	view.setUint8(base + 30, 128);
	view.setUint8(base + 31, 128);
}

function sampleShell(count = 6000) {
	const buf = new ArrayBuffer(count * 32);
	const f = new DataView(buf);
	const col = new Color();
	for (let i = 0; i < count; i++) {
		const t = i / count;
		const phi = Math.acos(1 - 2 * t);
		const theta = Math.PI * (1 + Math.sqrt(5)) * i;
		col.setHSL((Math.cos(phi) + 1) / 2, 0.7, 0.55);
		writeSplat(f, i * 32,
			Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta),
			0.03, 0.03, 0.03,
			Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255), 255);
	}
	return buf;
}

// A head-and-shoulders bust: ellipsoid head + tapered shoulders, skin-toned, to
// evoke what a real GaussianAvatars capture looks like in this viewer. Synthetic.
function sampleBust(count = 14000) {
	const buf = new ArrayBuffer(count * 32);
	const f = new DataView(buf);
	const col = new Color();
	for (let i = 0; i < count; i++) {
		const t = i / count;
		const theta = Math.PI * (1 + Math.sqrt(5)) * i;
		let x, y, z;
		if (t < 0.62) {
			// Head — ellipsoid centered above origin
			const u = t / 0.62;
			const phi = Math.acos(1 - 2 * u);
			x = 0.62 * Math.sin(phi) * Math.cos(theta);
			y = 0.55 + 0.78 * Math.cos(phi);
			z = 0.66 * Math.sin(phi) * Math.sin(theta);
			const front = (z + 0.66) / 1.32; // warmer toward the face
			if (y > 1.18) col.setHSL(0.07, 0.3, 0.18); // hair cap
			else col.setHSL(0.06, 0.45, Math.max(0.1, 0.42 + 0.16 * front));
		} else {
			// Shoulders / chest — flattened cone widening downward
			const u = (t - 0.62) / 0.38;
			const r = 0.55 + 0.85 * u;
			x = r * Math.cos(theta);
			y = -0.05 - 0.95 * u;
			z = 0.62 * r * Math.sin(theta);
			col.setHSL(0.6, 0.25, 0.34 + 0.06 * Math.sin(theta * 3)); // garment
		}
		writeSplat(f, i * 32, x, y, z, 0.022, 0.022, 0.022,
			Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255), 255);
	}
	return buf;
}

async function loadSample(kind) {
	const SPARK = await loadSplatLib();
	const isBust = kind === 'bust';
	const buffer = isBust ? sampleBust() : sampleShell();
	const label = isBust ? 'Synthetic head bust' : 'Radiance shell';
	const name = isBust ? 'sample-bust.splat' : 'sample-shell.splat';
	// Authored Y-up, so skip the capture-convention flip.
	const ok = await renderBuffer(buffer, { label, fileName: name, fileType: SPARK.SplatFileType.SPLAT, flip: false });
	setDownload(ok ? URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })) : null, name);
}

// ── Wiring ───────────────────────────────────────────────────────────────────
function init() {
	if (!STAGE()) return;

	$('#sp-load-url').addEventListener('click', () => {
		const url = $('#sp-url').value.trim();
		if (url) loadFromUrl(url);
	});
	$('#sp-url').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { const url = e.target.value.trim(); if (url) loadFromUrl(url); }
	});

	$('#sp-pick').addEventListener('click', () => $('#sp-file').click());
	// The whole idle panel is a mouse target, and the button inside it is the
	// keyboard one. Stop the button's click bubbling or the picker opens twice.
	$('#sp-idle-pick').addEventListener('click', (e) => { e.stopPropagation(); $('#sp-file').click(); });
	$('#sp-idle').addEventListener('click', () => $('#sp-file').click());
	$('#sp-file').addEventListener('change', (e) => {
		const file = e.target.files?.[0];
		if (file) loadFromFile(file);
		e.target.value = '';
	});

	for (const btn of document.querySelectorAll('.sp-sample')) {
		btn.addEventListener('click', () => loadSample(btn.dataset.sample));
	}

	$('#sp-error-retry').addEventListener('click', () => loadSample('bust'));
	$('#sp-recenter').addEventListener('click', recenter);

	// Drag & drop onto the stage
	const stage = STAGE();
	['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => {
		e.preventDefault(); stage.classList.add('is-dragover');
	}));
	stage.addEventListener('dragleave', (e) => { if (e.target === stage) stage.classList.remove('is-dragover'); });
	stage.addEventListener('drop', (e) => {
		e.preventDefault(); stage.classList.remove('is-dragover');
		const file = e.dataTransfer?.files?.[0];
		if (file) loadFromFile(file);
	});

	// Deep link: ?src=<url>&name=<label>
	const p = new URLSearchParams(location.search);
	const src = p.get('src');
	if (src) {
		$('#sp-url').value = src;
		loadFromUrl(src, p.get('name') || undefined);
	}

	// pagehide, not beforeunload: an unconditional beforeunload listener opts the
	// page out of the back/forward cache, so returning to it would cost a full
	// reload of the splat engine.
	window.addEventListener('pagehide', () => { teardown(); setDownload(null); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

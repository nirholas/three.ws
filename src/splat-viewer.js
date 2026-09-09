// Splat Viewer - render Gaussian-splat / radiance-field avatars in the browser.
//
// Loads a .ply (plain or compressed), .spz, .splat, .ksplat, or .sog from a URL
// (?src=), a file upload, or a procedurally generated sample. Every state is
// designed: idle, fetching, decoding, sorting, error, and the live HUD.
//
// The renderer itself lives in `src/splat-stage.js`, shared with the Forge
// Studio Lab, which needs the same scene and the same three non-obvious Spark
// behaviours. This file is the page: fetching, format plumbing, and the states.

import { Color } from 'three';
import { loadSpark, detectSplatFormat, mountSplatScene, SPLAT_EXTENSIONS_LABEL } from './splat-stage.js';

const $ = (s, r = document) => r.querySelector(s);

const STAGE = () => $('#sp-stage');
const HOST = () => $('#sp-host');

// -- Active scene lifecycle ---------------------------------------------------
let _scene = null; // handle from mountSplatScene
let _token = 0; // guards a slow load finishing after a newer one started
let _downloadUrl = null; // blob URL backing the download button
let _lastRender = null; // { buffer, fileType, fileName, label, flip }, for recenter

function teardown() {
	_token++;
	if (!_scene) return;
	_scene.dispose();
	_scene = null;
}

// -- State overlays -----------------------------------------------------------
function showOnly(id) {
	for (const k of ['sp-idle', 'sp-loading', 'sp-error']) {
		const node = $(`#${k}`);
		if (node) node.hidden = k !== id;
	}
}

// Write a live value into a node the markup also annotates for translation.
// `data-i18n-owned` is src/i18n.js's handshake: the catalog pass lands after an
// async /api/locale fetch, seconds in, and without the flag it reverts whatever
// the script wrote back to the annotated source string. That is what used to
// turn "Sorting splats..." back into "Loading splat engine..." mid-load.
function setText(node, value) {
	if (!node) return;
	node.textContent = value;
	node.dataset.i18nOwned = '1';
}

function setLoading(title, detail) {
	showOnly('sp-loading');
	setText($('#sp-loading-title'), title);
	setText($('#sp-loading-sub'), detail || '');
	setHud(null);
}

function setError(title, detail) {
	showOnly('sp-error');
	setText($('#sp-error-title'), title);
	setText($('#sp-error-sub'), detail || '');
	setHud(null);
}

function setLive(label) {
	showOnly(null);
	setHud(label);
}

// The label goes in its own node, never on #sp-hud itself: the HUD element also
// holds the recenter and download controls, so writing textContent on it deletes
// them from the DOM and every later query for them returns null.
function setHud(label) {
	const hud = $('#sp-hud');
	if (!hud) return;
	hud.hidden = !label;
	const text = $('#sp-hud-label');
	if (text) text.textContent = label || '';
	const recenter = $('#sp-recenter');
	if (recenter) recenter.hidden = !label;
	// Leaving the live state also retires the previous scene's file: a download
	// button still pointing at it over a fetch error hands back the wrong bytes.
	if (!label) setDownload(null);
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

// -- Core render --------------------------------------------------------------
async function renderBuffer(buffer, { label, fileType, fileName, flip = true }) {
	_lastRender = { buffer, fileType, fileName, label, flip };
	setLoading('Decoding radiance field\u2026', `${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
	teardown();
	const token = _token;

	let scene;
	try {
		scene = await mountSplatScene(HOST(), buffer, {
			fileType,
			fileName,
			flip,
			onSorting: (count) => {
				if (token !== _token) return;
				setLoading('Sorting splats\u2026', count ? `${count.toLocaleString()} splats` : '');
			},
			onContextLost: () => {
				if (token !== _token) return;
				_scene = null;
				setError('The 3D context was lost', 'Your browser released the WebGL context, usually after a GPU reset or heavy memory pressure. Load the scene again to restore it.');
			},
		});
	} catch (err) {
		if (token !== _token) return false;
		setError('That file isn\u2019t a valid splat', `Expected a ${SPLAT_EXTENSIONS_LABEL} Gaussian-splat scene. Check the file and try again.`);
		console.error('[splat] decode failed', err);
		return false;
	}
	// A newer load started while this one was decoding: throw this one away rather
	// than letting it paint over the scene the user is now waiting on.
	if (token !== _token) { scene.dispose(); return false; }

	_scene = scene;
	setLive(scene.count ? `${label} \u00b7 ${scene.count.toLocaleString()} splats` : label);
	return true;
}

// Reset the camera on the live scene. Rebuilding from the cached buffer also
// works, but it drops and recreates a WebGL context for what is a two-line
// transform change, and the stage flashes through the loading overlay.
function recenter() {
	if (_scene) { _scene.recenter(); return; }
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
	const SPARK = await loadSpark();
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
	const ok = await renderBuffer(buffer, { label: label || name, fileName: name, fileType: detectSplatFormat(name, buffer, SPARK) });
	// The bytes are already in memory, so a remote scene is as saveable as an
	// uploaded one. Handing back the fetched buffer also spares the user a second
	// round trip to a host that may not allow one.
	setDownload(ok ? URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' })) : null, name);
}

async function loadFromFile(file) {
	const SPARK = await loadSpark();
	setLoading('Reading file…', file.name);
	let buffer;
	try { buffer = await file.arrayBuffer(); }
	catch (err) { setError('Couldn’t read that file', err.message); return; }
	const ok = await renderBuffer(buffer, { label: file.name, fileName: file.name, fileType: detectSplatFormat(file.name, buffer, SPARK) });
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
	const SPARK = await loadSpark();
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

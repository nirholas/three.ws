// 360 clip support shared by /video-to-motion and /motion-swap.
//
// A visitor drops a 360 clip (a stitched 2:1 equirectangular MP4 from any 360
// camera, for example footage from Insta360 X3, X4, X5 and X6 exported as MP4),
// sees it on a sphere, clicks the person to follow, and the page sends
// `projection: "equirect"` plus `subject: { yaw_deg, pitch_deg }` to
// /api/motion-swap (contract C3 of the insta360 campaign, worker side in
// workers/model-video2motion).
//
// Angle convention (C3, the same one the worker uses): yaw 0 and pitch 0 are the
// centre pixel of the equirect frame, yaw grows to the right (image x grows),
// pitch grows upward (image y shrinks). So pixel (x, y) in a W by H frame is
//   yaw   = (x / W - 0.5) * 360
//   pitch = (0.5 - y / H) * 180
// In the preview sphere a view direction d = (x right, y up, z backward, the
// three.js camera frame with the default camera looking down -Z) maps to
//   yaw = atan2(d.x, -d.z), pitch = asin(d.y / |d|).
//
// The first half of this file is pure logic (covered by tests/motion-360.test.js);
// the second half builds the DOM and loads three.js lazily.

export const MAX_MOTION_UPLOAD_BYTES = 256 * 1024 * 1024;
export const EQUIRECT_RATIO_TOLERANCE = 0.03;
const RAW_EXTENSIONS = ['.insv', '.insp', '.lrv'];

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/** True for a 2:1 frame (within 3 percent), the shape every equirect export has. */
export function isEquirectSize(width, height) {
	if (!(width > 0) || !(height > 0)) return false;
	return Math.abs(width / height - 2) <= 2 * EQUIRECT_RATIO_TOLERANCE;
}

/** True for a raw Insta360 file (.insv, .insp, .lrv) that is not a stitched clip. */
export function isRawCameraFile(file) {
	const name = String(file?.name || '').toLowerCase();
	return RAW_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function clamp(n, lo, hi) {
	return Math.min(hi, Math.max(lo, n));
}

/** Wrap a yaw in degrees into [-180, 180]. */
export function wrapYaw(deg) {
	let y = ((((deg + 180) % 360) + 360) % 360) - 180;
	if (y === -180 && deg > 0) y = 180;
	return y;
}

/** View direction (x right, y up, -z forward) to the contract's yaw and pitch in degrees. */
export function rayToYawPitch(x, y, z) {
	const len = Math.hypot(x, y, z);
	if (!(len > 0)) return { yaw_deg: 0, pitch_deg: 0 };
	const pitch = Math.asin(clamp(y / len, -1, 1));
	const yaw = Math.atan2(x, -z);
	return {
		yaw_deg: round2(wrapYaw((yaw * 180) / Math.PI)),
		pitch_deg: round2((pitch * 180) / Math.PI),
	};
}

/** Inverse of rayToYawPitch: a unit direction for a yaw and pitch in degrees. */
export function yawPitchToDirection(yawDeg, pitchDeg) {
	const yaw = (yawDeg * Math.PI) / 180;
	const pitch = (pitchDeg * Math.PI) / 180;
	return {
		x: Math.sin(yaw) * Math.cos(pitch),
		y: Math.sin(pitch),
		z: -Math.cos(yaw) * Math.cos(pitch),
	};
}

/** The same angles from a pixel of the equirect frame (the C3 formula verbatim). */
export function pixelToYawPitch(px, py, width, height) {
	return {
		yaw_deg: round2((px / width - 0.5) * 360),
		pitch_deg: round2((0.5 - py / height) * 180),
	};
}

function round2(n) {
	const r = Math.round(n * 100) / 100;
	return r === 0 ? 0 : r;
}

/**
 * The /api/motion-swap job body. Without a capture the body is exactly what the
 * pages sent before 360 support, so regular videos behave unchanged.
 * `capture` is { projection: 'equirect', subject?: { yaw_deg, pitch_deg, t_s? } }.
 */
export function buildCaptureBody(videoUrl, capture) {
	const body = { video_url: videoUrl };
	if (!capture || capture.projection !== 'equirect') return body;
	body.projection = 'equirect';
	const s = capture.subject;
	if (s && Number.isFinite(s.yaw_deg) && Number.isFinite(s.pitch_deg)) {
		body.subject = {
			yaw_deg: clamp(s.yaw_deg, -180, 180),
			pitch_deg: clamp(s.pitch_deg, -90, 90),
		};
		// Optional extension to C3: the clip time the person was picked at, so a
		// worker can seed its tracker from that frame. Workers ignore what they
		// do not know.
		if (Number.isFinite(s.t_s) && s.t_s > 0.05) body.subject.t_s = round2(s.t_s);
	}
	return body;
}

/** Classify a failed capture so the page can say the right thing and offer the right retry. */
export function classifyCaptureError(message, code) {
	const text = String(message || '');
	const c = String(code || '').toLowerCase();
	if (c === 'subject_lost' || c === 'subject_not_found') return 'subject_lost';
	const who = /\b(subject|person|dancer|figure)\b/i.test(text);
	if (who && /\b(lost|not found|could not be found|cannot be found|disappear|left the frame|could not (find|locate|follow|track)|couldn't (find|locate|follow|track)|unable to (find|locate|follow|track))/i.test(text)) {
		return 'subject_lost';
	}
	if (/lost (track|sight)/i.test(text)) return 'subject_lost';
	return 'generic';
}

/** The reframe video URL when the worker returned a usable one, else null (panel stays hidden). */
export function reframeUrlOf(result) {
	const url = result?.reframe_url;
	if (typeof url !== 'string' || !url) return null;
	try {
		return new URL(url, 'https://three.ws').protocol === 'https:' || url.startsWith('/') ? url : null;
	} catch {
		return null;
	}
}

export function formatMegabytes(bytes) {
	return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** A visitor-readable reason a file is rejected before upload, or null when it can go. */
export function fileProblem(file, { is360 = false } = {}) {
	if (!file) return null;
	if (file.size > MAX_MOTION_UPLOAD_BYTES) {
		return is360
			? `This 360 clip is ${formatMegabytes(file.size)} and the limit is ${formatMegabytes(MAX_MOTION_UPLOAD_BYTES)}. Export a shorter or lower-resolution 360 MP4 (3840 x 1920 is plenty for tracking a person) from Insta360 Studio or the camera app, then try again.`
			: `This video is ${formatMegabytes(file.size)} and the limit is ${formatMegabytes(MAX_MOTION_UPLOAD_BYTES)}. Trim it down (90 seconds is the processing cap anyway).`;
	}
	return null;
}

/**
 * Decide what to do about a keep-in-sync reframe video: where to seek and
 * whether to play or pause so it follows the avatar timeline.
 */
export function planReframeSync({ current, target, paused, wantPlaying, tolerance = 0.15 }) {
	const plan = { seekTo: null, action: null };
	if (Math.abs(current - target) > tolerance) plan.seekTo = Math.max(0, target);
	if (wantPlaying && paused) plan.action = 'play';
	else if (!wantPlaying && !paused) plan.action = 'pause';
	return plan;
}

/**
 * Read a chosen file's kind without decoding it: raw camera file, 360 (2:1
 * track dimensions from the container header), regular, or unreadable. Reading
 * the container with mediabunny works for codecs the browser cannot play, so a
 * 5.7K H.265 clip is still recognised.
 */
export async function inspectVideoFile(file) {
	if (isRawCameraFile(file)) return { kind: 'raw', width: 0, height: 0, duration: 0 };
	try {
		const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		const track = await input.getPrimaryVideoTrack();
		if (!track) return { kind: 'unreadable', width: 0, height: 0, duration: 0 };
		const width = track.displayWidth;
		const height = track.displayHeight;
		const duration = await input.computeDuration().catch(() => 0);
		return {
			kind: isEquirectSize(width, height) ? 'equirect' : 'regular',
			width,
			height,
			duration,
		};
	} catch {
		return { kind: 'unreadable', width: 0, height: 0, duration: 0 };
	}
}

// ---------------------------------------------------------------------------
// DOM: styles
// ---------------------------------------------------------------------------

const STYLE_ID = 'm360-style';
const CSS = `
.m360-picking > [id$='-canvas-wrap'], .m360-picking > .vtm-controls, .m360-picking > .ms-controls, .m360-picking > .vtm-trim { display: none !important; }
.m360-host { background: var(--surface-0, #0b0b0b); color: var(--text, #f6f6f6); padding: 16px; font-family: var(--font-body, 'Inter', system-ui, sans-serif); }
.m360-host[hidden] { display: none !important; }
.m360-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
.m360-badge { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px; border-radius: 20px; border: 1px solid #2f7a4f; background: rgba(110,231,162,0.1); color: #6ee7a2; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
.m360-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #6ee7a2; }
.m360-file { flex: 1; min-width: 0; color: var(--text-2, #b4b4b4); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m360-link { appearance: none; background: none; border: 0; padding: 4px 2px; color: var(--text-2, #b4b4b4); font: inherit; font-size: 12.5px; text-decoration: underline; cursor: pointer; transition: color 120ms; }
.m360-link:hover { color: var(--text, #f6f6f6); }
.m360-link:focus-visible, .m360-btn:focus-visible, .m360-view:focus-visible, .m360-scrub input:focus-visible { outline: 2px solid var(--text-2, #b4b4b4); outline-offset: 2px; }
.m360-view { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; background: #050505; border: 1px solid var(--hairline, #1f1f1f); cursor: crosshair; touch-action: none; user-select: none; }
.m360-view.is-dragging { cursor: grabbing; }
.m360-view canvas { width: 100%; height: 100%; display: block; }
.m360-skeleton { position: absolute; inset: 0; background: linear-gradient(100deg, #0b0b0b 30%, #151515 50%, #0b0b0b 70%); background-size: 200% 100%; animation: m360-shimmer 1.4s linear infinite; }
.m360-skeleton[hidden] { display: none; }
@keyframes m360-shimmer { to { background-position: -200% 0; } }
.m360-marker { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid #6ee7a2; box-shadow: 0 0 0 2px rgba(0,0,0,0.55), 0 0 14px rgba(110,231,162,0.55); pointer-events: none; transform: scale(1); transition: transform 160ms var(--ease-standard, ease); }
.m360-marker::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #6ee7a2; }
.m360-marker[hidden] { display: none; }
.m360-marker.is-new { animation: m360-pop 360ms ease-out; }
@keyframes m360-pop { from { transform: scale(2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.m360-crosshair { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; pointer-events: none; opacity: 0.0; }
.m360-view:focus-visible .m360-crosshair { opacity: 0.85; }
.m360-crosshair::before, .m360-crosshair::after { content: ''; position: absolute; background: #fff; }
.m360-crosshair::before { left: 6px; top: 0; width: 2px; height: 14px; }
.m360-crosshair::after { top: 6px; left: 0; height: 2px; width: 14px; }
.m360-hint { position: absolute; left: 10px; bottom: 10px; padding: 5px 10px; border-radius: 6px; background: rgba(0,0,0,0.62); color: #e8e8e8; font-size: 12px; pointer-events: none; transition: opacity 240ms; }
.m360-scrub { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 12.5px; color: var(--text-2, #b4b4b4); }
.m360-scrub input[type='range'] { flex: 1; min-width: 0; accent-color: #6ee7a2; }
.m360-scrub output { font-variant-numeric: tabular-nums; min-width: 84px; text-align: right; }
.m360-readout { margin: 12px 0 0; min-height: 20px; font-size: 13.5px; color: var(--text-2, #b4b4b4); line-height: 1.5; }
.m360-readout strong { color: var(--text, #f6f6f6); font-variant-numeric: tabular-nums; }
.m360-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.m360-btn { appearance: none; border: 1px solid var(--hairline-2, #2c2c2c); border-radius: 8px; background: var(--surface-1, #151515); color: var(--text, #f6f6f6); padding: 9px 15px; font-size: 13px; cursor: pointer; transition: background 120ms, border-color 120ms, transform 80ms; }
.m360-btn:hover:not([disabled]) { background: var(--surface-2, #1d1d1d); border-color: var(--text-3, #555); }
.m360-btn:active:not([disabled]) { transform: translateY(1px); }
.m360-btn[disabled] { opacity: 0.5; cursor: default; }
.m360-btn--primary { background: var(--text, #f6f6f6); color: var(--bg, #060606); border-color: var(--text, #f6f6f6); font-weight: 600; }
.m360-btn--primary:hover:not([disabled]) { background: #dcdcdc; }
.m360-note { margin: 10px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--text-2, #b4b4b4); }
.m360-note a { color: var(--text, #f6f6f6); }
.m360-message { max-width: 560px; margin: 0 auto; padding: 22px 6px; text-align: center; }
.m360-message h3 { margin: 0 0 8px; font-size: 18px; }
.m360-message p { margin: 0 0 14px; color: var(--text-2, #b4b4b4); font-size: 14px; line-height: 1.6; }
.m360-message .m360-actions { justify-content: center; }
.m360-reframe { margin-top: 16px; border: 1px solid var(--hairline, #1f1f1f); border-radius: 12px; background: var(--surface-0, #0d0d0d); padding: 14px 16px 16px; }
.m360-reframe[hidden] { display: none; }
.m360-reframe h2 { margin: 0 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-2, #b4b4b4); }
.m360-reframe p { margin: 0 0 10px; font-size: 12.5px; line-height: 1.55; color: var(--text-2, #b4b4b4); }
.m360-reframe video { display: block; width: 100%; max-height: 360px; border-radius: 8px; background: #050505; object-fit: contain; }
@media (max-width: 520px) { .m360-host { padding: 12px; } .m360-scrub output { min-width: 70px; } .m360-btn { flex: 1 1 auto; } }
@media (prefers-reduced-motion: reduce) { .m360-skeleton, .m360-marker.is-new { animation: none; } }
`;

function ensureStyle() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.appendChild(style);
}

function el(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v);
	}
	for (const c of [].concat(children)) if (c) node.append(c);
	return node;
}

function fmtTime(s) {
	const m = Math.floor(s / 60);
	return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// DOM: the sphere picker
// ---------------------------------------------------------------------------

/**
 * A draggable 360 preview of a local video file. Calls onPick({ yaw_deg,
 * pitch_deg, t_s }) when the visitor clicks a spot (or presses Enter or Space
 * to pick what is under the centre cross). Returns { dispose, video, setMarker,
 * clearMarker }.
 */
async function createSpherePicker(view, file, { onPick, onReady, onUnplayable }) {
	const THREE = await import('three');
	const canvas = el('canvas', { 'aria-hidden': 'true' });
	const marker = el('div', { class: 'm360-marker', hidden: '' });
	const crosshair = el('div', { class: 'm360-crosshair' });
	const skeleton = el('div', { class: 'm360-skeleton' });
	view.append(canvas, crosshair, marker, skeleton);

	const video = document.createElement('video');
	video.muted = true;
	video.loop = true;
	video.playsInline = true;
	video.preload = 'auto';
	const objectUrl = URL.createObjectURL(file);
	video.src = objectUrl;

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 50);
	camera.rotation.order = 'YXZ';

	// Sphere whose vertex at texture (u, v) sits exactly in the direction the
	// contract's yaw and pitch name, seen from inside.
	const geo = new THREE.BufferGeometry();
	const cols = 96;
	const rows = 48;
	const pos = [];
	const uvs = [];
	for (let j = 0; j <= rows; j++) {
		for (let i = 0; i <= cols; i++) {
			const u = i / cols;
			const v = 1 - j / rows;
			const d = yawPitchToDirection((u - 0.5) * 360, (v - 0.5) * 180);
			pos.push(d.x * 10, d.y * 10, d.z * 10);
			uvs.push(u, v);
		}
	}
	const index = [];
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			const a = j * (cols + 1) + i;
			const b = a + cols + 1;
			index.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(index);
	const texture = new THREE.VideoTexture(video);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;
	const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
	scene.add(mesh);

	const look = { yaw: 0, pitch: 0, fov: 75 };
	let picked = null;
	let raf = 0;
	let disposed = false;

	function applyCamera() {
		look.pitch = clamp(look.pitch, -89, 89);
		look.fov = clamp(look.fov, 25, 100);
		camera.rotation.y = (-look.yaw * Math.PI) / 180;
		camera.rotation.x = (look.pitch * Math.PI) / 180;
		camera.fov = look.fov;
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld(true);
	}

	function resize() {
		const w = view.clientWidth || 640;
		const h = view.clientHeight || 360;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		applyCamera();
	}

	function directionAt(clientX, clientY) {
		const r = view.getBoundingClientRect();
		const nx = ((clientX - r.left) / r.width) * 2 - 1;
		const ny = -(((clientY - r.top) / r.height) * 2 - 1);
		const v = new THREE.Vector3(nx, ny, 0.5).unproject(camera).normalize();
		return v;
	}

	function pickDirection(v) {
		const a = rayToYawPitch(v.x, v.y, v.z);
		picked = { yaw_deg: a.yaw_deg, pitch_deg: a.pitch_deg, t_s: video.currentTime || 0 };
		marker.hidden = false;
		marker.classList.remove('is-new');
		void marker.offsetWidth;
		marker.classList.add('is-new');
		onPick({ ...picked });
	}

	const markerDir = new THREE.Vector3();
	function placeMarker() {
		if (!picked) return;
		const d = yawPitchToDirection(picked.yaw_deg, picked.pitch_deg);
		markerDir.set(d.x, d.y, d.z);
		const p = markerDir.clone().multiplyScalar(5).project(camera);
		const behind = markerDir.clone().applyQuaternion(camera.quaternion.clone().invert()).z > 0;
		if (behind || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) {
			marker.style.visibility = 'hidden';
			return;
		}
		marker.style.visibility = 'visible';
		marker.style.left = `${((p.x + 1) / 2) * view.clientWidth}px`;
		marker.style.top = `${((1 - p.y) / 2) * view.clientHeight}px`;
	}

	function frame() {
		if (disposed) return;
		raf = requestAnimationFrame(frame);
		renderer.render(scene, camera);
		placeMarker();
	}

	// Pointer: drag looks around, a click without movement picks.
	let down = null;
	view.addEventListener('pointerdown', (e) => {
		if (e.button !== undefined && e.button !== 0) return;
		view.setPointerCapture?.(e.pointerId);
		down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
	});
	view.addEventListener('pointermove', (e) => {
		if (!down) return;
		if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) {
			down.moved = true;
			view.classList.add('is-dragging');
		}
		if (!down.moved) return;
		const perPx = look.fov / (view.clientHeight || 360);
		look.yaw = wrapYaw(look.yaw - (e.clientX - down.lx) * perPx);
		look.pitch += (e.clientY - down.ly) * perPx;
		down.lx = e.clientX;
		down.ly = e.clientY;
		applyCamera();
	});
	const end = (e) => {
		if (!down) return;
		const wasClick = !down.moved && e.type === 'pointerup';
		down = null;
		view.classList.remove('is-dragging');
		if (wasClick) pickDirection(directionAt(e.clientX, e.clientY));
	};
	view.addEventListener('pointerup', end);
	view.addEventListener('pointercancel', end);
	view.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			look.fov += e.deltaY * 0.04;
			applyCamera();
		},
		{ passive: false },
	);
	view.addEventListener('keydown', (e) => {
		const step = e.shiftKey ? 15 : 5;
		let handled = true;
		if (e.key === 'ArrowLeft') look.yaw = wrapYaw(look.yaw - step);
		else if (e.key === 'ArrowRight') look.yaw = wrapYaw(look.yaw + step);
		else if (e.key === 'ArrowUp') look.pitch += step;
		else if (e.key === 'ArrowDown') look.pitch -= step;
		else if (e.key === '+' || e.key === '=') look.fov -= 8;
		else if (e.key === '-') look.fov += 8;
		else if (e.key === 'Enter' || e.key === ' ') pickDirection(directionAt(...centre()));
		else handled = false;
		if (handled) {
			e.preventDefault();
			applyCamera();
		}
	});
	function centre() {
		const r = view.getBoundingClientRect();
		return [r.left + r.width / 2, r.top + r.height / 2];
	}

	const ro = new ResizeObserver(resize);
	ro.observe(view);
	resize();

	video.addEventListener(
		'loadeddata',
		() => {
			skeleton.hidden = true;
			video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
			onReady(video);
			raf = requestAnimationFrame(frame);
		},
		{ once: true },
	);
	video.addEventListener(
		'error',
		() => {
			skeleton.hidden = true;
			onUnplayable();
		},
		{ once: true },
	);
	video.load();

	return {
		video,
		clearMarker() {
			picked = null;
			marker.hidden = true;
		},
		dispose() {
			disposed = true;
			cancelAnimationFrame(raf);
			ro.disconnect();
			video.pause();
			video.removeAttribute('src');
			video.load();
			URL.revokeObjectURL(objectUrl);
			texture.dispose();
			geo.dispose();
			mesh.material.dispose();
			renderer.dispose();
			view.replaceChildren();
		},
	};
}

// ---------------------------------------------------------------------------
// DOM: the stage a page mounts for 360 input
// ---------------------------------------------------------------------------

/**
 * Mount the 360 stage into `host` (an element inside the page's stage). The
 * page calls review(file, inspection) after a file is chosen and 360 is
 * detected; the stage calls back:
 *   onStart(file, capture)  capture is { projection: 'equirect', subject? }
 *   onRegular(file)         the visitor says this is a regular video
 *   onCancel()              the visitor chose another video
 */
export function createMotion360Stage(host, { onStart, onRegular, onCancel }) {
	ensureStyle();
	host.classList.add('m360-host');
	let picker = null;
	let current = null;

	function setPicking(on) {
		host.parentElement?.classList.toggle('m360-picking', on);
	}

	function teardown() {
		picker?.dispose();
		picker = null;
	}

	function hide() {
		teardown();
		host.replaceChildren();
		setPicking(false);
		host.hidden = true;
		current = null;
	}

	function message(title, text, actions, extra) {
		teardown();
		host.replaceChildren(
			el('div', { class: 'm360-message', role: 'alert' }, [
				el('h3', { text: title }),
				el('p', { text }),
				extra,
				el('div', { class: 'm360-actions' }, actions),
			]),
		);
		setPicking(true);
		host.hidden = false;
	}

	function reviewRaw(file) {
		message(
			'This is a raw camera file',
			'Motion capture needs a stitched 360 clip. Export a 360 MP4 from Insta360 Studio or the camera app and drop that here. To turn raw .insv footage into a 3D scene instead, use the capture page.',
			[
				el('button', { class: 'm360-btn m360-btn--primary', type: 'button', text: 'Choose another video', onclick: () => onCancel() }),
				el('a', { class: 'm360-btn', href: '/capture', text: 'Open 3D scene capture', style: 'text-decoration:none' }),
			],
		);
		current = { file, raw: true };
	}

	async function review(file, inspection) {
		teardown();
		current = { file, inspection, pick: null };
		if (inspection?.kind === 'raw') return reviewRaw(file);

		const readout = el('p', { class: 'm360-readout', 'aria-live': 'polite' });
		const startBtn = el('button', { class: 'm360-btn m360-btn--primary', type: 'button', text: 'Track the person I picked', disabled: '' });
		const autoBtn = el('button', { class: 'm360-btn', type: 'button', text: 'Pick for me' });
		const view = el('div', {
			class: 'm360-view',
			tabindex: '0',
			role: 'application',
			'aria-label': '360 preview. Drag to look around, click the person to follow. With the keyboard, use arrow keys to look and Enter to pick the centre.',
		});
		const scrub = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0', 'aria-label': 'Scrub the clip', disabled: '' });
		const timeOut = el('output', { text: '0:00 / 0:00' });
		const playBtn = el('button', { class: 'm360-btn', type: 'button', text: 'Play', disabled: '' });
		const hint = el('div', { class: 'm360-hint', text: 'Drag to look around. Click the person to follow.' });

		const dims = inspection?.width ? ` · ${inspection.width} x ${inspection.height}` : '';
		host.replaceChildren(
			el('div', { class: 'm360-head' }, [
				el('span', { class: 'm360-badge', text: '360 clip' }),
				el('span', { class: 'm360-file', text: `${file.name}${dims}` }),
				el('button', {
					class: 'm360-link',
					type: 'button',
					text: 'This is a regular video',
					onclick: () => onRegular(file),
				}),
			]),
			view,
			el('div', { class: 'm360-scrub' }, [playBtn, scrub, timeOut]),
			readout,
			el('div', { class: 'm360-actions' }, [
				startBtn,
				autoBtn,
				el('button', { class: 'm360-btn', type: 'button', text: 'Choose another video', onclick: () => onCancel() }),
			]),
			el('p', { class: 'm360-note', text: 'Scrub to a moment where the person is visible, then click them. Only the direction is sent, never a picture. Pick for me finds the most prominent person on its own.' }),
		);
		view.append(hint);
		setPicking(true);
		host.hidden = false;

		const setReadout = (html) => {
			readout.replaceChildren(...html);
		};
		setReadout([document.createTextNode('Nothing picked yet. Pick for me works when you are not sure.')]);

		const setPick = (p) => {
			current.pick = p;
			startBtn.disabled = false;
			hint.style.opacity = '0';
			const strong = (t) => el('strong', { text: t });
			setReadout([
				document.createTextNode('Following the person at yaw '),
				strong(`${p.yaw_deg.toFixed(1)}°`),
				document.createTextNode(', pitch '),
				strong(`${p.pitch_deg.toFixed(1)}°`),
				document.createTextNode(p.t_s > 0.05 ? ` (picked at ${fmtTime(p.t_s)}). Click again to move it.` : '. Click again to move it.'),
			]);
		};

		startBtn.addEventListener('click', () => {
			if (!current.pick) return;
			const { yaw_deg, pitch_deg, t_s } = current.pick;
			onStart(file, { projection: 'equirect', subject: { yaw_deg, pitch_deg, t_s } });
		});
		autoBtn.addEventListener('click', () => onStart(file, { projection: 'equirect' }));

		try {
			picker = await createSpherePicker(view, file, {
				onPick: setPick,
				onUnplayable() {
					view.replaceChildren(
						el('div', { class: 'm360-message' }, [
							el('h3', { text: 'Your browser cannot play this clip' }),
							el('p', { text: 'The preview needs a codec this browser can decode, so you cannot click the person here. Pick for me still works and finds the most prominent person automatically.' }),
						]),
					);
					view.removeAttribute('tabindex');
					view.style.cursor = 'default';
					scrub.disabled = true;
					playBtn.disabled = true;
				},
				onReady(video) {
					scrub.max = String(video.duration || 1);
					scrub.disabled = false;
					playBtn.disabled = false;
					const upd = () => {
						scrub.value = String(video.currentTime);
						timeOut.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration || 0)}`;
						playBtn.textContent = video.paused ? 'Play' : 'Pause';
					};
					video.addEventListener('timeupdate', upd);
					video.addEventListener('play', upd);
					video.addEventListener('pause', upd);
					scrub.addEventListener('input', () => {
						video.currentTime = Number(scrub.value);
					});
					playBtn.addEventListener('click', () => (video.paused ? video.play().catch(() => {}) : video.pause()));
					upd();
				},
			});
		} catch {
			view.replaceChildren(
				el('div', { class: 'm360-message' }, [
					el('h3', { text: 'The 360 preview could not start' }),
					el('p', { text: 'This browser could not create a 3D view. Pick for me still works and finds the most prominent person automatically.' }),
				]),
			);
		}
	}

	/** A designed error with a retry that returns to the same picker. */
	function failure({ title, text, retryLabel, onRetry, single = false }) {
		message(title, text, [
			el('button', { class: 'm360-btn m360-btn--primary', type: 'button', text: retryLabel, onclick: onRetry }),
			single ? null : el('button', { class: 'm360-btn', type: 'button', text: 'Choose another video', onclick: () => onCancel() }),
		]);
	}

	return { review, failure, hide, get file() { return current?.file || null; } };
}

// ---------------------------------------------------------------------------
// DOM: the "what the tracker followed" panel
// ---------------------------------------------------------------------------

/**
 * Mount the reframe panel into `host` (a card placed under the stage). show(url)
 * reveals it, hide() removes it, sync(time, playing) keeps the video on the
 * avatar timeline. A video that fails to load hides the panel again, so a
 * worker that returns a bad URL never leaves a broken player behind.
 */
export function createReframePanel(host) {
	ensureStyle();
	host.classList.add('m360-reframe');
	host.hidden = true;
	let video = null;

	function hide() {
		if (video) {
			video.pause();
			video.removeAttribute('src');
			video.load();
		}
		video = null;
		host.replaceChildren();
		host.hidden = true;
	}

	function show(url) {
		hide();
		video = el('video', {
			muted: '',
			playsinline: '',
			preload: 'auto',
			crossorigin: 'anonymous',
			'aria-label': 'The reframed video the tracker followed, in sync with the avatar',
		});
		video.muted = true;
		video.addEventListener('error', hide, { once: true });
		video.src = url;
		host.append(
			el('h2', { text: 'What the tracker followed' }),
			el('p', { text: 'The 360 clip is reframed to follow the person before the pose is read. This is that view, in sync with the avatar.' }),
			video,
		);
		host.hidden = false;
	}

	function sync(time, playing) {
		if (!video || video.readyState < 1 || video.seeking) return;
		const plan = planReframeSync({
			current: video.currentTime,
			target: time,
			paused: video.paused,
			wantPlaying: playing,
		});
		if (plan.seekTo !== null) video.currentTime = plan.seekTo;
		if (plan.action === 'play') video.play().catch(() => {});
		else if (plan.action === 'pause') video.pause();
	}

	return { show, hide, sync, get visible() { return !host.hidden; } };
}

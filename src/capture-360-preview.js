// Instant, local previews for the /capture 360 mode. Nothing here uploads a byte.
//
//   mountSpherePlayer(host, file)  stitched 2:1 video on the inside of a sphere,
//                                  drag, wheel and pinch to look, gyro on phones.
//   mountGyroPreview(host, files)  raw .insv through GyroView (MIT, lazy loaded,
//                                  needs WebGL2 and hardware HEVC decode).
//   detectGyroSupport()            says up front whether the GyroView path can run.
//
// Both return a handle with the same small surface the trim timeline drives:
// `duration`, `currentTime`, `seek(t)`, `play()`, `pause()`, `setRange(a, b)`,
// `onTime(fn)`, `dispose()`.

const PREVIEW_FALLBACK = "Preview isn't available in this browser. Your file will still work; we stitch it on our servers.";

export const PREVIEW_MESSAGES = Object.freeze({
	fallback: PREVIEW_FALLBACK,
	'codec-unsupported': PREVIEW_FALLBACK,
	'webcodecs-unavailable': PREVIEW_FALLBACK,
	'render-unavailable': PREVIEW_FALLBACK,
	'missing-second-file': 'This recording is split across two files. Add the matching file from the same shot to preview it. You can also upload this one alone.',
	'invalid-trailer': "We couldn't read this recording for a preview. It may be cut short or not from a 360 camera. You can still upload it.",
	'unsupported-container': "We couldn't read this recording for a preview. You can still upload it.",
	'no-calibration': "This recording has no lens calibration, so the preview can't stitch it. You can still upload it.",
});

/** Wrap a rejection so the controller can show designed copy for it. */
export class PreviewError extends Error {
	constructor(code, message = PREVIEW_MESSAGES[code] || PREVIEW_FALLBACK) {
		super(message);
		this.name = 'PreviewError';
		this.code = code;
	}
}

// ── GyroView feature detection ────────────────────────────────────────────────

const HEVC_CONFIGS = ['hvc1.1.6.L153.B0', 'hev1.1.6.L120.B0', 'hvc1.1.6.L93.B0'];

/** Resolves `{ ok, reason }`. Never throws. */
export async function detectGyroSupport(env = globalThis) {
	try {
		if (!env.isSecureContext) return { ok: false, reason: 'webcodecs-unavailable' };
		if (typeof env.VideoDecoder === 'undefined') return { ok: false, reason: 'webcodecs-unavailable' };
		const canvas = env.document?.createElement?.('canvas');
		if (!canvas?.getContext?.('webgl2')) return { ok: false, reason: 'render-unavailable' };
		for (const codec of HEVC_CONFIGS) {
			const res = await env.VideoDecoder.isConfigSupported({
				codec,
				codedWidth: 1920,
				codedHeight: 1920,
				hardwareAcceleration: 'prefer-hardware',
			});
			if (res?.supported) return { ok: true };
		}
		return { ok: false, reason: 'codec-unsupported' };
	} catch {
		return { ok: false, reason: 'webcodecs-unavailable' };
	}
}

// ── shared handle plumbing ────────────────────────────────────────────────────

function timeBus() {
	const listeners = new Set();
	return {
		on(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		emit(t) {
			for (const fn of listeners) fn(t);
		},
	};
}

// ── 2:1 equirect video on a sphere ────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {HTMLElement} host   positioned element the canvas fills
 * @param {File} file          a 2:1 video the browser can decode
 */
export async function mountSpherePlayer(host, file) {
	const THREE = await import('three');

	const url = URL.createObjectURL(file);
	const video = document.createElement('video');
	video.muted = true;
	video.loop = false;
	video.playsInline = true;
	video.preload = 'auto';
	video.crossOrigin = 'anonymous';
	video.src = url;

	const dropUrl = () => URL.revokeObjectURL(url);
	try {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new PreviewError('fallback')), 20000);
			video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
			video.addEventListener('error', () => { clearTimeout(timer); reject(new PreviewError('codec-unsupported')); }, { once: true });
		});
	} catch (err) {
		dropUrl();
		throw err;
	}
	if (!video.videoWidth || !Number.isFinite(video.duration)) {
		dropUrl();
		throw new PreviewError('codec-unsupported');
	}

	host.innerHTML = '';
	const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	const canvas = renderer.domElement;
	canvas.className = 'c3-canvas';
	canvas.tabIndex = 0;
	canvas.setAttribute('role', 'application');
	canvas.setAttribute('aria-label', '360 preview. Drag or use the arrow keys to look around, plus and minus to zoom.');
	host.appendChild(canvas);

	// Some GPUs cap textures at 4096 or 8192. A larger video is drawn down through a
	// canvas rather than shown as a black sphere.
	const maxTex = renderer.capabilities.maxTextureSize;
	const tooBig = video.videoWidth > maxTex || video.videoHeight > maxTex;
	let texture;
	let scratch = null;
	if (tooBig) {
		const scale = maxTex / Math.max(video.videoWidth, video.videoHeight);
		scratch = document.createElement('canvas');
		scratch.width = Math.floor(video.videoWidth * scale);
		scratch.height = Math.floor(video.videoHeight * scale);
		texture = new THREE.CanvasTexture(scratch);
	} else {
		texture = new THREE.VideoTexture(video);
	}
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
	const geometry = new THREE.SphereGeometry(500, 64, 40);
	geometry.scale(-1, 1, 1);
	const material = new THREE.MeshBasicMaterial({ map: texture });
	scene.add(new THREE.Mesh(geometry, material));

	let lon = 0;
	let lat = 0;
	let fov = 75;
	let gyro = null;
	let disposed = false;
	let raf = 0;
	let visible = true;
	let range = { start: 0, end: video.duration };
	const bus = timeBus();

	const resize = () => {
		const w = Math.max(1, host.clientWidth);
		const h = Math.max(1, host.clientHeight);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	};
	const ro = new ResizeObserver(resize);
	ro.observe(host);
	resize();

	const orientation = new THREE.Quaternion();
	const euler = new THREE.Euler();
	const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
	const zee = new THREE.Vector3(0, 0, 1);
	const deviceQuaternion = (alpha, beta, gamma, screenDeg) => {
		const rad = Math.PI / 180;
		euler.set(beta * rad, alpha * rad, -gamma * rad, 'YXZ');
		orientation.setFromEuler(euler);
		orientation.multiply(q1);
		orientation.multiply(new THREE.Quaternion().setFromAxisAngle(zee, -screenDeg * rad));
		return orientation;
	};

	const draw = () => {
		if (scratch) scratch.getContext('2d').drawImage(video, 0, 0, scratch.width, scratch.height);
		if (scratch) texture.needsUpdate = true;
		camera.fov = fov;
		camera.updateProjectionMatrix();
		if (gyro) {
			const screenDeg = (screen.orientation && screen.orientation.angle) || 0;
			const q = deviceQuaternion(gyro.alpha, gyro.beta, gyro.gamma, screenDeg);
			// The sphere is viewed from its centre, so the device attitude is the camera's.
			camera.quaternion.copy(q);
			camera.rotateY(-gyro.offset);
		} else {
			const phi = THREE.MathUtils.degToRad(90 - lat);
			const theta = THREE.MathUtils.degToRad(lon);
			camera.lookAt(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
		}
		renderer.render(scene, camera);
	};

	let lastEmit = 0;
	const tick = () => {
		raf = 0;
		if (disposed) return;
		if (!video.paused && video.currentTime >= range.end) {
			video.currentTime = range.start;
		}
		if (visible && !document.hidden) draw();
		const now = performance.now();
		if (now - lastEmit > 100) {
			lastEmit = now;
			bus.emit(video.currentTime);
		}
		raf = requestAnimationFrame(tick);
	};
	raf = requestAnimationFrame(tick);

	const io = new IntersectionObserver((entries) => {
		visible = entries.some((e) => e.isIntersecting);
	});
	io.observe(host);

	// Pointer look: drag turns, wheel and pinch zoom.
	const pointers = new Map();
	let pinch = 0;
	const onDown = (e) => {
		canvas.setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			pinch = Math.hypot(a.x - b.x, a.y - b.y);
		}
	};
	const onMove = (e) => {
		const p = pointers.get(e.pointerId);
		if (!p) return;
		const dx = e.clientX - p.x;
		const dy = e.clientY - p.y;
		p.x = e.clientX;
		p.y = e.clientY;
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const d = Math.hypot(a.x - b.x, a.y - b.y);
			if (pinch) fov = clamp(fov * (pinch / d), 30, 100);
			pinch = d;
			return;
		}
		const k = fov / 75 * 0.14;
		if (gyro) gyro.offset += THREE.MathUtils.degToRad(dx * k);
		else {
			lon -= dx * k;
			lat = clamp(lat + dy * k, -85, 85);
		}
	};
	const onUp = (e) => {
		pointers.delete(e.pointerId);
		pinch = 0;
	};
	const onWheel = (e) => {
		e.preventDefault();
		fov = clamp(fov + e.deltaY * 0.05, 30, 100);
	};
	const onKey = (e) => {
		const step = 4;
		if (e.key === 'ArrowLeft') lon -= step;
		else if (e.key === 'ArrowRight') lon += step;
		else if (e.key === 'ArrowUp') lat = clamp(lat + step, -85, 85);
		else if (e.key === 'ArrowDown') lat = clamp(lat - step, -85, 85);
		else if (e.key === '+' || e.key === '=') fov = clamp(fov - 5, 30, 100);
		else if (e.key === '-') fov = clamp(fov + 5, 30, 100);
		else if (e.key === '0') { lon = 0; lat = 0; fov = 75; }
		else return;
		e.preventDefault();
	};
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointermove', onMove);
	canvas.addEventListener('pointerup', onUp);
	canvas.addEventListener('pointercancel', onUp);
	canvas.addEventListener('wheel', onWheel, { passive: false });
	canvas.addEventListener('keydown', onKey);

	const onOrient = (e) => {
		if (e.alpha == null && e.beta == null) return;
		const prev = gyro?.offset || 0;
		gyro = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0, offset: prev };
	};

	return {
		kind: 'sphere',
		width: video.videoWidth,
		height: video.videoHeight,
		get duration() { return video.duration; },
		get currentTime() { return video.currentTime; },
		get paused() { return video.paused; },
		video,
		seek(t) { video.currentTime = clamp(t, 0, video.duration); },
		async play() {
			if (video.currentTime < range.start || video.currentTime >= range.end) video.currentTime = range.start;
			try { await video.play(); } catch { /* a blocked start leaves the preview paused */ }
		},
		pause() { video.pause(); },
		setRange(start, end) { range = { start, end }; },
		onTime: bus.on,
		get gyroAvailable() { return typeof window.DeviceOrientationEvent !== 'undefined' && 'ontouchstart' in window; },
		get gyroActive() { return Boolean(gyro); },
		/** Start the phone gyroscope; iOS needs this called from a tap. */
		async enableGyro() {
			const DOE = window.DeviceOrientationEvent;
			if (!DOE) return { ok: false, reason: 'unsupported' };
			if (typeof DOE.requestPermission === 'function') {
				const answer = await DOE.requestPermission().catch(() => 'denied');
				if (answer !== 'granted') return { ok: false, reason: 'denied' };
			}
			window.addEventListener('deviceorientation', onOrient);
			const first = await new Promise((resolve) => {
				const t = setTimeout(() => resolve(false), 1500);
				const probe = (e) => {
					if (e.alpha == null && e.beta == null) return;
					clearTimeout(t);
					window.removeEventListener('deviceorientation', probe);
					resolve(true);
				};
				window.addEventListener('deviceorientation', probe);
			});
			if (!first) {
				window.removeEventListener('deviceorientation', onOrient);
				return { ok: false, reason: 'no_sensor' };
			}
			return { ok: true };
		},
		disableGyro() {
			window.removeEventListener('deviceorientation', onOrient);
			gyro = null;
		},
		/** A small still of the current frame, for the trim timeline. */
		screenshot(w = 96, h = 48) {
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			c.getContext('2d').drawImage(video, 0, 0, w, h);
			return c;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			cancelAnimationFrame(raf);
			ro.disconnect();
			io.disconnect();
			window.removeEventListener('deviceorientation', onOrient);
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointermove', onMove);
			canvas.removeEventListener('pointerup', onUp);
			canvas.removeEventListener('pointercancel', onUp);
			canvas.removeEventListener('wheel', onWheel);
			canvas.removeEventListener('keydown', onKey);
			video.pause();
			video.removeAttribute('src');
			video.load();
			dropUrl();
			texture.dispose();
			material.dispose();
			geometry.dispose();
			renderer.dispose();
			canvas.remove();
		},
	};
}

// ── thumbnails ────────────────────────────────────────────────────────────────

/**
 * Sample `count` stills across a video file with a second, hidden element so the
 * visible player never jumps. Calls `onThumb(index, canvas)` as each lands.
 * Resolves quietly when the browser cannot seek the file; the timeline then
 * simply shows no thumbnails.
 */
export async function sampleThumbnails(file, count, onThumb, { signal, width = 96, height = 48 } = {}) {
	const url = URL.createObjectURL(file);
	const video = document.createElement('video');
	video.muted = true;
	video.preload = 'auto';
	video.playsInline = true;
	video.src = url;
	try {
		await new Promise((resolve, reject) => {
			video.addEventListener('loadeddata', resolve, { once: true });
			video.addEventListener('error', reject, { once: true });
		});
		const duration = video.duration;
		if (!Number.isFinite(duration) || duration <= 0) return;
		for (let i = 0; i < count; i++) {
			if (signal?.aborted) return;
			const t = ((i + 0.5) / count) * duration;
			await new Promise((resolve) => {
				const done = () => resolve();
				video.addEventListener('seeked', done, { once: true });
				video.currentTime = t;
			});
			const c = document.createElement('canvas');
			c.width = width;
			c.height = height;
			c.getContext('2d').drawImage(video, 0, 0, width, height);
			onThumb(i, c);
		}
	} catch {
		/* no thumbnails for a file the browser cannot seek */
	} finally {
		video.removeAttribute('src');
		video.load();
		URL.revokeObjectURL(url);
	}
}

// ── raw .insv through GyroView ────────────────────────────────────────────────

/**
 * Lazy-loads GyroView (a separate chunk, only on this mode) and plays the local
 * files stitched. Rejects with a PreviewError carrying a stable code; the
 * controller turns that into the designed message and carries on to upload.
 */
export async function mountGyroPreview(host, { main, second } = {}) {
	const support = await detectGyroSupport();
	if (!support.ok) throw new PreviewError(support.reason);

	try {
		await import('@bubo-squared/gyroview/define');
	} catch {
		throw new PreviewError('fallback');
	}

	host.innerHTML = '';
	const el = document.createElement('gyro-view');
	el.className = 'c3-gyro';
	el.setAttribute('view-mode', 'normal');
	el.setAttribute('stabilization', 'horizon');
	el.setAttribute('muted', '');
	el.setAttribute('controls', '');
	el.setAttribute('loop', '');
	host.appendChild(el);

	try {
		await new Promise((resolve, reject) => {
			const onReady = () => { cleanup(); resolve(); };
			const onError = (e) => {
				cleanup();
				const code = e.detail?.code;
				reject(new PreviewError(PREVIEW_MESSAGES[code] ? code : 'fallback'));
			};
			const cleanup = () => {
				el.removeEventListener('ready', onReady);
				el.removeEventListener('error', onError);
				clearTimeout(timer);
			};
			const timer = setTimeout(() => { cleanup(); reject(new PreviewError('fallback')); }, 45000);
			el.addEventListener('ready', onReady);
			el.addEventListener('error', onError);
			Promise.resolve(el.loadFiles({ main, second })).catch(onError);
		});
	} catch (err) {
		el.remove();
		throw err;
	}

	const bus = timeBus();
	const onTime = () => bus.emit(el.currentTime);
	el.addEventListener('timeupdate', onTime);

	let range = { start: 0, end: el.duration };
	const onTick = () => {
		if (!el.paused && el.currentTime >= range.end) el.seek(range.start);
	};
	el.addEventListener('timeupdate', onTick);

	return {
		kind: 'gyro',
		get duration() { return el.duration; },
		get currentTime() { return el.currentTime; },
		get paused() { return el.paused; },
		seek(t) { el.seek(clamp(t, 0, el.duration)); },
		async play() { try { await el.play(); } catch { /* blocked start */ } },
		pause() { el.pause(); },
		setRange(start, end) { range = { start, end }; },
		onTime: bus.on,
		gyroAvailable: false,
		dispose() {
			el.removeEventListener('timeupdate', onTime);
			el.removeEventListener('timeupdate', onTick);
			try { el.stop(); } catch { /* already idle */ }
			el.remove();
		},
	};
}

// splat-hotspots: annotation hotspots, a camera timeline built from them, and a
// real in-browser video export of the resulting fly-through, for the Splat Viewer.
//
// A hotspot is a named camera view (position + orbit target) captured from
// wherever the user is currently looking, plus a time in seconds. Ordering
// the hotspots by time turns them into a camera path: scrub it, play it, or
// record the canvas while it plays to export a video, all without leaving
// the page or touching a server, since the splat itself never leaves the
// browser either.
//
// This module owns no render loop of its own. It rides the single hook
// `src/splat-stage.js` exposes for exactly this (`scene.setOnFrame`), so a
// camera-path playback and the one render loop a mounted scene owns can never
// drift out of sync with each other.

export const MAX_HOTSPOTS = 25;
const EXPORT_FPS = 30;
const DEFAULT_SPACING_S = 2.5;
const TWEEN_MS = 650;

const $ = (s, r = document) => r.querySelector(s);

function smoothstep(u) {
	const c = Math.max(0, Math.min(1, u));
	return c * c * (3 - 2 * c);
}

// Sample the camera path at time `t`: clamp to the ends, ease each segment.
function sampleCamera(kfs, t) {
	if (!kfs.length) return null;
	if (t <= kfs[0].time) return { position: kfs[0].position.clone(), target: kfs[0].target.clone() };
	const last = kfs[kfs.length - 1];
	if (t >= last.time) return { position: last.position.clone(), target: last.target.clone() };
	for (let i = 0; i < kfs.length - 1; i++) {
		const a = kfs[i], b = kfs[i + 1];
		if (t >= a.time && t <= b.time) {
			const span = b.time - a.time;
			const e = smoothstep(span > 0 ? (t - a.time) / span : 1);
			return { position: a.position.clone().lerp(b.position, e), target: a.target.clone().lerp(b.target, e) };
		}
	}
	return { position: last.position.clone(), target: last.target.clone() };
}

function pickRecordingMimeType() {
	if (typeof MediaRecorder === 'undefined') return null;
	for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
		if (MediaRecorder.isTypeSupported(t)) return t;
	}
	return null;
}

function fmtTime(s) {
	return `${Math.max(0, s).toFixed(1)}s`;
}

/**
 * Wire the hotspot list, camera timeline, and video export controls. The
 * caller owns scene lifecycle and must call `onSceneChanged(scene|null)`
 * whenever the mounted splat scene changes (new load, or torn down).
 *
 * @returns {{onSceneChanged: Function, reset: Function}}
 */
export function initHotspotTimeline() {
	const card = $('#sp-timeline-card');
	const list = $('#sp-hotspot-list');
	const empty = $('#sp-hotspot-empty');
	const addBtn = $('#sp-hotspot-add');
	const exportBtn = $('#sp-export-video');
	const playBtn = $('#sp-timeline-play');
	const scrub = $('#sp-timeline-scrub');
	const timeLabel = $('#sp-timeline-time');
	const status = $('#sp-export-status');
	const markersHost = $('#sp-stage');
	if (!card || !list || !markersHost) return { onSceneChanged() {}, reset() {} };

	/** @type {{id:number, name:string, time:number, position:import('three').Vector3, target:import('three').Vector3}[]} */
	let hotspots = [];
	let seq = 0;
	let currentScene = null;
	const markers = new Map(); // id -> HTMLElement

	let playback = null; // { startWallMs, startTime, kfs, onDone }
	let tween = null; // { startWallMs, from:{position,target}, to:{position,target} }

	function sorted() {
		return [...hotspots].sort((a, b) => a.time - b.time || a.id - b.id);
	}

	function totalDuration() {
		const kfs = sorted();
		return kfs.length ? kfs[kfs.length - 1].time : 0;
	}

	function setStatus(msg, isError = false) {
		if (!status) return;
		if (!msg) { status.hidden = true; status.textContent = ''; return; }
		status.hidden = false;
		status.textContent = msg;
		status.classList.toggle('sp-note--error', isError);
	}

	// -- Markers (annotation dots projected onto the live canvas) ---------------
	function ensureMarker(h) {
		let el = markers.get(h.id);
		if (el) return el;
		el = document.createElement('button');
		el.type = 'button';
		el.className = 'sp-hotspot-marker';
		el.setAttribute('aria-label', `Jump to camera view: ${h.name}`);
		el.addEventListener('click', (e) => { e.stopPropagation(); goTo(h.id); });
		markersHost.appendChild(el);
		markers.set(h.id, el);
		return el;
	}

	function pruneMarkers() {
		const live = new Set(hotspots.map((h) => h.id));
		for (const [id, el] of markers) {
			if (!live.has(id)) { el.remove(); markers.delete(id); }
		}
	}

	function repositionMarkers(scene) {
		const w = scene.canvas.clientWidth || scene.canvas.width || 1;
		const h = scene.canvas.clientHeight || scene.canvas.height || 1;
		for (const spot of hotspots) {
			const el = ensureMarker(spot);
			const v = spot.target.clone().project(scene.camera);
			if (v.z > 1 || v.z < -1) { el.style.display = 'none'; continue; }
			el.style.display = '';
			el.style.left = `${((v.x * 0.5 + 0.5) * w).toFixed(1)}px`;
			el.style.top = `${((1 - (v.y * 0.5 + 0.5)) * h).toFixed(1)}px`;
			el.textContent = String(sorted().findIndex((s) => s.id === spot.id) + 1);
		}
	}

	// -- Per-frame hook, installed on whatever scene is currently live ----------
	function onFrame() {
		const scene = currentScene;
		if (!scene) return;
		if (tween) {
			const u = smoothstep((performance.now() - tween.startWallMs) / TWEEN_MS);
			scene.camera.position.copy(tween.from.position.clone().lerp(tween.to.position, u));
			scene.controls.target.copy(tween.from.target.clone().lerp(tween.to.target, u));
			scene.controls.update();
			if (u >= 1) tween = null;
		} else if (playback) {
			const t = playback.startTime + (performance.now() - playback.startWallMs) / 1000;
			const sample = sampleCamera(playback.kfs, t);
			if (sample) {
				scene.camera.position.copy(sample.position);
				scene.controls.target.copy(sample.target);
				scene.controls.update();
			}
			updateScrubUI(Math.min(t, totalDuration()));
			if (t >= totalDuration()) {
				const done = playback.onDone;
				playback = null;
				setPlayUI(false);
				done?.();
			}
		}
		repositionMarkers(scene);
	}

	function updateScrubUI(t) {
		const total = totalDuration();
		if (scrub) {
			scrub.max = String(Math.max(total, 0.01));
			scrub.value = String(t);
		}
		if (timeLabel) timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(total)}`;
	}

	function setPlayUI(isPlaying) {
		if (!playBtn) return;
		playBtn.textContent = isPlaying ? '⏸' : '▶';
		playBtn.setAttribute('aria-label', isPlaying ? 'Pause camera path' : 'Play camera path');
		playBtn.title = isPlaying ? 'Pause camera path' : 'Play camera path';
	}

	// -- Actions ------------------------------------------------------------------
	function goTo(id) {
		const scene = currentScene;
		const spot = hotspots.find((h) => h.id === id);
		if (!scene || !spot) return;
		playback = null;
		setPlayUI(false);
		tween = {
			startWallMs: performance.now(),
			from: { position: scene.camera.position.clone(), target: scene.controls.target.clone() },
			to: { position: spot.position.clone(), target: spot.target.clone() },
		};
	}

	function addHotspot() {
		const scene = currentScene;
		if (!scene || hotspots.length >= MAX_HOTSPOTS) return;
		seq += 1;
		const time = hotspots.length ? Math.max(...hotspots.map((h) => h.time)) + DEFAULT_SPACING_S : 0;
		hotspots.push({
			id: seq,
			name: `Camera view ${seq}`,
			time,
			position: scene.camera.position.clone(),
			target: scene.controls.target.clone(),
		});
		render();
	}

	function removeHotspot(id) {
		hotspots = hotspots.filter((h) => h.id !== id);
		pruneMarkers();
		render();
	}

	function renameHotspot(id, name) {
		const spot = hotspots.find((h) => h.id === id);
		if (spot) spot.name = name.trim() || spot.name;
	}

	function retimeHotspot(id, time) {
		const spot = hotspots.find((h) => h.id === id);
		if (!spot) return;
		spot.time = Math.max(0, Number.isFinite(time) ? time : spot.time);
		render();
	}

	function nudge(id, dir) {
		const order = sorted();
		const i = order.findIndex((h) => h.id === id);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= order.length) return;
		const a = order[i], b = order[j];
		const t = a.time; a.time = b.time; b.time = t;
		render();
	}

	function play() {
		const kfs = sorted();
		if (kfs.length < 2) return;
		playback = { startWallMs: performance.now(), startTime: scrub ? Number(scrub.value) || 0 : 0, kfs, onDone: null };
		setPlayUI(true);
	}

	function pause() {
		playback = null;
		setPlayUI(false);
	}

	async function exportVideo() {
		const scene = currentScene;
		const kfs = sorted();
		if (!scene || kfs.length < 2) return;
		const mimeType = pickRecordingMimeType();
		if (!mimeType) {
			setStatus('This browser cannot record video (MediaRecorder is unavailable). Try a recent Chrome, Edge, or Firefox.', true);
			return;
		}
		exportBtn.disabled = true;
		addBtn.disabled = true;
		setStatus('Recording camera path…');
		try {
			const stream = scene.canvas.captureStream(EXPORT_FPS);
			const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
			const chunks = [];
			recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
			const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
			recorder.start();
			await new Promise((resolve) => {
				playback = { startWallMs: performance.now(), startTime: kfs[0].time, kfs, onDone: resolve };
				setPlayUI(true);
			});
			recorder.stop();
			await stopped;
			const blob = new Blob(chunks, { type: mimeType });
			const url = URL.createObjectURL(blob);
			setStatus('');
			const a = document.createElement('a');
			a.href = url;
			a.download = 'splat-camera-path.webm';
			a.textContent = `Download video (${(blob.size / 1024 / 1024).toFixed(1)} MB)`;
			a.className = 'sp-export-link';
			status.hidden = false;
			status.innerHTML = '';
			status.appendChild(a);
		} catch (err) {
			setStatus(`Recording failed: ${err.message}`, true);
			console.error('[splat] video export failed', err);
		} finally {
			exportBtn.disabled = false;
			addBtn.disabled = hotspots.length >= MAX_HOTSPOTS;
		}
	}

	// -- Render the list + button states ------------------------------------------
	function render() {
		const order = sorted();
		list.innerHTML = '';
		if (!order.length) {
			empty.hidden = false;
		} else {
			empty.hidden = true;
			order.forEach((h, idx) => list.appendChild(renderRow(h, idx, order.length)));
		}
		pruneMarkers();
		addBtn.disabled = hotspots.length >= MAX_HOTSPOTS;
		addBtn.title = hotspots.length >= MAX_HOTSPOTS ? `Up to ${MAX_HOTSPOTS} camera views per scene` : '';
		exportBtn.disabled = order.length < 2;
		exportBtn.title = order.length < 2 ? 'Save at least 2 camera views to export a path' : '';
		playBtn.disabled = order.length < 2;
		updateScrubUI(playback ? Number(scrub?.value) || 0 : Number(scrub?.value) || 0);
	}

	function renderRow(h, idx, total) {
		const li = document.createElement('li');
		li.className = 'sp-hotspot-row';

		const badge = document.createElement('span');
		badge.className = 'sp-hotspot-badge';
		badge.textContent = String(idx + 1);
		li.appendChild(badge);

		const name = document.createElement('input');
		name.className = 'sp-input sp-hotspot-name';
		name.value = h.name;
		name.setAttribute('aria-label', 'Camera view name');
		name.addEventListener('change', () => renameHotspot(h.id, name.value));
		li.appendChild(name);

		const time = document.createElement('input');
		time.type = 'number';
		time.min = '0';
		time.step = '0.1';
		time.className = 'sp-input sp-hotspot-time';
		time.value = h.time.toFixed(1);
		time.setAttribute('aria-label', 'Time in seconds');
		time.addEventListener('change', () => retimeHotspot(h.id, Number(time.value)));
		li.appendChild(time);

		const actions = document.createElement('div');
		actions.className = 'sp-hotspot-actions';

		const mkBtn = (label, title, onClick, disabled = false) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'sp-icon-btn';
			b.textContent = label;
			b.title = title;
			b.setAttribute('aria-label', title);
			b.disabled = disabled;
			b.addEventListener('click', onClick);
			return b;
		};
		actions.appendChild(mkBtn('↗', 'Jump to this view', () => goTo(h.id)));
		actions.appendChild(mkBtn('↑', 'Move earlier', () => nudge(h.id, -1), idx === 0));
		actions.appendChild(mkBtn('↓', 'Move later', () => nudge(h.id, 1), idx === total - 1));
		actions.appendChild(mkBtn('✕', 'Delete camera view', () => removeHotspot(h.id)));
		li.appendChild(actions);
		return li;
	}

	// -- Wiring ---------------------------------------------------------------------
	addBtn.addEventListener('click', addHotspot);
	exportBtn.addEventListener('click', exportVideo);
	playBtn.addEventListener('click', () => (playback ? pause() : play()));
	scrub?.addEventListener('input', () => {
		if (playback) pause();
		const t = Number(scrub.value) || 0;
		const scene = currentScene;
		const sample = sampleCamera(sorted(), t);
		if (scene && sample) {
			scene.camera.position.copy(sample.position);
			scene.controls.target.copy(sample.target);
			scene.controls.update();
		}
		updateScrubUI(t);
	});

	function reset() {
		hotspots = [];
		playback = null;
		tween = null;
		setStatus('');
		setPlayUI(false);
		for (const el of markers.values()) el.remove();
		markers.clear();
		render();
	}

	function onSceneChanged(scene) {
		currentScene = scene;
		reset();
		card.hidden = !scene;
		if (scene) scene.setOnFrame(onFrame);
	}

	render();
	card.hidden = true;
	return { onSceneChanged, reset };
}

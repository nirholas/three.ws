// /sonar: acoustic gesture control for a live 3D agent.
//
// Three layers, none of which knows about the other two:
//
//   • src/sonar/doppler.js  emits the carrier and reports one Reading per frame
//   • src/sonar/gestures.js turns Readings into sweep / push / lift events
//   • this file            maps those events onto the shared preview engine
//
// The mapping is the product decision: a sweep steps through the agent's
// gesture vocabulary (the same slots /gestures documents), a push dollies the
// camera, and a held lift turns it. Every one of them is also on the keyboard,
// so the page is complete on a machine with no microphone, in a browser that
// blocks one, and for anyone who is not going to wave at a laptop.

import { DopplerSensor, DIRECTION, DIRECTION_LABEL, TONE_CANDIDATES, isSupported, CALIBRATION_SECONDS } from './sonar/doppler.js';
import { SwipeDetector, PushPullDetector, LiftMotion } from './sonar/gestures.js';
import { GESTURE_CAST } from './sonar/controller.js';
import { DEFAULT_ANIMATION_MAP } from './runtime/animation-slots.js';

const MANIFEST_URL = '/animations/manifest.json';

/** The slots a sweep walks through. Shared with the <agent-3d> embed. */
const CAST = GESTURE_CAST;

/** Camera distance for each push step. Step 0 is the framed shot. */
const ZOOM_STEPS = [1, 1.18, 1.36, 1.6];

/**
 * Radians of turn per unit of lift travel. A hand held at full strength returns
 * about 700 units a second, which lands a full revolution at a little under two
 * seconds: fast enough to feel connected to the hand, slow enough to stop on a
 * face.
 */
const ORBIT_SCALE = 0.0045;

/** Which detectors are live. Running all three at once is opt-in; see MODES. */
const MODES = {
	swipe: { label: 'Sweep', detectors: ['swipe'] },
	push: { label: 'Push and pull', detectors: ['push'] },
	lift: { label: 'Lift', detectors: ['lift'] },
	all: { label: 'All three', detectors: ['swipe', 'push', 'lift'] },
};
const MODE_KEY = 'twx_sonar_mode';

const q = (role) => document.querySelector(`[data-role="${role}"]`);
const qa = (role) => Array.from(document.querySelectorAll(`[data-role="${role}"]`));

const state = {
	sensor: null,
	preview: null,
	clips: new Map(), // clip name -> manifest entry
	index: 0,
	playing: null,
	zoomSteps: 0,
	yaw: 0,
	log: [],
	lastReading: null,
	swipe: new SwipeDetector(),
	push: new PushPullDetector(),
	lift: new LiftMotion(),
	liftRaf: 0,
	liftLast: 0,
	running: false,
	signalCtx: null,
	mode: 'swipe',
	liftLabelAt: 0,
	logEmpty: null,
};

/* ── copy helpers ──────────────────────────────────────────────────────── */

function setStatus(el, text) {
	if (el && el.textContent !== text) el.textContent = text;
}

function flash(role, text) {
	const el = q(role);
	if (!el) return;
	el.textContent = text;
	el.classList.remove('is-live');
	// Restarting a CSS animation needs the class to actually leave the element
	// for a frame; toggling it in the same tick is a no-op.
	requestAnimationFrame(() => el.classList.add('is-live'));
}

function showError(title, detail) {
	const box = q('error');
	if (!box) return;
	q('error-title').textContent = title;
	q('error-detail').textContent = detail;
	box.hidden = false;
}

function clearError() {
	const box = q('error');
	if (box) box.hidden = true;
}

/* ── the 3D stage ──────────────────────────────────────────────────────── */

async function getPreview() {
	if (!state.preview) {
		const mod = await import('./animations-live-preview.js');
		state.preview = mod.getLivePreview();
	}
	return state.preview;
}

function setStageState(name, detail = '') {
	q('stage-empty').hidden = name !== 'empty';
	q('stage-loading').hidden = name !== 'loading';
	q('stage-error').hidden = name !== 'error';
	if (name === 'error' && detail) q('stage-error-title').textContent = detail;
}

async function loadManifest() {
	const res = await fetch(MANIFEST_URL);
	if (!res.ok) throw new Error(`The clip manifest answered ${res.status}.`);
	for (const clip of await res.json()) state.clips.set(clip.name, clip);
}

/**
 * Push the viewer's turn and zoom onto the stage. This page owns both numbers;
 * the preview is told the absolute value every time, so re-applying after a cut
 * cannot compound with the angle the stage is already holding.
 */
function applyView(preview) {
	preview.setZoom(ZOOM_STEPS[state.zoomSteps] ?? 1);
	preview.setYaw(state.yaw);
}

/**
 * Run something against the preview engine, reporting a failure on the stage
 * instead of throwing into a click handler or an animation frame. Every path
 * here touches a dynamic import and a clip fetch, so every path can fail.
 */
async function withPreview(fn) {
	try {
		return await fn(await getPreview());
	} catch (err) {
		setStageState('error', err?.message ? `The stage failed: ${err.message}` : undefined);
		return null;
	}
}

/**
 * Stage the gesture at `state.index`. A one-shot clip returns to idle on its
 * own last frame rather than freezing clamped at the end of it.
 */
async function playCurrent({ crossfade = 0.25 } = {}) {
	const slot = CAST[state.index];
	const name = DEFAULT_ANIMATION_MAP[slot];
	const def = state.clips.get(name);
	if (!def) {
		setStageState('error', `"${name}" is not in the clip manifest.`);
		return;
	}
	state.playing = slot;
	if (!state.preview) setStageState('loading');
	try {
		const preview = await getPreview();
		const loop = def.loop !== false;
		await preview.play(
			q('stage'),
			{ id: name, source: 'curated', url: def.url, loop },
			{
				crossfade,
				onFrame: loop
					? null
					: (t, d) => {
							// A crossfaded one-shot does not self-replay, so hand the stage
							// back to idle as the clip lands instead of leaving the agent
							// frozen on its last pose.
							if (state.playing === slot && d && t >= d - 0.12) toIdle();
						},
			},
		);
		if (state.playing !== slot) return;
		applyView(preview);
		setStageState('none');
	} catch (err) {
		if (state.playing !== slot) return;
		setStageState('error', err?.message ? `Preview failed: ${err.message}` : undefined);
	}
}

async function toIdle() {
	const def = state.clips.get(DEFAULT_ANIMATION_MAP.idle);
	if (!def) {
		setStageState('error', `"${DEFAULT_ANIMATION_MAP.idle}" is not in the clip manifest.`);
		return;
	}
	state.playing = 'idle';
	if (!state.preview) setStageState('loading');
	await withPreview(async (preview) => {
		await preview.play(
			q('stage'),
			{ id: def.name, source: 'curated', url: def.url, loop: true },
			{ crossfade: 0.35 },
		);
		if (state.playing !== 'idle') return;
		applyView(preview);
		setStageState('none');
	});
}

/* ── the three gestures ────────────────────────────────────────────────── */

function step(direction, source) {
	state.index = (state.index + direction + CAST.length) % CAST.length;
	flash('live-swipe', `${direction > 0 ? 'Next' : 'Previous'}: ${CAST[state.index]}`);
	logEvent(direction > 0 ? 'Sweep right' : 'Sweep left', CAST[state.index], source);
	playCurrent();
}

async function applyZoom(action, source) {
	if (action > 0) state.zoomSteps = 3;
	else if (action === 0) state.zoomSteps = 0;
	else state.zoomSteps = Math.max(0, state.zoomSteps - 1);
	await withPreview((preview) => preview.setZoom(ZOOM_STEPS[state.zoomSteps]));
	const label = state.zoomSteps === 0 ? 'Back to the framed shot' : `Camera in, step ${state.zoomSteps}`;
	flash('live-push', label);
	if (action > 0 || action === 0) logEvent(action > 0 ? 'Push' : 'Pull, released', label, source);
}

async function orbit(radians, source) {
	state.yaw += radians;
	await withPreview((preview) => preview.setYaw(state.yaw));
	if (source === 'keyboard') {
		flash('live-lift', `Turned ${radians > 0 ? 'right' : 'left'}`);
		logEvent('Turn', `${Math.round((state.yaw * 180) / Math.PI)}°`, source);
	}
}

/* ── the log ───────────────────────────────────────────────────────────── */

function logEvent(gesture, detail, source) {
	const reading = state.lastReading;
	const evidence =
		source === 'keyboard'
			? 'keyboard'
			: reading
				? `${DIRECTION_LABEL[reading.direction] || reading.direction}, ${(reading.strength * 1000).toFixed(2)} units, ${reading.snr.toFixed(0)} dB contrast`
				: '';
	state.log.unshift({
		gesture,
		detail,
		evidence,
		at: new Date().toLocaleTimeString([], { hour12: false }),
	});
	state.log = state.log.slice(0, 40);
	// The list itself is not a live region: replacing its markup would make a
	// screen reader re-read all forty rows on every gesture. One sentence for the
	// event that just happened is the whole announcement.
	setStatus(q('log-latest'), `${gesture}. ${detail}.`);
	renderLog();
}

function renderLog() {
	const list = q('log');
	if (!list) return;
	// The placeholder is pulled out of the list once and kept, because rendering
	// rows replaces the list's markup and would otherwise drop it for good.
	if (!state.logEmpty) state.logEmpty = q('log-empty');
	const empty = state.logEmpty;
	if (!state.log.length) {
		if (empty) empty.hidden = false;
		setStatus(q('log-count'), 'Nothing yet');
		return;
	}
	if (empty) empty.hidden = true;
	setStatus(q('log-count'), `${state.log.length} read`);
	const rows = state.log
		.map(
			(e) => `<li class="sn-log-row">
				<span class="sn-log-time">${e.at}</span>
				<span class="sn-log-gesture">${e.gesture}</span>
				<span class="sn-log-detail">${e.detail}</span>
				<span class="sn-log-evidence">${e.evidence}</span>
			</li>`,
		)
		.join('');
	list.innerHTML = rows;
	if (empty) list.prepend(empty);
}

/* ── the signal scope ──────────────────────────────────────────────────── */

function drawSignal(reading) {
	const canvas = q('signal');
	if (!canvas) return;
	if (!state.signalCtx) state.signalCtx = canvas.getContext('2d');
	const ctx = state.signalCtx;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const w = canvas.clientWidth || 640;
	const h = canvas.clientHeight || 180;
	if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);

	if (!reading) {
		ctx.fillStyle = 'rgba(255,255,255,0.28)';
		ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText('No signal. Start sensing to see the carrier.', 12, h / 2);
		return;
	}

	const { spectrumDb, baselineDb } = reading;
	const n = spectrumDb.length;
	// A fixed window keeps the trace from rescaling under its own motion, which
	// is what makes a shift readable rather than just busy.
	const top = Math.max(reading.carrierDb, -30) + 6;
	const bottom = top - 90;
	const x = (i) => (i / (n - 1)) * w;
	const y = (db) => h - ((Math.max(bottom, Math.min(top, db)) - bottom) / (top - bottom)) * h;

	const carrierX = x((n - 1) / 2);
	ctx.strokeStyle = 'rgba(255,255,255,0.16)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(carrierX, 0);
	ctx.lineTo(carrierX, h);
	ctx.stroke();

	const trace = (values, stroke, fill) => {
		ctx.beginPath();
		for (let i = 0; i < n; i++) {
			const px = x(i);
			const py = y(values[i]);
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 1.5;
		ctx.stroke();
		if (fill) {
			ctx.lineTo(w, h);
			ctx.lineTo(0, h);
			ctx.closePath();
			ctx.fillStyle = fill;
			ctx.fill();
		}
	};

	trace(baselineDb, 'rgba(255,255,255,0.35)', null);
	const moving =
		reading.direction === DIRECTION.approaching || reading.direction === DIRECTION.away;
	trace(spectrumDb, moving ? '#4ade80' : 'rgba(120,220,170,0.75)', 'rgba(74,222,128,0.10)');
}

/* ── sensing ───────────────────────────────────────────────────────────── */

function onReading(reading) {
	state.lastReading = reading;
	drawSignal(reading);

	const calibrating = reading.calibrationRemaining !== null;
	const panel = q('calibrating');
	if (panel) panel.hidden = !calibrating;
	if (calibrating) {
		const pct = 100 * (1 - reading.calibrationRemaining / CALIBRATION_SECONDS);
		q('calibrating-bar').style.width = `${pct.toFixed(0)}%`;
		q('calibrating-meter')?.setAttribute('aria-valuenow', pct.toFixed(0));
	}

	setStatus(q('hud-direction'), DIRECTION_LABEL[reading.direction] || reading.direction);
	setStatus(q('hud-tone'), `Carrier ${(reading.tone / 1000).toFixed(1)} kHz`);
	setStatus(q('hud-snr'), `Contrast ${reading.snr.toFixed(0)} dB`);
	const meter = q('hud-strength');
	if (meter) {
		// Log-scaled: the interesting range spans three orders of magnitude and a
		// linear bar spends all of it pinned at either end.
		const pct = Math.min(100, Math.max(0, (Math.log1p(reading.strength / 0.0003) / Math.log1p(40)) * 100));
		meter.style.width = `${pct.toFixed(1)}%`;
		meter.classList.toggle('is-hot', reading.strength > 0.002);
		const gauge = q('hud-meter');
		if (gauge) {
			gauge.setAttribute('aria-valuenow', pct.toFixed(0));
			gauge.setAttribute(
				'aria-valuetext',
				reading.strength > 0.0003
					? `${DIRECTION_LABEL[reading.direction] || reading.direction}, ${pct.toFixed(0)} percent`
					: 'No motion',
			);
		}
	}
	const hud = q('hud');
	if (hud) hud.dataset.direction = reading.direction;

	if (reading.direction === DIRECTION.weakTone) {
		setStatus(
			q('hud-direction'),
			'Carrier too faint. Raise the volume, or pick another carrier below.',
		);
	}

	// Only the detectors this mode owns get fed. The three gestures are not
	// separable at the hardware level: a sweep passes the microphone as an
	// approach followed by a retreat, which is also exactly what a push and a
	// pull look like. Sonar solves that with modes, and so does this.
	const now = performance.now() / 1000;
	const live = MODES[state.mode].detectors;

	if (live.includes('swipe')) {
		const swipe = state.swipe.feed(reading, now);
		if (swipe) {
			const reversed = q('reverse-swipe')?.checked;
			const forward = reversed ? swipe === 'previous' : swipe === 'next';
			step(forward ? 1 : -1, 'sonar');
		}
	}
	if (live.includes('push')) {
		const zoom = state.push.feed(reading, now, Boolean(q('reverse-zoom')?.checked));
		if (zoom !== null) applyZoom(zoom, 'sonar');
	}
	if (live.includes('lift')) state.lift.feed(reading, now);
}

/** Lift is continuous, so it advances on the display clock, not on readings. */
function liftLoop() {
	state.liftRaf = requestAnimationFrame(liftLoop);
	const now = performance.now() / 1000;
	const dt = state.liftLast ? Math.min(0.1, now - state.liftLast) : 0;
	state.liftLast = now;
	const travelled = state.lift.step(dt, now);
	if (!travelled) return;
	orbit(travelled * ORBIT_SCALE, 'sonar');
	// The turn updates every frame; the label does not need to.
	if (now - state.liftLabelAt > 0.2) {
		state.liftLabelAt = now;
		flash('live-lift', `Turning, ${Math.abs(state.lift.velocity).toFixed(0)} units`);
	}
}

async function start() {
	clearError();
	if (!isSupported()) return;
	q('start').disabled = true;
	setStatus(q('hud-direction'), 'Opening the microphone');
	state.sensor = new DopplerSensor({
		amplitude: Number(q('volume').value) / 100,
		onReading,
		onStatus: ({ state: s, message }) => {
			if (s === 'tuning' || s === 'starting') setStatus(q('hud-direction'), message);
		},
	});
	try {
		await state.sensor.start();
	} catch (err) {
		state.sensor = null;
		q('start').disabled = false;
		setStatus(q('hud-direction'), 'Not sensing');
		showError('The microphone could not be opened', err.message);
		return;
	}
	state.running = true;
	q('start').hidden = true;
	q('start').disabled = false;
	q('stop').hidden = false;
	q('recalibrate').disabled = false;
	syncToneSelect();
	state.swipe.reset();
	state.lift.reset();
	state.liftLast = 0;
	state.liftRaf = requestAnimationFrame(liftLoop);
	if (!state.preview) await toIdle();
}

function stop() {
	state.sensor?.stop();
	state.sensor = null;
	state.running = false;
	cancelAnimationFrame(state.liftRaf);
	state.liftRaf = 0;
	state.lift.reset();
	q('start').hidden = false;
	q('stop').hidden = true;
	q('recalibrate').disabled = true;
	const panel = q('calibrating');
	if (panel) panel.hidden = true;
	setStatus(q('hud-direction'), 'Not sensing');
	setStatus(q('hud-tone'), 'Carrier off');
	setStatus(q('hud-snr'), 'Contrast off');
	const meter = q('hud-strength');
	if (meter) meter.style.width = '0%';
	const gauge = q('hud-meter');
	if (gauge) {
		gauge.setAttribute('aria-valuenow', '0');
		gauge.setAttribute('aria-valuetext', 'No motion');
	}
	state.lastReading = null;
	drawSignal(null);
}

function syncToneSelect() {
	const select = q('tone');
	if (select && state.sensor) select.value = String(state.sensor.tone);
}

/* ── wiring ────────────────────────────────────────────────────────────── */

function buildToneSelect() {
	const select = q('tone');
	if (!select) return;
	select.innerHTML = TONE_CANDIDATES.map(
		(t) => `<option value="${t}">${(t / 1000).toFixed(1)} kHz</option>`,
	).join('');
	select.value = String(20000);
	select.addEventListener('change', () => {
		const tone = Number(select.value);
		if (state.sensor) {
			// A hand-picked carrier is a deliberate override of the automatic pick,
			// so stop re-choosing one on the next start.
			state.sensor.autoTone = false;
			state.sensor.setTone(tone);
		}
	});
}

function buildModes() {
	const row = document.querySelector('[data-role="modes"] .sn-modes-row');
	if (!row) return;
	let saved = null;
	try {
		saved = localStorage.getItem(MODE_KEY);
	} catch {
		// A browser with storage blocked still gets the default mode.
	}
	if (saved && MODES[saved]) state.mode = saved;
	row.innerHTML = Object.entries(MODES)
		.map(
			([key, def]) => `<label class="sn-mode">
				<input type="radio" name="sn-mode" value="${key}"${key === state.mode ? ' checked' : ''} />
				<span>${def.label}</span>
			</label>`,
		)
		.join('');
	row.addEventListener('change', (e) => {
		if (e.target.name !== 'sn-mode') return;
		state.mode = e.target.value;
		try {
			localStorage.setItem(MODE_KEY, state.mode);
		} catch {
			// Not persisting the choice is not a reason to refuse it.
		}
		// Whatever half-formed stroke the old mode was tracking is meaningless now.
		state.swipe.reset();
		state.push.clearEvidence();
		state.lift.reset();
		syncModeCards();
	});
	syncModeCards();
}

/** Dim the cards whose gesture the current mode is not listening for. */
function syncModeCards() {
	const live = MODES[state.mode].detectors;
	for (const card of document.querySelectorAll('.sn-card[data-gesture]')) {
		const on = live.includes(card.dataset.gesture);
		card.classList.toggle('is-off', !on);
		const label = q(`live-${card.dataset.gesture}`);
		if (!label) continue;
		if (!on) {
			label.classList.remove('is-live');
			label.textContent = 'Not in this mode';
		} else if (label.textContent === 'Not in this mode') {
			label.textContent = 'Waiting';
		}
	}
}

function bindControls() {
	q('start')?.addEventListener('click', start);
	q('stop')?.addEventListener('click', stop);
	q('retry')?.addEventListener('click', () => {
		clearError();
		start();
	});
	q('recalibrate')?.addEventListener('click', () => {
		state.sensor?.recalibrate();
		state.swipe.reset();
		state.lift.reset();
	});
	q('reset-view')?.addEventListener('click', async () => {
		state.zoomSteps = 0;
		state.yaw = 0;
		state.push.steps = 0;
		state.push.clearEvidence();
		await withPreview((preview) => preview.resetView());
		flash('live-push', 'Back to the framed shot');
	});
	q('reverse-lift')?.addEventListener('change', () => {
		// LiftMotion carries its own direction, so flipping it mid-turn drops the
		// motion in flight rather than reversing a moving camera under the hand.
		state.lift.switchDirection();
	});
	const volume = q('volume');
	volume?.addEventListener('input', () => {
		q('volume-out').textContent = `${volume.value}%`;
		state.sensor?.setAmplitude(Number(volume.value) / 100);
	});

	document.addEventListener('keydown', (e) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const tag = e.target?.tagName;
		if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
		const handlers = {
			ArrowRight: () => step(1, 'keyboard'),
			ArrowLeft: () => step(-1, 'keyboard'),
			'+': () => applyZoom(3, 'keyboard'),
			'=': () => applyZoom(3, 'keyboard'),
			'-': () => applyZoom(state.zoomSteps > 1 ? -1 : 0, 'keyboard'),
			']': () => orbit(0.35, 'keyboard'),
			'[': () => orbit(-0.35, 'keyboard'),
		};
		const handler = handlers[e.key];
		if (!handler) return;
		e.preventDefault();
		handler();
	});

	// A backgrounded tab should not keep a 20 kHz tone running in someone's room.
	document.addEventListener('visibilitychange', () => {
		if (document.hidden && state.running) stop();
	});
	window.addEventListener('pagehide', () => stop());
	window.addEventListener('resize', () => drawSignal(state.lastReading));
}

async function boot() {
	bindControls();
	buildToneSelect();
	buildModes();
	drawSignal(null);
	renderLog();

	if (!isSupported()) {
		const box = q('unsupported');
		if (box) box.hidden = false;
		q('start').disabled = true;
		q('start').textContent = 'Sensing unavailable';
		setStatus(q('hud-direction'), 'Keyboard control only');
	}

	try {
		await loadManifest();
		if (isSupported()) setStatus(q('hud-direction'), 'Ready');
	} catch (err) {
		showError('The gesture library could not be loaded', err.message);
	}
}

boot();

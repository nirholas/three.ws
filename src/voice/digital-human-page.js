// The browser digital human at /audio2face: hold to talk (or type), and a 3D
// avatar answers in NVIDIA Magpie's voice with its face driven by NVIDIA
// Audio2Face-3D. Conference-grade on purpose:
//
//   - Pipelined: each sentence of the reply is voiced and animated while the
//     LLM is still writing the next (src/voice/digital-human-pipeline.js).
//   - Self-healing: every stage has a fallback lane, the active lane is shown
//     on screen, and failed lanes are retried on a backoff, not every turn.
//   - Kiosk (?kiosk=1): tap-to-start fullscreen, a big push-to-talk button, an
//     attract loop when nobody is talking, and an automatic reset after idle.
//   - Latency HUD (L key, the HUD button, or ?hud=1): live per-stage ms.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getDecoders } from '../viewer/internal.js';
import { A2FPlayer } from './a2f-player.js';
import { AvatarMouthTarget } from './avatar-morph-target.js';
import { MicCapture, PcmDownsampler } from './mic-capture.js';
import {
	createDigitalHumanClient,
	runTurn,
	LaneHealth,
	STAGES,
	STAGE_LABELS,
	summarizeTimings,
} from './digital-human-pipeline.js';
import { StreamSpeechPlayer } from './stream-speech-player.js';
import { speakWithVisemes, browserVoiceSupported } from './viseme-fallback.js';
import { gateUtterance, encodeWav } from './utterance-gate.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const KIOSK = params.get('kiosk') === '1';

const PERSONA =
	'You are the three.ws digital human: a friendly 3D avatar whose voice is NVIDIA Magpie TTS and whose face is animated live by NVIDIA Audio2Face-3D. ' +
	'You are talking out loud with a visitor, so answer in one to three short spoken sentences. No markdown, no lists, no emoji, no URLs. ' +
	'If asked how you work: the visitor speech is transcribed by NVIDIA Riva ASR, a language model writes your reply, each sentence is voiced by Magpie while the next is still being written, and Audio2Face turns that audio into ARKit blendshapes on this avatar in real time.';

const ATTRACT_LINES = [
	'Hi there! Hold the button and ask me anything.',
	'My face is animated live by NVIDIA Audio2Face, straight from my voice. Come say hello.',
	'Press and hold to talk. I will answer out loud, in real time.',
];
const KIOSK_ATTRACT_AFTER_MS = 30_000;
const KIOSK_ATTRACT_EVERY_MS = 45_000;
const KIOSK_RESET_AFTER_MS = 75_000;
const WARM_EVERY_MS = 4 * 60_000;
const MIC_PREROLL_S = 0.3;
const MIC_POSTROLL_MS = 140;
const MIC_IDLE_RELEASE_MS = 45_000;

// ── Kiosk key: from the URL once, then the device keeps it ─────────────────
const KEY_STORE = 'three.dh.kioskKey';
let kioskKey = null;
try {
	if (params.get('key')) {
		localStorage.setItem(KEY_STORE, params.get('key'));
		params.delete('key');
		history.replaceState(null, '', `${location.pathname}?${params}`);
	}
	kioskKey = localStorage.getItem(KEY_STORE);
} catch {
	kioskKey = null;
}
const client = createDigitalHumanClient({
	headers: KIOSK && kioskKey ? { 'x-kiosk-key': kioskKey } : {},
});
const health = new LaneHealth();

if (KIOSK) document.body.classList.add('kiosk');

// ── Elements ───────────────────────────────────────────────────────────────
const host = $('viewer-host');
const badgeEl = $('viewer-badge');
const loadingEl = $('viewer-loading');
const loadingText = $('loading-text');
const statusEl = $('status');
const errEl = $('dh-error');
const pttBtn = $('ptt');
const pttLabel = $('ptt-label');
const askForm = $('ask-form');
const askInput = $('ask');
const sayBtn = $('speak');
const stopBtn = $('stop');
const logEl = $('dh-log');
const captionEl = $('caption');
const hudEl = $('hud');
const hudBtn = $('hud-toggle');
const lanesEl = $('lanes');
const pathEl = $('pathline');

// ── Live blendshape meters ─────────────────────────────────────────────────
const METERS = [
	['jawOpen', 'JawOpen'],
	['mouthFunnel', 'MouthFunnel'],
	['mouthSmileLeft', 'MouthSmile'],
	['mouthPucker', 'MouthPucker'],
	['browInnerUp', 'BrowInnerUp'],
	['eyeBlinkLeft', 'EyeBlink'],
];
const meterBars = new Map();
for (const [k, label] of METERS) {
	const row = document.createElement('div');
	row.className = 'shape-row';
	const name = document.createElement('span');
	name.textContent = label;
	const meter = document.createElement('span');
	meter.className = 'meter';
	const bar = document.createElement('span');
	meter.appendChild(bar);
	row.append(name, meter);
	$('shapes').appendChild(row);
	meterBars.set(k, bar);
}
function paintMeters(getter) {
	for (const [k] of METERS) {
		const v = Math.max(0, Math.min(1, getter(k)));
		meterBars.get(k).style.width = `${(v * 100).toFixed(0)}%`;
	}
}

// ── Three.js viewer ────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(host.clientWidth, host.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, host.clientWidth / host.clientHeight, 0.01, 100);
const CAMERA_HOME = { pos: new THREE.Vector3(0, 1.58, 0.7), target: new THREE.Vector3(0, 1.57, 0) };
camera.position.copy(CAMERA_HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(CAMERA_HOME.target);
controls.enableDamping = true;
controls.minDistance = 0.35;
controls.maxDistance = 3.0;

scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.15));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);
const rim = new THREE.DirectionalLight(0x88ccff, 0.6);
rim.position.set(-3, 2, -2);
scene.add(rim);

function resize() {
	const w = host.clientWidth;
	const h = host.clientHeight;
	renderer.setSize(w, h);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const loader = new GLTFLoader();
const decodersReady = getDecoders().then(({ dracoLoader, ktx2Loader, meshoptDecoder }) => {
	loader
		.setDRACOLoader(dracoLoader)
		.setKTX2Loader(ktx2Loader.detectSupport(renderer))
		.setMeshoptDecoder(meshoptDecoder);
});
const a2f = new A2FPlayer();
const mouthTarget = new AvatarMouthTarget();
let currentModel = null;
let avatarReady = false;

async function loadAvatar(url) {
	avatarReady = false;
	loadingEl.hidden = false;
	loadingText.textContent = 'Loading avatar…';
	badgeEl.textContent = 'Detecting rig…';
	try {
		await decodersReady;
		const gltf = await loader.loadAsync(url);
		if (currentModel) {
			scene.remove(currentModel);
			disposeModel(currentModel);
		}
		currentModel = gltf.scene;
		const box = new THREE.Box3().setFromObject(currentModel);
		if (box.max.y - box.min.y > 0.1) currentModel.position.y = -box.min.y;
		scene.add(currentModel);
		a2f.attach(currentModel);
		mouthTarget.attach(currentModel);
		avatarReady = true;
		loadingEl.hidden = true;
		const cov = a2f.describe();
		const conv = cov.direct.length
			? 'ARKit / RPM'
			: cov.expression.length
				? 'VRM / viseme'
				: mouthTarget.hasMouthMorphs()
					? 'generic morphs'
					: mouthTarget.hasJawBone()
						? 'jaw bone'
						: 'head fallback';
		const drivers = cov.direct.length
			? `${cov.direct.length} ARKit morphs (direct)`
			: cov.expression.length
				? `${cov.expression.length} viseme morphs (derived)`
				: 'amplitude only';
		badgeEl.replaceChildren(
			Object.assign(document.createElement('b'), { textContent: conv }),
			` · ${drivers}`,
		);
	} catch (err) {
		loadingText.textContent = `Avatar load failed: ${err.message}. Pick another rig or reload.`;
	}
}

function disposeModel(root) {
	root.traverse((n) => {
		n.geometry?.dispose?.();
		if (n.material)
			(Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m.dispose?.());
	});
}

// ── Audio ──────────────────────────────────────────────────────────────────
let ctx = null;
let speech = null;
function audio() {
	if (!ctx) {
		const AC = window.AudioContext || window.webkitAudioContext;
		ctx = new AC({ latencyHint: 'interactive' });
		speech = new StreamSpeechPlayer({ ctx, a2f, mouth: mouthTarget, onState: onSpeechState });
	}
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});
	return speech;
}

function onSpeechState({ speaking, mouth }) {
	document.body.dataset.speaking = speaking ? '1' : '';
	setLane('face', mouthLane(mouth));
	if (!speaking && !turnRunning) settleIdle();
}

const MOUTH_LANES = {
	a2f: ['ok', 'Audio2Face-3D'],
	amplitude: ['fallback', 'amplitude lipsync'],
	visemes: ['fallback', 'text visemes'],
};
function mouthLane(mouth) {
	return MOUTH_LANES[mouth] || null;
}

// ── Lane state (the on-screen self-healing indicator) ──────────────────────
const LANE_NAMES = { ears: 'Ears', brain: 'Brain', voice: 'Voice', face: 'Face' };
const laneEls = {};
for (const [id, name] of Object.entries(LANE_NAMES)) {
	const el = document.createElement('li');
	el.className = 'lane';
	el.dataset.state = 'idle';
	const dot = document.createElement('span');
	dot.className = 'lane-dot';
	const label = document.createElement('b');
	label.textContent = name;
	const detail = document.createElement('span');
	detail.className = 'lane-detail';
	detail.textContent = 'ready';
	el.append(dot, label, detail);
	lanesEl.appendChild(el);
	laneEls[id] = { el, detail };
}
function setLane(id, value) {
	if (!value) return;
	const [state, detail] = value;
	const lane = laneEls[id];
	lane.el.dataset.state = state;
	lane.detail.textContent = detail;
	lane.el.title = `${LANE_NAMES[id]}: ${detail}`;
}
const VOICE_LANES = {
	stream: ['ok', 'Magpie, streaming'],
	clip: ['fallback', 'backup voice'],
	browser: ['fallback', 'browser voice'],
	text: ['down', 'captions only'],
	blocking: ['ok', 'Magpie'],
};

// ── Status and errors ──────────────────────────────────────────────────────
function setStatus(text, live = false) {
	statusEl.replaceChildren();
	if (live)
		statusEl.appendChild(
			Object.assign(document.createElement('span'), { className: 'live-dot' }),
		);
	statusEl.append(text);
}
function clearError() {
	errEl.hidden = true;
	errEl.replaceChildren();
}
function showError(title, detail, action) {
	const text = document.createElement('span');
	text.append(
		Object.assign(document.createElement('strong'), { textContent: title }),
		` ${detail}`,
	);
	errEl.replaceChildren(text);
	if (action) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'retry';
		btn.textContent = action.label;
		btn.addEventListener('click', action.run);
		errEl.appendChild(btn);
	}
	errEl.hidden = false;
}

// ── Conversation log and captions ──────────────────────────────────────────
const conversation = []; // [{ role, content }]
function addBubble(role, text) {
	logEl.querySelector('.log-empty')?.remove();
	const b = document.createElement('div');
	b.className = `bubble ${role}`;
	b.textContent = text;
	logEl.appendChild(b);
	logEl.scrollTop = logEl.scrollHeight;
	return b;
}
function resetConversation() {
	conversation.length = 0;
	logEl.replaceChildren(logEmpty());
	captionEl.textContent = '';
}
function logEmpty() {
	const wrap = document.createElement('div');
	wrap.className = 'log-empty';
	const p = document.createElement('p');
	p.textContent = 'Hold the talk button (or Space) and ask a question, or try one of these:';
	wrap.appendChild(p);
	for (const q of [
		'How do you move your face?',
		'What can three.ws agents do?',
		'Tell me a fun fact about the Moon.',
	]) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'suggest';
		b.textContent = q;
		b.addEventListener('click', () => converse({ text: q, t0: performance.now() }));
		wrap.appendChild(b);
	}
	return wrap;
}
resetConversation();

// ── Latency HUD ────────────────────────────────────────────────────────────
const sessionRuns = [];
let lastTurn = null;
let capability = null;
function setHud(on) {
	hudEl.hidden = !on;
	hudBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
	try {
		localStorage.setItem('three.dh.hud', on ? '1' : '0');
	} catch {}
	if (on) paintHud();
}
function paintHud(live = null) {
	if (hudEl.hidden) return;
	const timings = live || lastTurn?.timings || {};
	const summary = summarizeTimings(sessionRuns);
	const rows = STAGES.map((s) => {
		const tr = document.createElement('tr');
		const v = timings[s];
		const p = summary[s];
		tr.append(
			cell('th', STAGE_LABELS[s]),
			cell('td', Number.isFinite(v) ? `${v}` : '·', Number.isFinite(v) ? '' : 'na'),
			cell('td', p.p50 ?? '·', p.p50 == null ? 'na' : ''),
			cell('td', p.p95 ?? '·', p.p95 == null ? 'na' : ''),
		);
		return tr;
	});
	const head = document.createElement('tr');
	head.append(
		cell('th', 'ms from speech end'),
		cell('th', 'last'),
		cell('th', 'p50'),
		cell('th', 'p95'),
	);
	const table = document.createElement('table');
	table.append(head, ...rows);
	const foot = document.createElement('div');
	foot.className = 'hud-foot';
	const lanes = lastTurn?.lanes?.length ? [...new Set(lastTurn.lanes)].join(' → ') : 'none yet';
	const fn = capability?.functionId ? capability.functionId.slice(0, 8) : '·';
	const healing = capability?.healing?.healedId
		? ` (healed from ${String(capability.healing.from).slice(0, 8)})`
		: '';
	foot.textContent = `turns ${sessionRuns.length} · lanes ${lanes} · mouth ${speech?.mouthSource || 'rest'} · A2F fn ${fn}${healing}`;
	hudEl.replaceChildren(table, foot);
}
function cell(tag, text, cls = '') {
	const c = document.createElement(tag);
	c.textContent = String(text);
	if (cls) c.className = cls;
	return c;
}
hudBtn.addEventListener('click', () => setHud(hudEl.hidden));
let hudPref = params.get('hud') === '1';
try {
	hudPref = hudPref || (!KIOSK && localStorage.getItem('three.dh.hud') === '1');
} catch {}
setHud(hudPref);

// ── Microphone: always-on ring buffer while armed, so no first syllable is lost
let mic = null;
let micDown = null;
let micRate = 16000;
let ring = []; // 16 kHz Int16 chunks (pre-roll)
let ringLen = 0;
let held = null; // chunks captured during the press
let micIdleTimer = 0;

async function armMic() {
	if (mic) return;
	const capture = new MicCapture({
		retain: false,
		onFrame: (f) => {
			const pcm = micDown.push(f);
			if (!pcm.length) return;
			if (held) held.push(pcm);
			ring.push(pcm);
			ringLen += pcm.length;
			while (ring.length > 1 && ringLen - ring[0].length > MIC_PREROLL_S * 16000)
				ringLen -= ring.shift().length;
		},
	});
	await capture.start();
	micRate = capture._sourceRate || 48000;
	micDown = new PcmDownsampler(micRate);
	mic = capture;
}
function scheduleMicRelease() {
	if (KIOSK) return;
	clearTimeout(micIdleTimer);
	micIdleTimer = setTimeout(() => {
		if (held) return;
		mic?.dispose();
		mic = null;
		ring = [];
		ringLen = 0;
	}, MIC_IDLE_RELEASE_MS);
}

// Browser SpeechRecognition: the ears' fallback when Riva ASR is down.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
function startRecognizer() {
	if (!SR) return null;
	const r = new SR();
	r.lang = 'en-US';
	r.interimResults = false;
	r.maxAlternatives = 1;
	const result = new Promise((resolve) => {
		let text = '';
		r.onresult = (e) => {
			text = Array.from(e.results)
				.map((x) => x[0]?.transcript || '')
				.join(' ')
				.trim();
		};
		r.onerror = () => resolve(text);
		r.onend = () => resolve(text);
	});
	try {
		r.start();
	} catch {
		return null;
	}
	return { stop: () => r.stop(), result };
}

async function pttDown() {
	if (pressing) return;
	pressing = true;
	markActive();
	stopSpeaking('barge-in');
	audio();
	pttBtn.classList.add('held');
	pttBtn.setAttribute('aria-pressed', 'true');
	pttLabel.textContent = 'Listening… release to send';
	clearError();
	if (!health.allow('asr') && SR) {
		recognizer = startRecognizer();
		setLane('ears', ['fallback', 'browser speech recognition']);
		return;
	}
	try {
		await armMic();
		held = [...ring];
	} catch (err) {
		pressing = false;
		resetPtt();
		setLane('ears', [
			'down',
			err.code === 'permission-denied' ? 'mic blocked' : 'no microphone',
		]);
		showError('Microphone unavailable.', `${err.message}`, {
			label: 'Type instead',
			run: () => askInput.focus(),
		});
	}
}

async function pttUp() {
	if (!pressing) return;
	pressing = false;
	const t0 = performance.now();
	resetPtt();
	if (recognizer) {
		const r = recognizer;
		recognizer = null;
		r.stop();
		const text = await r.result;
		if (text) converse({ text, t0, viaFallbackEars: true });
		else setStatus('I did not catch that. Hold the button a little longer while you speak.');
		return;
	}
	if (!held) return;
	await new Promise((r) => setTimeout(r, MIC_POSTROLL_MS));
	const chunks = held;
	held = null;
	scheduleMicRelease();
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const pcm = new Int16Array(total);
	let off = 0;
	for (const c of chunks) {
		pcm.set(c, off);
		off += c.length;
	}
	const gate = gateUtterance(pcm, 16000);
	if (!gate.ok) {
		setStatus(
			gate.reason === 'no_speech'
				? 'I could not hear any speech. Hold the button and speak close to the mic.'
				: 'That was very short. Hold the button for the whole question.',
		);
		return;
	}
	converse({ audio: encodeWav(gate.samples, 16000), t0 });
}
let pressing = false;
function resetPtt() {
	pttBtn.classList.remove('held');
	pttBtn.setAttribute('aria-pressed', 'false');
	pttLabel.textContent = KIOSK ? 'Hold to talk' : 'Hold to talk (Space)';
}

pttBtn.addEventListener('pointerdown', (e) => {
	e.preventDefault();
	pttBtn.setPointerCapture?.(e.pointerId);
	pttDown();
});
pttBtn.addEventListener('pointerup', pttUp);
pttBtn.addEventListener('pointercancel', pttUp);
pttBtn.addEventListener('keydown', (e) => {
	if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
		e.preventDefault();
		pttDown();
	}
});
pttBtn.addEventListener('keyup', (e) => {
	if (e.key === 'Enter' || e.key === ' ') pttUp();
});
const typing = (el) =>
	el &&
	(el.tagName === 'INPUT' ||
		el.tagName === 'TEXTAREA' ||
		el.tagName === 'SELECT' ||
		el.isContentEditable);
window.addEventListener('keydown', (e) => {
	if (typing(document.activeElement) || e.target === pttBtn) return;
	if (e.code === 'Space' && !e.repeat) {
		e.preventDefault();
		pttDown();
	} else if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey) {
		setHud(hudEl.hidden);
	} else if (e.key === 'Escape') {
		stopSpeaking('stopped');
	}
});
window.addEventListener('keyup', (e) => {
	if (e.code === 'Space' && !typing(document.activeElement) && e.target !== pttBtn) pttUp();
});

// ── Turns ──────────────────────────────────────────────────────────────────
let turnRunning = false;
let turnAbort = null;
let captionBuf = '';

function stopSpeaking(reason) {
	turnAbort?.abort();
	turnAbort = null;
	if (browserVoiceSupported()) window.speechSynthesis.cancel();
	speech?.reset();
	if (reason === 'stopped') setStatus('Stopped.');
}

function settleIdle() {
	stopBtn.disabled = true;
	sayBtn.disabled = false;
	if (!statusEl.dataset.keep)
		setStatus(
			KIOSK
				? 'Hold the button and ask me anything.'
				: 'Ready. Hold to talk, or type a question.',
		);
	markActive();
}

function makeSink(bubble) {
	const player = audio();
	return {
		transcript: (text) => {
			if (bubble.user) bubble.user.textContent = text;
			else addBubble('user', text);
			setStatus('Thinking…', true);
		},
		token: (tok) => {
			captionBuf += tok;
			bubble.avatar.textContent = captionBuf;
			captionEl.textContent = captionBuf.slice(-220);
		},
		replace: (text) => {
			captionBuf = text;
			bubble.avatar.textContent = text;
			captionEl.textContent = text;
		},
		segment: () => setStatus('Speaking…', true),
		line: (i, type, data) => {
			if (type === 'degraded') {
				setLane('face', [
					'fallback',
					data.code === 'skipped'
						? 'amplitude lipsync'
						: `amplitude lipsync (A2F ${data.code})`,
				]);
			}
			player.line(i, type, data);
		},
		playClip: (i, wav) => player.playClip(i, wav),
		speakBrowser: browserVoiceSupported()
			? (i, text) =>
					player.external(() =>
						speakWithVisemes(text, { target: mouthTarget, signal: turnAbort?.signal }),
					)
			: undefined,
		caption: (i, text) => {
			captionEl.textContent = text;
		},
		lane: (i, lane, code) => {
			if (VOICE_LANES[lane]) setLane('voice', VOICE_LANES[lane]);
			else if (lane.endsWith(':failed'))
				setLane('voice', [
					'fallback',
					`${lane.split(':')[0]} lane failed (${code}), switching`,
				]);
			if (lane === 'clip' || lane === 'text')
				setLane(
					'face',
					lane === 'text' ? ['down', 'no audio to animate'] : MOUTH_LANES.amplitude,
				);
		},
	};
}

async function converse({
	audio: wav = null,
	text = null,
	say = null,
	t0 = performance.now(),
	viaFallbackEars = false,
}) {
	if (!avatarReady) {
		setStatus('The avatar is still loading. One moment.');
		return;
	}
	stopSpeaking('new-turn');
	clearError();
	markActive();
	turnRunning = true;
	turnAbort = new AbortController();
	const signal = turnAbort.signal;
	stopBtn.disabled = false;
	sayBtn.disabled = true;
	captionBuf = '';
	captionEl.textContent = '';
	const bubble = {
		user: say ? null : addBubble('user', text || '…'),
		avatar: null,
	};
	bubble.avatar = addBubble('avatar', '');
	bubble.avatar.classList.add('pending');
	setStatus(wav ? 'Transcribing…' : say ? 'Voicing…' : 'Thinking…', true);
	if (!say) setLane('brain', ['ok', 'thinking']);

	const sink = makeSink(bubble);
	let result;
	const liveTimer = setInterval(() => paintHud({ ...(result?.timings || {}) }), 250);
	try {
		result = await runTurn({
			client,
			audio: wav,
			text,
			say,
			history: conversation.slice(-12),
			systemPrompt: PERSONA,
			voice: $('voice').value,
			health,
			sink,
			signal,
			t0,
		});
	} catch (err) {
		clearInterval(liveTimer);
		turnRunning = false;
		bubble.avatar.classList.remove('pending');
		if (err.name === 'AbortError' || signal.aborted) {
			if (!bubble.avatar.textContent) bubble.avatar.remove();
			return;
		}
		showError('Something went wrong.', err.message || 'Try again.', {
			label: 'Retry',
			run: () => converse({ audio: wav, text, say }),
		});
		settleIdle();
		return;
	}
	clearInterval(liveTimer);
	turnRunning = false;
	bubble.avatar.classList.remove('pending');

	if (result.failedStage === 'asr' || result.failedStage === 'asr_empty') {
		bubble.avatar.remove();
		bubble.user?.remove();
		if (result.failedStage === 'asr') {
			health.fail('asr', result.errors[0]?.code);
			setLane(
				'ears',
				SR
					? ['fallback', 'Riva down, using browser recognition']
					: ['down', 'Riva unavailable, type instead'],
			);
			showError(
				'Speech recognition is unavailable.',
				SR
					? 'Hold the button again: your browser will transcribe instead.'
					: 'Type your question below instead.',
				{ label: 'Type instead', run: () => askInput.focus() },
			);
		} else {
			setStatus('I did not catch any words. Try again a little closer to the mic.');
		}
		settleIdle();
		return;
	}
	if (wav) {
		health.ok('asr');
		setLane('ears', ['ok', 'Riva ASR']);
	} else if (viaFallbackEars) {
		setLane('ears', ['fallback', 'browser speech recognition']);
	}
	setLane(
		'brain',
		result.degraded === 'llm'
			? ['down', 'LLM unavailable']
			: say
				? ['ok', 'idle']
				: ['ok', 'replied'],
	);
	if (!bubble.avatar.textContent) bubble.avatar.textContent = result.reply || '';
	if (!say && result.transcript && result.reply && result.degraded !== 'llm') {
		conversation.push(
			{ role: 'user', content: result.transcript },
			{ role: 'assistant', content: result.reply },
		);
	}
	await speech.whenIdle();
	result.timings.total = Math.round(performance.now() - t0);
	if (!signal.aborted) {
		lastTurn = result;
		if (!say) sessionRuns.push(result.timings);
		paintHud();
		describePath(result);
		console.info(
			'[digital-human] turn',
			JSON.stringify({
				timings: result.timings,
				lanes: result.lanes,
				degraded: result.degraded,
			}),
		);
	}
	settleIdle();
}

function describePath(r) {
	const lanes = [...new Set(r.lanes)];
	const first = r.timings.ttsFirstAudio;
	pathEl.className = `pathline ${r.degraded ? 'fallback' : 'a2f'}`;
	const b = document.createElement('b');
	b.textContent = r.degraded ? `Fallback: ${r.degraded}` : 'Pipelined Magpie + Audio2Face-3D';
	pathEl.replaceChildren(
		b,
		` · first sound ${Number.isFinite(first) ? `${first} ms` : 'n/a'} after you stopped talking · lanes ${lanes.join(', ') || 'none'}`,
	);
}

askForm.addEventListener('submit', (e) => {
	e.preventDefault();
	const q = askInput.value.trim();
	if (!q) {
		askInput.focus();
		return;
	}
	askInput.value = '';
	converse({ text: q, t0: performance.now() });
});
sayBtn.addEventListener('click', () => {
	const line = $('text').value.trim();
	if (!line) {
		setStatus('Enter a line for the avatar to say.');
		return;
	}
	converse({ say: line, t0: performance.now() });
});
stopBtn.addEventListener('click', () => stopSpeaking('stopped'));
$('avatar').addEventListener('change', () => {
	stopSpeaking('stopped');
	loadAvatar($('avatar').value);
});

// ── Warm path: preconnect both NVIDIA channels before the first question ──
async function warm() {
	try {
		const w = await client.warm();
		capability = {
			...(capability || {}),
			functionId: w.a2f?.functionId || capability?.functionId,
			healing: w.healing || capability?.healing,
		};
		setLane(
			'voice',
			w.tts?.ok ? ['ok', 'Magpie, warm'] : ['fallback', 'Magpie cold, backup ready'],
		);
		if (!w.a2f?.ok) setLane('face', ['fallback', 'A2F unavailable, amplitude ready']);
		else
			setLane('face', [
				'ok',
				w.a2f.healedFrom ? 'Audio2Face-3D (self-healed)' : 'Audio2Face-3D',
			]);
		paintHud();
	} catch (err) {
		if (err.status === 429) return; // metered; the next real turn opens the channels anyway
		setLane('voice', ['fallback', 'warm-up failed, will retry']);
	}
}
client
	.capabilities()
	.then((cap) => {
		capability = cap;
		if (cap.configured === false) {
			setLane('face', ['fallback', 'not configured here, amplitude lipsync']);
			setLane('voice', ['fallback', 'backup voice']);
		}
		paintHud();
	})
	.catch(() => {});

// ── Kiosk: attract loop, idle reset, warm ping ─────────────────────────────
let lastActive = performance.now();
let lastAttract = 0;
let attractIndex = 0;
let attracting = false;
const attractCache = new Map(); // line -> recorded stream events (replayed offline)
function markActive() {
	lastActive = performance.now();
}

async function attract() {
	const line = ATTRACT_LINES[attractIndex++ % ATTRACT_LINES.length];
	attracting = true;
	lastAttract = performance.now();
	const player = audio();
	captionEl.textContent = line;
	try {
		const cached = attractCache.get(line);
		if (cached) {
			player.reset();
			for (const [type, data] of cached) player.line(0, type, data);
		} else {
			const events = [];
			await client.speakLine({
				text: line,
				voice: $('voice').value,
				onEvent: (type, data) => {
					events.push([type, data]);
					player.line(0, type, data);
				},
			});
			attractCache.set(line, events);
		}
		await player.whenIdle();
	} catch (err) {
		console.info('[kiosk] attract line skipped:', err.code || err.message);
	} finally {
		attracting = false;
		if (!turnRunning) captionEl.textContent = '';
	}
}

function kioskTick() {
	const idle = performance.now() - lastActive;
	if (turnRunning || pressing || speech?.speaking) return;
	if (idle > KIOSK_RESET_AFTER_MS && (conversation.length || logEl.querySelector('.bubble'))) {
		resetConversation();
		controls.target.copy(CAMERA_HOME.target);
		camera.position.copy(CAMERA_HOME.pos);
		clearError();
		console.info('[kiosk] auto-reset after idle');
	}
	if (
		!attracting &&
		idle > KIOSK_ATTRACT_AFTER_MS &&
		performance.now() - lastAttract > KIOSK_ATTRACT_EVERY_MS
	)
		attract();
}

function startKiosk() {
	const gate = $('kiosk-start');
	gate.hidden = false;
	const go = async () => {
		gate.hidden = true;
		audio();
		document.documentElement.requestFullscreen?.().catch(() => {});
		try {
			await armMic();
		} catch (err) {
			setLane('ears', ['down', 'no microphone']);
		}
		warm();
		setInterval(warm, WARM_EVERY_MS);
		setInterval(kioskTick, 1000);
		markActive();
		lastAttract = 0;
		resize();
	};
	gate.addEventListener('click', go, { once: true });
	gate.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && go(), {
		once: true,
	});
	gate.focus();
}

// ── Render loop ────────────────────────────────────────────────────────────
function tick() {
	requestAnimationFrame(tick);
	controls.update();
	if (speech?.mouthSource === 'a2f') paintMeters((k) => a2f.currentWeight(k));
	else if (speech) paintMeters((k) => (k === 'jawOpen' ? speech.shape.open || 0 : 0));
	renderer.render(scene, camera);
}
tick();

resetPtt();
loadAvatar($('avatar').value).then(resize);
if (KIOSK) startKiosk();
else {
	// Preconnect on the first sign of intent, not on page load: a visitor who
	// only reads the page should not spend NVIDIA calls.
	const intent = () => {
		warm();
		setInterval(() => document.visibilityState === 'visible' && warm(), WARM_EVERY_MS);
	};
	let warmed = false;
	for (const ev of ['pointerdown', 'keydown', 'focusin']) {
		window.addEventListener(
			ev,
			() => {
				if (warmed) return;
				warmed = true;
				intent();
			},
			{ once: true, capture: true },
		);
	}
	settleIdle();
}

// The booth clip recorder and the kiosk soak drive the page through this.
window.__digitalHuman = {
	converse,
	say: (line) => converse({ say: line, t0: performance.now() }),
	state: () => ({
		avatarReady,
		turnRunning,
		speaking: !!speech?.speaking,
		mouth: speech?.mouthSource || 'rest',
		lanes: Object.fromEntries(
			Object.entries(laneEls).map(([k, v]) => [
				k,
				{ state: v.el.dataset.state, detail: v.detail.textContent },
			]),
		),
		lastTurn,
		sessionRuns: sessionRuns.length,
		health: health.snapshot(),
	}),
};

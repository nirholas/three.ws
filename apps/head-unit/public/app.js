// The head unit page: the projected phone screen on the driver's side, the
// three.ws agent beside it. Everything here reacts to the service's real
// state over /ws; nothing is shown that the service did not report.

import { decodeFrame } from './wire.js';
import { inspectAccessUnit } from './h264.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const panels = [...document.querySelectorAll('[data-panel]')];
const canvas = /** @type {HTMLCanvasElement} */ ($('screen'));
const ctx2d = canvas.getContext('2d');

const view = {
	service: 'booting', // booting | up | down
	session: null, // last state snapshot from the service
	config: null,
	video: 'idle', // idle | waiting | playing | unsupported
	unsupportedReason: '',
};

/* ---------- rendering ---------- */

function showPanel(id) {
	for (const p of panels) p.hidden = p.id !== id;
	canvas.hidden = id !== null;
}

function setStatus(text, tone) {
	$('status-text').textContent = text;
	$('status').dataset.tone = tone;
}

const PHONE_LABEL = { carplay: 'CarPlay', androidauto: 'Android Auto', androidmirror: 'Android mirror', iphonemirror: 'iPhone mirror', hicar: 'HiCar' };

function render() {
	const s = view.session;
	$('home').disabled = !(s?.state === 'connected' && s.phone);
	if (view.service === 'booting') {
		setStatus('Starting', 'wait');
		return showPanel('panel-booting');
	}
	if (view.service === 'down') {
		setStatus('Service offline', 'bad');
		return showPanel('panel-service-down');
	}
	if (view.video === 'unsupported') {
		$('unsupported-text').textContent = view.unsupportedReason;
		setStatus('Cannot decode video', 'bad');
		return showPanel('panel-unsupported');
	}
	switch (s?.state) {
		case 'probing':
			setStatus('Opening dongle', 'wait');
			return showPanel('panel-probing');
		case 'error':
			$('error-text').textContent = s.error || 'The dongle reported an error.';
			setStatus('Dongle error', 'bad');
			return showPanel('panel-error');
		case 'connected':
			if (!s.phone) {
				setStatus('Waiting for phone', 'warn');
				return showPanel('panel-no-phone');
			}
			setStatus(`${PHONE_LABEL[s.phone.type] || 'Phone connected'}${s.phone.wireless ? ' (Wi-Fi)' : ''}`, 'ok');
			if (view.video !== 'playing') {
				$('awaiting-video-note').textContent = `${PHONE_LABEL[s.phone.type] || 'Phone'} connected${s.phone.wireless ? ' over Wi-Fi' : ''}. Waiting for its first picture.`;
				return showPanel('panel-awaiting-video');
			}
			return showPanel(null);
		default:
			setStatus('No dongle', 'warn');
			$('usb-ids').replaceChildren(
				...(s?.usbIds || []).flatMap((id, i) => {
					const code = document.createElement('code');
					code.textContent = id;
					return i ? [document.createTextNode(' '), code] : [code];
				}),
			);
			return showPanel('panel-disconnected');
	}
}

/* ---------- countdowns for the next real retry ---------- */

let countdownTimer = null;
let serviceRetryAt = null;

function tickCountdowns() {
	const now = Date.now();
	const s = view.session;
	const secs = (at) => Math.max(0, Math.ceil((at - now) / 1000));
	if (s?.nextAt) {
		const text = secs(s.nextAt) ? `Checking again in ${secs(s.nextAt)} s.` : 'Checking now.';
		$('probe-note').textContent = text;
		$('error-note').textContent = `Attempt ${s.attempts}. ${s.nextAt ? (secs(s.nextAt) ? `Retrying in ${secs(s.nextAt)} s.` : 'Retrying now.') : ''}`;
	} else {
		$('probe-note').textContent = '';
		$('error-note').textContent = '';
	}
	$('service-retry-note').textContent = serviceRetryAt ? `Reconnecting in ${secs(serviceRetryAt)} s.` : 'Reconnecting.';
}

function ensureCountdown() {
	if (!countdownTimer) countdownTimer = setInterval(tickCountdowns, 500);
	tickCountdowns();
}

/* ---------- the service socket ---------- */

let socket = null;
let reconnectDelay = 1000;
let reconnectTimer = null;

function connect() {
	clearTimeout(reconnectTimer);
	reconnectTimer = null;
	serviceRetryAt = null;
	const url = new URL('/ws', location.href);
	url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	const ws = new WebSocket(url);
	ws.binaryType = 'arraybuffer';
	socket = ws;
	ws.addEventListener('open', () => {
		reconnectDelay = 1000;
	});
	ws.addEventListener('message', (event) => {
		if (typeof event.data === 'string') onControl(JSON.parse(event.data));
		else onMedia(event.data);
	});
	ws.addEventListener('close', () => {
		if (socket !== ws) return;
		socket = null;
		view.service = 'down';
		resetVideo();
		serviceRetryAt = Date.now() + reconnectDelay;
		reconnectTimer = setTimeout(connect, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 10000);
		render();
		ensureCountdown();
	});
}

function send(msg) {
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function onControl(msg) {
	if (msg.type === 'hello') {
		view.service = 'up';
		applyConfig(msg.config);
		view.session = msg;
	} else if (msg.type === 'state') {
		if (msg.state !== 'connected') resetVideo();
		view.session = msg;
	} else if (msg.type === 'phone') {
		if (view.session) view.session = { ...view.session, phone: msg.phone };
		if (!msg.phone) resetVideo();
	} else if (msg.type === 'audio') {
		audio.control(msg);
		return;
	}
	render();
	ensureCountdown();
}

function onMedia(buffer) {
	const frame = decodeFrame(buffer);
	if (frame?.kind === 'video') video.push(frame);
	else if (frame?.kind === 'audio') audio.play(frame);
}

/* ---------- config and the agent pane ---------- */

const HAND_KEY = 'three-ws-head-unit:hand';

function storedHand() {
	try {
		return localStorage.getItem(HAND_KEY);
	} catch {
		return null;
	}
}

function applyHand(hand, persist) {
	root.dataset.hand = hand;
	$('swap').setAttribute('aria-pressed', String(hand !== (view.config?.hand || 'lhd')));
	if (persist) {
		try {
			localStorage.setItem(HAND_KEY, hand);
		} catch {
			// Storage can be unavailable in a locked-down kiosk; the swap still applies.
		}
	}
}

function applyConfig(config) {
	const firstTime = !view.config;
	view.config = config;
	root.style.setProperty('--projection-ratio', `${config.projection.width} / ${config.projection.height}`);
	canvas.width = config.projection.width;
	canvas.height = config.projection.height;
	$('box-name').textContent = config.boxName;
	applyHand(storedHand() || config.hand, false);
	if (firstTime) loadAgent();
}

function loadAgent() {
	const frame = /** @type {HTMLIFrameElement} */ ($('agent'));
	$('panel-offline').hidden = true;
	if (!navigator.onLine) {
		$('agent-skeleton').hidden = true;
		$('panel-offline').hidden = false;
		return;
	}
	$('agent-skeleton').hidden = false;
	frame.classList.remove('is-ready');
	frame.addEventListener(
		'load',
		() => {
			$('agent-skeleton').hidden = true;
			frame.classList.add('is-ready');
		},
		{ once: true },
	);
	frame.src = view.config.driveUrl;
}

window.addEventListener('offline', () => {
	$('agent-skeleton').hidden = true;
	$('panel-offline').hidden = false;
});
window.addEventListener('online', () => {
	if (!$('panel-offline').hidden && view.config) loadAgent();
});

/* ---------- video: Annex B H.264 through WebCodecs ---------- */

function resetVideo() {
	video.reset();
	if (view.video === 'playing' || view.video === 'waiting') view.video = 'idle';
}

const video = (() => {
	let decoder = null;
	let codec = null;
	let supported = null;

	async function configure(nextCodec, width, height) {
		if (!('VideoDecoder' in window)) {
			fail('This browser has no WebCodecs VideoDecoder.');
			return false;
		}
		const config = { codec: nextCodec, codedWidth: width, codedHeight: height, optimizeForLatency: true };
		const check = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
		if (!check.supported) {
			fail(`It cannot decode ${nextCodec} at ${width}x${height}.`);
			return false;
		}
		decoder?.state !== 'closed' && decoder?.close();
		decoder = new VideoDecoder({
			output(frame) {
				if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
					canvas.width = frame.displayWidth;
					canvas.height = frame.displayHeight;
				}
				ctx2d.drawImage(frame, 0, 0);
				frame.close();
				if (view.video !== 'playing') {
					view.video = 'playing';
					render();
				}
			},
			error() {
				// A corrupt frame: drop the decoder and resume from the next keyframe.
				reset();
				send({ type: 'key', name: 'frame' });
			},
		});
		decoder.configure(config);
		codec = nextCodec;
		supported = true;
		return true;
	}

	function fail(reason) {
		supported = false;
		view.video = 'unsupported';
		view.unsupportedReason = reason;
		render();
	}

	function reset() {
		if (decoder && decoder.state !== 'closed') decoder.close();
		decoder = null;
		codec = null;
	}

	let configuring = null;

	async function push({ width, height, data }) {
		if (supported === false || !data.byteLength) return;
		const { key, codec: found } = inspectAccessUnit(data);
		if (!decoder || decoder.state === 'closed') {
			if (!key || !found) {
				if (view.video === 'idle') view.video = 'waiting';
				return;
			}
			configuring ??= configure(found, width, height).finally(() => (configuring = null));
			if (!(await configuring)) return;
		} else if (found && found !== codec) {
			reset();
			return push({ width, height, data });
		}
		if (decoder.decodeQueueSize > 8 && !key) return;
		decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: performance.now() * 1000, data }));
	}

	return { push, reset };
})();

/* ---------- audio: s16le PCM through Web Audio ---------- */

const audio = (() => {
	let context = null;
	const streams = new Map();

	function ensure() {
		if (!context) context = new AudioContext({ latencyHint: 'interactive' });
		return context;
	}

	function stream(audioType) {
		const ac = ensure();
		let s = streams.get(audioType);
		if (!s) {
			const gain = ac.createGain();
			gain.connect(ac.destination);
			s = { gain, next: 0 };
			streams.set(audioType, s);
		}
		return s;
	}

	function play({ audioType, channels, sampleRate, samples }) {
		const ac = ensure();
		if (ac.state === 'suspended') return;
		const frames = Math.floor(samples.length / channels);
		if (!frames) return;
		const buffer = ac.createBuffer(channels, frames, sampleRate);
		for (let c = 0; c < channels; c += 1) {
			const out = buffer.getChannelData(c);
			for (let i = 0; i < frames; i += 1) out[i] = samples[i * channels + c] / 32768;
		}
		const s = stream(audioType);
		const node = ac.createBufferSource();
		node.buffer = buffer;
		node.connect(s.gain);
		// Keep a small cushion; if we fell behind, restart just ahead of now.
		const start = Math.max(s.next, ac.currentTime + 0.04);
		node.start(start);
		s.next = start + buffer.duration;
	}

	function control(msg) {
		if (msg.kind === 'volume' && context) {
			const { gain } = stream(msg.audioType);
			gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, msg.volume)), context.currentTime + Math.max(0, msg.duration || 0));
		}
	}

	// Browsers start audio suspended until a gesture; the kiosk launcher lifts
	// that, and any tap here lifts it too.
	const unlock = () => ensure().resume();
	window.addEventListener('pointerdown', unlock, { passive: true });
	window.addEventListener('keydown', unlock);

	return { play, control };
})();

/* ---------- touch on the projected screen ---------- */

let pressing = false;

function touch(event, action) {
	const rect = canvas.getBoundingClientRect();
	const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
	const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
	send({ type: 'touch', x, y, action });
}

canvas.addEventListener('pointerdown', (e) => {
	pressing = true;
	canvas.setPointerCapture(e.pointerId);
	touch(e, 'down');
});
canvas.addEventListener('pointermove', (e) => pressing && touch(e, 'move'));
for (const type of ['pointerup', 'pointercancel']) {
	canvas.addEventListener(type, (e) => {
		if (!pressing) return;
		pressing = false;
		touch(e, 'up');
	});
}

/* ---------- controls ---------- */

$('home').addEventListener('click', () => send({ type: 'key', name: 'home' }));
$('swap').addEventListener('click', () => applyHand(root.dataset.hand === 'rhd' ? 'lhd' : 'rhd', true));

document.addEventListener('click', async (event) => {
	const button = event.target.closest('[data-action]');
	if (!button) return;
	const action = button.dataset.action;
	if (action === 'reconnect') return connect();
	if (action === 'reload-agent') return loadAgent();
	if (action === 'retry') {
		button.disabled = true;
		try {
			const res = await fetch('/api/retry', { method: 'POST' });
			if (res.ok) view.session = await res.json();
		} catch {
			// The socket's close handler owns the service-down state.
		} finally {
			button.disabled = false;
			render();
			ensureCountdown();
		}
	}
});

$('service-origin').textContent = location.origin;
render();
connect();

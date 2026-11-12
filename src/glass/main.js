// /glass: the three.ws web app for Meta Ray-Ban Display. No three.js here: the
// lens browser gets a text HUD (nearby arrow, agent card, talk, phone handoff).
// Live 3D stays on the phone at /irl, reached through the handoff code.

import { bindDpad } from './dpad.js';
import { createCompass, relativeBearing } from './compass.js';
import { createPresence, getPosition, pollInterval, PresenceError } from './presence.js';
import { createArrival } from './arrival.js';
import { detectCapabilities, listenOnce, speak } from './caps.js';
import { scanningView, startView, deniedView, offlineView, errorView, nearbyView, cardView, talkView, handoffView } from './views/views.js';

const root = document.getElementById('glass');
const presence = createPresence();
const compass = createCompass({ onHeading: () => { if (screen === 'nearby') renderNearby(); } });
const arrival = createArrival();
const caps = detectCapabilities(window);

let screen = 'start';
let pos = null;
let fixedAt = null;
let portraitUrl = null;
let lastCard = null;
let pins = [];
let current = null;
let timer = null;
let talk = null;
let viewed = new Set();
let talked = new Set();

const dpad = bindDpad(root, {
	getItems: () => Array.from(root.querySelectorAll('[data-glass-item]')).filter((n) => !n.disabled),
	onSelect: (node) => { if (node) node.click(); },
	onBack: () => back(),
});

function show(node) {
	root.replaceChildren(node);
	dpad.refocus();
	if (!root.querySelector('[data-glass-item]')) root.focus();
}

function status() {
	return { heading: compass.heading, fixedAt, count: pins.length };
}

function logInteraction(pin, type, extra = {}) {
	const body = { pinId: pin.id, type, device_type: 'glasses', ...extra };
	fetch('/api/irl/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}

function failure(err, retry) {
	if (err instanceof PresenceError && ['denied', 'unavailable', 'timeout'].includes(err.code)) return show(deniedView(err.code, retry));
	if (err instanceof PresenceError && err.code === 'offline') return show(offlineView(retry));
	if (err instanceof PresenceError && err.code === 'rate_limited') return show(errorView('Too many requests. Wait a moment.', retry));
	return show(errorView('Please try again.', retry));
}

function relFor(pin) {
	if (compass.heading == null) return null;
	return relativeBearing(compass.heading, pin.bearing);
}

function renderNearby() {
	show(nearbyView(pins, relFor, openCard, status()));
}

async function refresh() {
	clearTimeout(timer);
	try {
		pos = await getPosition();
		pins = await presence.nearby(pos);
		fixedAt = Date.now();
		for (const pin of arrival.update(pins)) {
			logInteraction(pin, 'arrive');
			if (screen === 'nearby' || screen === 'scanning') { screen = 'card'; return openCard(pin); }
		}
		if (screen === 'nearby' || screen === 'scanning') { screen = 'nearby'; renderNearby(); }
		timer = setTimeout(refresh, pollInterval({ speedMps: pos.speed, hidden: document.hidden, empty: !pins.length }));
	} catch (err) {
		screen = 'error';
		failure(err, begin);
	}
}

function begin() {
	screen = 'scanning';
	show(scanningView(status()));
	compass.start();
	refresh();
}

async function loadPortrait(pin) {
	if (!pin.avatar_url) return null;
	try {
		const glbUrl = new URL(pin.avatar_url, location.origin).href;
		const res = await fetch('/api/render/avatar-clip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ glbUrl, width: 160, height: 160, background: 'transparent' }) });
		if (!res.ok) return null;
		return URL.createObjectURL(await res.blob());
	} catch {
		return null;
	}
}

async function openCard(pin) {
	current = pin;
	screen = 'card';
	clearTimeout(timer);
	if (portraitUrl) { URL.revokeObjectURL(portraitUrl); portraitUrl = null; }
	if (!viewed.has(pin.id)) { viewed.add(pin.id); logInteraction(pin, 'view'); }
	show(cardView(pin, null, handlers));
	lastCard = null;
	const portrait = loadPortrait(pin);
	try {
		const res = await fetch(`/api/irl/agent-card?pin=${encodeURIComponent(pin.id)}`);
		const card = res.ok ? (await res.json()).card : null;
		lastCard = card;
		if (screen === 'card' && current === pin) show(cardView(pin, card, handlers));
	} catch {
		/* the card renders from the pin alone */
	}
	const src = await portrait;
	if (src && screen === 'card' && current === pin) { portraitUrl = src; show(cardView(pin, lastCard, handlers, src)); }
}

async function sendTalk(text) {
	talk.busy = true; talk.reply = ''; talk.suggestions = []; talk.error = ''; talk.voiceError = '';
	show(talkView(talk, handlers));
	if (!talked.has(current.id)) { talked.add(current.id); logInteraction(current, 'talk'); }
	try {
		const body = { message: text, suggestReplies: 3 };
		if (current.agent_id) body.agentId = current.agent_id;
		const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
		if (!res.ok || !res.body) throw new Error('chat');
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		let buf = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
			let i;
			while ((i = buf.indexOf('\n\n')) >= 0) {
				const frame = buf.slice(0, i); buf = buf.slice(i + 2);
				const line = frame.split('\n').find((l) => l.startsWith('data:'));
				if (!line) continue;
				let evt; try { evt = JSON.parse(line.slice(5)); } catch { continue; }
				if (evt.type === 'chunk') { talk.reply += evt.text; show(talkView(talk, handlers)); }
				else if (evt.type === 'done') { talk.suggestions = Array.isArray(evt.suggestions) ? evt.suggestions : []; }
				else if (evt.type === 'error') throw new Error(evt.message || 'chat');
			}
		}
	} catch {
		talk.error = 'The agent did not answer. Try again.';
	}
	talk.busy = false;
	if (talk.sound && talk.reply && caps.audioOut) speak(window, talk.reply);
	if (screen === 'talk') show(talkView(talk, handlers));
}

async function handoff() {
	screen = 'handoff';
	const state = { loading: true };
	show(handoffView(state, handlers));
	try {
		const res = await fetch('/api/glass/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinId: current.id }) });
		if (!res.ok) throw new Error('handoff');
		const out = await res.json();
		show(handoffView({ code: out.code, url: out.url.replace(/^https?:\/\//, '') }, handlers));
	} catch {
		show(handoffView({ error: 'The agent may have moved on. Go back and try again.' }, handlers));
	}
}

function back() {
	if (screen === 'talk' || screen === 'handoff') { if (caps.audioOut) window.speechSynthesis.cancel(); screen = 'card'; openCard(current); }
	else if (screen === 'card') { screen = 'nearby'; refresh(); renderNearby(); }
}

async function speakReply() {
	talk.listening = true; talk.voiceError = '';
	show(talkView(talk, handlers));
	let text = null;
	try { text = await listenOnce(caps.Recognition); } catch (err) { talk.voiceError = err.message; }
	talk.listening = false;
	if (text) return sendTalk(text);
	if (screen === 'talk') show(talkView(talk, handlers));
}

function toggleSound() {
	talk.sound = !talk.sound;
	if (!talk.sound && caps.audioOut) window.speechSynthesis.cancel();
	show(talkView(talk, handlers));
}

const handlers = {
	onTalk: () => { screen = 'talk'; talk = { name: current.avatar_name || 'Agent', reply: '', suggestions: [], busy: false, error: '', listening: false, sound: false, voiceError: '' }; show(talkView(talk, handlers)); },
	onSpeak: caps.speechInput ? speakReply : null,
	onSound: caps.audioOut ? toggleSound : null,
	onSend: sendTalk,
	onHandoff: handoff,
	onRetry: handoff,
	onBack: back,
};

window.addEventListener('offline', () => { if (screen === 'nearby' || screen === 'scanning') show(offlineView(begin)); });
window.addEventListener('online', () => { if (screen === 'error') begin(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && screen === 'nearby') refresh(); });

show(startView(begin));

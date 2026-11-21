/**
 * /voice/grok: Grok Voice realtime speech to speech driving a lip-synced 3D avatar.
 *
 * Engine selection, decided once from the server's own answer:
 *   grok    GET /api/voice/grok/session says configured and the visitor is signed
 *           in: GrokRealtime streams the mic to Grok and the reply into the avatar.
 *   signin  configured but signed out: sign-in call to action, with the standard
 *           chain offered on the same avatar meanwhile.
 *   chain   not configured (or the broker answers 503 grok_voice_not_configured
 *           mid-session): the standard voice chain (speech recognition, the agent's
 *           chat model, speech synthesis) on the same avatar. Never a fake session.
 *
 * Latency comes from real timestamps on both engines so the numbers compare:
 *   reply  end of the user's speech to the first reply audio frame
 *   mouth  first reply audio frame to the first mouth movement
 */

import { TalkScene } from './voice/talk-scene.js';
import { AvatarMouthTarget } from './voice/avatar-morph-target.js';
import { TalkController } from './voice/talk-controller.js';
import { GrokRealtime } from './voice/grok-realtime.js';
import { getMe } from './account.js';

const SESSION_URL = '/api/voice/grok/session';
const PICKER_LIMIT = 12;
const MOUTH_OPEN_THRESHOLD = 0.05;
// The chain's mouth watch gives up if a reply never opens the mouth (a model
// with no mouth driver), so a stale mark cannot be credited to a later turn.
const MOUTH_WATCH_MS = 5000;

const $ = (id) => document.getElementById(id);
const el = {
	kicker: $('vg-kicker'),
	banner: $('vg-banner'),
	stage: $('vg-stage'),
	stageMsg: $('vg-stage-msg'),
	state: $('vg-state'),
	engineTag: $('vg-engine-tag'),
	mode: $('vg-mode'),
	connect: $('vg-connect'),
	hangup: $('vg-hangup'),
	talk: $('vg-talk'),
	talkLabel: $('vg-talk-label'),
	talkSub: $('vg-talk-sub'),
	talkHint: $('vg-talk-hint'),
	picker: $('vg-picker'),
	latResponse: $('vg-lat-response'),
	latMouth: $('vg-lat-mouth'),
	latEmpty: $('vg-lat-empty'),
	turns: $('vg-turns'),
	medR: $('vg-med-r'),
	medM: $('vg-med-m'),
	medO: $('vg-med-o'),
	transcript: $('vg-transcript'),
	trEmpty: $('vg-tr-empty'),
	announce: $('vg-announce'),
};

const page = {
	status: null, // GET /api/voice/grok/session body, or null when unreachable
	statusError: null,
	user: null,
	engine: 'checking', // grok | signin | chain
	mode: 'ptt',
	avatars: [],
	avatar: null, // { id, name, model_url, agent_id }
	scene: null,
	mouth: null,
	mountToken: 0,
	grok: null,
	chain: null,
	turns: [],
	held: false,
	levelRaf: 0,
	assistantEl: null,
};

// Chain-engine timing marks for the current turn (performance.now() values).
const chainMarks = { speechEnd: null, firstAudio: null, mouthTimer: 0 };
// Open user transcript bubbles keyed by item id, until their final text lands.
const userEls = new Map();

// ── boot ───────────────────────────────────────────────────────────────

init();

async function init() {
	wireControls();
	const [status, user, avatars] = await Promise.all([loadStatus(), loadUser(), loadAvatars()]);
	page.status = status;
	page.user = user;
	page.avatars = avatars;
	chooseEngine();
	renderPicker();
	const wanted = new URLSearchParams(location.search).get('avatar');
	if (wanted) await selectAvatar(wanted);
	else if (avatars.length) await selectAvatar(avatars[0].id);
	else showStageMessage('No public avatars are available right now. Reload in a moment, or open one from /avatars and add ?avatar=<id> to this page.');
}

async function loadStatus() {
	try {
		const r = await fetch(SESSION_URL, { headers: { accept: 'application/json' } });
		const body = await r.json().catch(() => null);
		if (!r.ok || !body) {
			page.statusError = `The Grok voice service answered HTTP ${r.status}.`;
			return null;
		}
		return body;
	} catch (err) {
		page.statusError = `Could not reach the Grok voice service: ${err?.message || err}.`;
		return null;
	}
}

async function loadUser() {
	try {
		return await getMe();
	} catch {
		return null;
	}
}

async function loadAvatars() {
	try {
		const r = await fetch(`/api/avatars/public?category=avatar&limit=${PICKER_LIMIT}`, { headers: { accept: 'application/json' } });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const body = await r.json();
		return (body.avatars || []).filter((a) => a.model_url).map(avatarRecord);
	} catch (err) {
		el.picker.innerHTML = '';
		const p = document.createElement('p');
		p.className = 'vg-empty';
		p.textContent = `Could not load avatars (${err.message}). Reload the page to try again.`;
		el.picker.append(p);
		return [];
	}
}

function avatarRecord(a) {
	return {
		id: a.id,
		name: a.name || 'Avatar',
		model_url: a.model_url,
		agent_id: a.agent_id || null,
		thumb: a.thumbnail_url || a.thumb_url || null,
	};
}

// ── engine choice and banners ──────────────────────────────────────────

function chooseEngine() {
	if (page.status?.configured && page.user) setEngine('grok');
	else if (page.status?.configured) setEngine('signin');
	else setEngine('chain', page.status ? 'not_configured' : 'unreachable');
}

function setEngine(engine, reason = null) {
	page.engine = engine;
	el.kicker.dataset.engine = engine === 'grok' ? 'grok' : engine === 'chain' ? 'chain' : 'signin';
	el.kicker.textContent =
		engine === 'grok' ? `Grok Voice realtime · ${page.status?.model || ''}`.trim()
		: engine === 'chain' ? 'Standard voice chain'
		: 'Grok Voice realtime · sign in to start';
	el.engineTag.hidden = false;
	el.engineTag.textContent = engine === 'chain' ? 'ASR → chat → TTS' : 'speech to speech';
	const openBtn = el.mode.querySelector('[data-mode="open"]');
	openBtn.disabled = engine === 'chain';
	openBtn.title = engine === 'chain' ? 'Open mic needs Grok voice; the standard chain is push to talk.' : '';
	if (engine === 'chain' && page.mode === 'open') setMode('ptt');
	renderEngineBanner(reason);
	syncControls();
}

function renderEngineBanner(reason) {
	if (page.engine === 'grok') return hideBanner();
	if (page.engine === 'signin') {
		return showBanner({
			tone: 'info',
			title: 'Sign in to talk with Grok voice',
			text: 'Realtime voice sessions are minted per account so each one is rate limited and metered. Sign in and come straight back here, or talk to the same avatar through the standard voice chain now.',
			actions: [
				{ label: 'Sign in', href: `/login?next=${encodeURIComponent(location.pathname + location.search)}`, primary: true },
				{ label: 'Use the standard voice chain', onClick: () => switchToChain('signin') },
			],
		});
	}
	if (reason === 'unreachable') {
		return showBanner({
			tone: 'error',
			title: 'Grok voice is unreachable right now',
			text: `${page.statusError || 'The Grok voice service did not answer.'} You are on the standard voice chain meanwhile, on the same avatar.`,
			actions: [{ label: 'Check again', onClick: recheckStatus }],
		});
	}
	return showBanner({
		tone: 'warn',
		title: 'Grok voice is not enabled on this server yet',
		html: 'The session broker answers <code>503 grok_voice_not_configured</code> until an xAI key is set. You are talking to the same avatar through the standard voice chain instead: speech recognition, the agent\'s chat model, then speech synthesis. The latency panel times that chain, so it doubles as the baseline Grok voice is measured against.',
		actions: [{ label: 'How Grok voice works', href: '/docs/voice-grok' }],
	});
}

async function recheckStatus() {
	page.statusError = null;
	page.status = await loadStatus();
	if (page.status?.configured && !page.user) page.user = await loadUser();
	teardownSession();
	chooseEngine();
}

function switchToChain(reason) {
	teardownSession();
	setEngine('chain', reason === 'signin' ? 'not_configured' : reason);
	if (reason === 'signin') {
		showBanner({
			tone: 'info',
			title: 'Standard voice chain',
			text: 'Speech recognition, the agent\'s chat model, then speech synthesis, on the same avatar. Sign in any time to switch to Grok voice.',
			actions: [{ label: 'Sign in for Grok voice', href: `/login?next=${encodeURIComponent(location.pathname + location.search)}`, primary: true }],
		});
	}
}

function showBanner({ tone = 'info', title, text, html, actions = [] }) {
	const b = el.banner;
	b.dataset.tone = tone;
	b.setAttribute('role', tone === 'error' ? 'alert' : 'status');
	b.innerHTML = '';
	const body = document.createElement('div');
	body.className = 'vg-banner-body';
	const h = document.createElement('h2');
	h.textContent = title;
	const p = document.createElement('p');
	if (html) p.innerHTML = html;
	else p.textContent = text;
	body.append(h, p);
	b.append(body);
	if (actions.length) {
		const row = document.createElement('div');
		row.className = 'vg-banner-actions';
		for (const a of actions) {
			const node = a.href ? document.createElement('a') : document.createElement('button');
			node.className = `vg-btn${a.primary ? ' vg-btn-primary' : ''}`;
			node.textContent = a.label;
			if (a.href) node.href = a.href;
			else {
				node.type = 'button';
				node.addEventListener('click', a.onClick);
			}
			row.append(node);
		}
		b.append(row);
	}
	b.hidden = false;
}

function hideBanner() {
	el.banner.hidden = true;
	el.banner.innerHTML = '';
}

// ── avatar ─────────────────────────────────────────────────────────────

function renderPicker() {
	if (!page.avatars.length) return;
	el.picker.innerHTML = '';
	for (const a of page.avatars) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'vg-pick';
		b.dataset.id = a.id;
		b.setAttribute('aria-pressed', 'false');
		b.setAttribute('aria-label', `Talk to ${a.name}`);
		const name = document.createElement('span');
		name.textContent = a.name;
		b.append(a.thumb ? pickThumb(a) : pickMonogram(a), name);
		b.addEventListener('click', () => selectAvatar(a.id));
		el.picker.append(b);
	}
}

// Most public avatars have no poster yet; a lettered tile stands in for them
// (and for a poster that fails to load) instead of a broken image.
function pickMonogram(a) {
	const tile = document.createElement('i');
	tile.className = 'vg-pick-mono';
	tile.setAttribute('aria-hidden', 'true');
	tile.textContent = (a.name.trim()[0] || '?').toUpperCase();
	return tile;
}

function pickThumb(a) {
	const img = document.createElement('img');
	img.alt = '';
	img.loading = 'lazy';
	img.decoding = 'async';
	img.addEventListener('error', () => img.replaceWith(pickMonogram(a)), { once: true });
	img.src = a.thumb;
	return img;
}

async function selectAvatar(id) {
	if (page.avatar?.id === id && page.scene) return;
	teardownSession();
	let avatar = page.avatars.find((a) => a.id === id);
	if (!avatar) {
		try {
			const r = await fetch(`/api/avatars/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
			if (!r.ok) throw new Error(r.status === 404 ? 'that avatar does not exist or is private' : `HTTP ${r.status}`);
			const rec = (await r.json()).avatar;
			if (!rec?.model_url) throw new Error('that avatar has no model to load');
			avatar = avatarRecord(rec);
		} catch (err) {
			showStageMessage(`Could not open avatar ${id}: ${err.message}. Pick one from the list instead.`);
			return;
		}
	}
	page.avatar = avatar;
	for (const b of el.picker.querySelectorAll('.vg-pick')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
	const url = new URL(location.href);
	url.searchParams.set('avatar', id);
	history.replaceState(null, '', url);
	await mountAvatar(avatar);
}

async function mountAvatar(avatar) {
	const token = ++page.mountToken;
	page.scene?.unmount();
	page.scene = null;
	page.mouth = null;
	syncControls();
	el.stage.querySelector('.vg-stage-note')?.remove();
	el.stageMsg.hidden = false;
	el.stageMsg.innerHTML = '<div class="vg-skeleton" aria-hidden="true"></div>';
	const scene = new TalkScene();
	const mouth = new AvatarMouthTarget();
	try {
		await scene.mount({ container: el.stage, glbUrl: avatar.model_url, cameraPreset: 'half' });
	} catch (err) {
		scene.unmount();
		if (token !== page.mountToken) return;
		showStageMessage(`Could not load ${avatar.name}: ${err?.message || err}. Pick another avatar.`);
		return;
	}
	if (token !== page.mountToken) {
		scene.unmount();
		return;
	}
	scene.attachMouthTarget(mouth);
	page.scene = scene;
	page.mouth = mouth;
	el.stageMsg.hidden = true;
	if (!mouth.hasAnyMouthDriver()) {
		showStageNote(`${avatar.name} has no mouth morphs, jaw bone or head bone, so the voice plays but nothing on the model moves. Pick another avatar for lip sync.`);
	}
	syncControls();
	startIdle(scene, token);
}

// A GLB without an idle clip of its own would stand in bind pose, arms out.
// The shared animation library's idle loop (retargeted per bone) keeps it
// breathing between turns; a rig it cannot drive simply stays as it was.
async function startIdle(scene, token) {
	if (scene.playingClip) return;
	const emotes = scene.getEmoteController();
	if (!emotes || !(await emotes.loadManifest())) return;
	if (token !== page.mountToken) return;
	await scene.playEmote('idle');
}

function showStageMessage(text) {
	el.stageMsg.hidden = false;
	el.stageMsg.textContent = text;
}

function showStageNote(text) {
	const note = document.createElement('p');
	note.className = 'vg-stage-note';
	note.textContent = text;
	el.stage.append(note);
}

// ── controls ───────────────────────────────────────────────────────────

function wireControls() {
	for (const b of el.mode.querySelectorAll('button')) b.addEventListener('click', () => setMode(b.dataset.mode));
	el.connect.addEventListener('click', onConnect);
	el.hangup.addEventListener('click', () => {
		teardownSession();
		setState('idle');
		announce('Conversation ended.');
	});
	const press = (e) => {
		if (el.talk.disabled) return;
		e.preventDefault();
		el.talk.setPointerCapture?.(e.pointerId);
		pressTalk();
	};
	const release = () => releaseTalk();
	el.talk.addEventListener('pointerdown', press);
	el.talk.addEventListener('pointerup', release);
	el.talk.addEventListener('pointercancel', release);
	el.talk.addEventListener('lostpointercapture', release);
	el.talk.addEventListener('keydown', (e) => {
		if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
			e.preventDefault();
			pressTalk();
		}
	});
	el.talk.addEventListener('keyup', (e) => {
		if (e.key === ' ' || e.key === 'Enter') releaseTalk();
	});
	// Space anywhere on the page (outside form fields) holds to talk too.
	document.addEventListener('keydown', (e) => {
		if (e.key !== ' ' || e.repeat || e.target === el.talk || isTyping(e.target) || el.talk.disabled) return;
		e.preventDefault();
		pressTalk();
	});
	document.addEventListener('keyup', (e) => {
		if (e.key === ' ' && e.target !== el.talk && !isTyping(e.target)) releaseTalk();
	});
	addEventListener('pagehide', teardownSession);
}

function isTyping(t) {
	return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName));
}

function setMode(mode) {
	page.mode = mode === 'open' ? 'open' : 'ptt';
	for (const b of el.mode.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === page.mode));
	page.grok?.setMode(page.mode);
	syncControls();
}

function syncControls() {
	const ready = Boolean(page.scene);
	const live = page.engine === 'chain' ? Boolean(page.chain) : Boolean(page.grok && page.grok.state !== 'error' && page.grok.state !== 'closed');
	el.connect.hidden = live;
	el.hangup.hidden = !live;
	el.connect.disabled = !ready || page.engine === 'checking';
	el.connect.textContent = page.engine === 'signin' ? 'Sign in to start' : 'Start conversation';
	const ptt = page.engine === 'chain' || page.mode === 'ptt';
	el.talk.disabled = !live || !ptt;
	el.talkHint.hidden = !ptt;
	el.talkLabel.textContent = ptt ? (page.held ? 'Listening… release to send' : 'Hold to talk') : 'Open mic is on';
	el.talkSub.textContent = !ready
		? 'Loading the avatar…'
		: !live
			? `Press Start to talk to ${page.avatar?.name || 'the avatar'}`
			: ptt
				? 'Hold, speak, let go'
				: 'Just talk. Grok hears when you stop.';
}

async function onConnect() {
	if (page.engine === 'signin') {
		location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
		return;
	}
	if (!page.avatar || !page.scene) return;
	const mic = await micPermission();
	if (mic === 'denied') return showMicBlocked();
	if (mic === 'unsupported') {
		return showBanner({
			tone: 'error',
			title: 'This browser cannot capture a microphone',
			text: 'Voice needs microphone access over HTTPS. Open this page in a current Chrome, Edge, Safari or Firefox.',
		});
	}
	if (mic === 'prompt') announce('Your browser will ask for the microphone. Allow it to talk.');
	if (page.engine === 'grok') await startGrok();
	else await startChain();
}

async function micPermission() {
	if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
	try {
		const p = await navigator.permissions?.query({ name: 'microphone' });
		return p?.state || 'prompt';
	} catch {
		return 'prompt';
	}
}

function showMicBlocked() {
	setState('error');
	showBanner({
		tone: 'error',
		title: 'The microphone is blocked for this site',
		text: 'Click the lock or site-settings icon in the address bar, set Microphone to Allow, then press Start again. Nothing is recorded until you start a conversation.',
		actions: [{ label: 'Try again', onClick: onConnect, primary: true }],
	});
}

function pressTalk() {
	if (page.held) return;
	if (page.engine === 'chain' && page.chain) {
		if (page.chain.state === 'speaking') page.chain.hush();
		if (page.chain.startListening() === false) return;
	} else if (page.grok && page.mode === 'ptt') {
		page.grok.pressTalk();
	} else return;
	page.held = true;
	el.talk.dataset.held = 'true';
	syncControls();
}

function releaseTalk() {
	if (!page.held) return;
	page.held = false;
	el.talk.dataset.held = 'false';
	if (page.engine === 'chain' && page.chain) {
		chainMarks.speechEnd = performance.now();
		chainMarks.firstAudio = null;
		page.chain.stopListening();
	} else page.grok?.releaseTalk();
	syncControls();
}

// ── Grok engine ────────────────────────────────────────────────────────

async function startGrok() {
	hideBanner();
	const g = new GrokRealtime({ sessionUrl: SESSION_URL, agentId: page.avatar.agent_id, mode: page.mode, mouth: page.mouth });
	page.grok = g;
	g.addEventListener('state', (e) => {
		setState(e.detail.state);
		syncControls();
	});
	g.addEventListener('transcript', (e) => renderTranscript(e.detail));
	g.addEventListener('latency', (e) => recordLatency(e.detail));
	g.addEventListener('interrupted', () => {
		page.assistantEl = null;
	});
	g.addEventListener('error', (e) => onGrokError(e.detail));
	startLevelMeter(() => g.getInputLevel());
	try {
		await g.connect();
		announce(page.mode === 'ptt' ? 'Connected. Hold to talk.' : 'Connected. Just talk.');
	} catch {
		// onGrokError has already rendered the reason from the error event.
	}
	syncControls();
}

function onGrokError({ code, message, status, fatal }) {
	if (!fatal) {
		showBanner({ tone: 'warn', title: 'Grok voice hiccup', text: `${message} (${code}). The session is still open; keep talking.` });
		return;
	}
	if (code === 'grok_voice_not_configured') {
		page.status = { ...(page.status || {}), configured: false };
		switchToChain('not_configured');
		return;
	}
	if (code === 'unauthorized' || status === 401) {
		page.user = null;
		teardownSession();
		setEngine('signin');
		return;
	}
	if (code === 'permission-denied' || code === 'NotAllowedError') return showMicBlocked();
	teardownSession();
	setState('error');
	const hint =
		code === 'rate_limited' || code === 'grok_voice_rate_limited' || status === 429
			? 'Too many voice sessions in a short time. Wait a minute, then start again.'
			: code === 'no-mic'
				? 'No microphone was found. Plug one in or pick an input in your system settings, then start again.'
				: 'Start again to open a fresh session. If it keeps failing, the standard voice chain still works on this avatar.';
	showBanner({
		tone: 'error',
		title: 'Grok voice stopped',
		text: `${message} (${code}${status ? `, HTTP ${status}` : ''}). ${hint}`,
		actions: [
			{ label: 'Start again', onClick: onConnect, primary: true },
			{ label: 'Use the standard voice chain', onClick: () => switchToChain('fallback') },
		],
	});
}

// ── standard chain (fallback and baseline) ─────────────────────────────

async function startChain() {
	const avatar = page.avatar;
	const mouth = page.mouth;
	// Forward every shape to the real target and time the first open frame of
	// each reply, the chain's counterpart to GrokRealtime's mouth latency.
	const timedMouth = {
		attach: (root) => mouth.attach(root),
		setMouthShape(shape) {
			mouth.setMouthShape(shape);
			if (chainMarks.firstAudio !== null && chainMarks.mouthTimer && shape.open > MOUTH_OPEN_THRESHOLD) {
				clearTimeout(chainMarks.mouthTimer);
				chainMarks.mouthTimer = 0;
				recordLatency({ kind: 'mouth', ms: Math.round(performance.now() - chainMarks.firstAudio) });
			}
		},
	};
	const chain = new TalkController({
		avatar: { id: avatar.id, agent_id: avatar.agent_id, name: avatar.name },
		systemPromptFn: () => `You are ${avatar.name}, a friendly 3D avatar on three.ws, talking out loud with a visitor. Answer in one to three short spoken sentences with no markdown, lists or emoji.`,
		mouthTarget: timedMouth,
		onMessage: ({ role, content }) => renderTranscript({ role, text: content, final: true, itemId: null }),
		onInterim: (text) => text && renderTranscript({ role: 'user', text, final: false, itemId: 'chain-interim' }),
		onStateChange: (s) => {
			if (s === 'speaking' && chainMarks.speechEnd !== null && chainMarks.firstAudio === null) {
				chainMarks.firstAudio = performance.now();
				recordLatency({ kind: 'response', ms: Math.round(chainMarks.firstAudio - chainMarks.speechEnd) });
				clearTimeout(chainMarks.mouthTimer);
				chainMarks.mouthTimer = setTimeout(() => (chainMarks.mouthTimer = 0), MOUTH_WATCH_MS);
			}
			setState(s);
			syncControls();
		},
		onError: (err) => onChainError(err),
	});
	page.chain = chain;
	setState('connecting');
	syncControls();
	const mode = await chain.prepare();
	if (page.chain !== chain) return;
	if (mode === 'none') {
		teardownSession();
		setState('error');
		showBanner({
			tone: 'error',
			title: 'Speech input is not available in this browser',
			text: 'Neither the server speech lane nor the browser recognizer is reachable. Try a current Chrome, Edge or Safari, or check back shortly.',
			actions: [{ label: 'Try again', onClick: onConnect, primary: true }],
		});
		return;
	}
	startLevelMeter(() => chain.micLevel);
	setState('idle');
	syncControls();
	announce('Ready. Hold to talk.');
}

function onChainError(err) {
	const code = err?.code || 'chain_error';
	if (code === 'permission-denied') return showMicBlocked();
	if (code === 'no-speech') {
		showBanner({ tone: 'warn', title: 'Nothing was heard', text: 'Hold the button for the whole sentence and speak close to the microphone, then let go.' });
		return;
	}
	setState('error');
	showBanner({
		tone: 'error',
		title: 'The voice turn failed',
		text: `${err?.message || String(err)} Hold to talk again; each turn starts fresh.`,
	});
}

// ── session plumbing ───────────────────────────────────────────────────

function teardownSession() {
	stopLevelMeter();
	page.held = false;
	el.talk.dataset.held = 'false';
	if (page.grok) {
		const g = page.grok;
		page.grok = null;
		g.close();
	}
	if (page.chain) {
		const c = page.chain;
		page.chain = null;
		c.stop();
	}
	clearTimeout(chainMarks.mouthTimer);
	chainMarks.mouthTimer = 0;
	chainMarks.speechEnd = chainMarks.firstAudio = null;
	page.assistantEl = null;
	syncControls();
}

function setState(state) {
	el.state.dataset.state = state;
	el.state.textContent = state;
}

function startLevelMeter(read) {
	stopLevelMeter();
	const tick = () => {
		const v = Math.min(1, Math.max(0, read() || 0) * 2.2).toFixed(3);
		el.talk.style.setProperty('--vg-level', v);
		el.state.style.setProperty('--vg-level', v);
		page.levelRaf = requestAnimationFrame(tick);
	};
	page.levelRaf = requestAnimationFrame(tick);
}

function stopLevelMeter() {
	cancelAnimationFrame(page.levelRaf);
	page.levelRaf = 0;
	el.talk.style.setProperty('--vg-level', '0');
	el.state.style.setProperty('--vg-level', '0');
}

function announce(text) {
	el.announce.textContent = text;
}

// ── transcript ─────────────────────────────────────────────────────────

function renderTranscript({ role, text, final, itemId, delta }) {
	el.trEmpty.hidden = true;
	if (role === 'user') {
		const key = itemId || 'user';
		// A final line replaces the chain's interim bubble for the same turn.
		if (final && key !== 'chain-interim') dropUserBubble('chain-interim');
		let node = userEls.get(key);
		if (!node) {
			if (!text) return;
			node = bubble('user');
			userEls.set(key, node);
		}
		node.textContent = text;
		node.dataset.final = String(Boolean(final));
		if (final) {
			userEls.delete(key);
			if (!text) node.remove();
		}
	} else {
		if (delta) {
			if (!page.assistantEl || page.assistantEl.dataset.item !== String(itemId)) {
				page.assistantEl = bubble('assistant');
				page.assistantEl.dataset.item = String(itemId);
			}
			page.assistantEl.textContent += text;
			page.assistantEl.dataset.final = 'false';
		} else {
			const node = page.assistantEl && page.assistantEl.dataset.item === String(itemId) ? page.assistantEl : bubble('assistant');
			if (text) node.textContent = text;
			node.dataset.final = 'true';
			page.assistantEl = null;
		}
	}
	el.transcript.scrollTop = el.transcript.scrollHeight;
}

function dropUserBubble(key) {
	userEls.get(key)?.remove();
	userEls.delete(key);
}

function bubble(role) {
	const node = document.createElement('div');
	node.className = 'vg-msg';
	node.dataset.role = role;
	el.transcript.append(node);
	return node;
}

// ── latency ────────────────────────────────────────────────────────────

function recordLatency(detail) {
	const last = page.turns[page.turns.length - 1];
	if (detail.kind === 'response') {
		page.turns.push({ response: detail.ms, mouth: null, offset: null, engine: page.engine });
	} else if (detail.kind === 'mouth') {
		const turn = last && last.mouth === null ? last : null;
		if (turn) {
			turn.mouth = detail.ms;
			turn.offset = Number.isFinite(detail.av_offset_ms) ? detail.av_offset_ms : null;
		} else page.turns.push({ response: null, mouth: detail.ms, offset: detail.av_offset_ms ?? null, engine: page.engine });
	}
	renderLatency();
}

function median(values) {
	const v = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!v.length) return null;
	const mid = v.length >> 1;
	return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

const ms = (n) => (n === null || n === undefined ? '-' : `${n} ms`);

function renderLatency() {
	const turns = page.turns;
	el.latEmpty.hidden = turns.length > 0;
	el.turns.hidden = turns.length === 0;
	const r = median(turns.map((t) => t.response));
	const m = median(turns.map((t) => t.mouth));
	const o = median(turns.map((t) => t.offset));
	el.latResponse.innerHTML = r === null ? '-' : `${r}<small>ms</small>`;
	el.latMouth.innerHTML = m === null ? '-' : `${m}<small>ms</small>`;
	el.medR.textContent = ms(r);
	el.medM.textContent = ms(m);
	el.medO.textContent = ms(o);
	const body = el.turns.tBodies[0];
	body.innerHTML = '';
	turns.forEach((t, i) => {
		const tr = document.createElement('tr');
		const cells = [`${i + 1} · ${t.engine === 'chain' ? 'chain' : 'grok'}`, ms(t.response), ms(t.mouth), ms(t.offset)];
		for (const c of cells) {
			const td = document.createElement('td');
			td.textContent = c;
			tr.append(td);
		}
		body.append(tr);
	});
	window.__voiceGrokTurns = turns.map((t) => ({ ...t }));
}

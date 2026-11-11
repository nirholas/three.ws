/**
 * /microsoft/teams-stage: a shared 3D review stage for Microsoft Teams
 * meetings, built on Live Share. One page, four views:
 *
 *   stage   the full-bleed viewer on the meeting stage (frameContext
 *           meetingStage or content). Follow mode, presence, laser pointers,
 *           comment pins and animation sync run over the Live Share session.
 *   panel   the meeting side panel (frameContext sidePanel): pick a model and
 *           put it on the stage with the Teams meeting share API.
 *   config  the configurable tab's settings page (frameContext settings).
 *   solo    the stage opened in an ordinary browser tab: same viewer, pins and
 *           export for one person, with a note on how to review together.
 *
 * ?liveshare=local&fluid=<url> runs the stage against a local Fluid service
 * with TestLiveShareHost (tests/e2e/microsoft-teams-stage.spec.js and the
 * local walk-through in docs/teams-live-share.md). The Live Share chunk is a
 * dynamic import, so solo visitors never download it.
 */

import './stage.css';
import { detectTeams, onThemeChange, createLiveShareHost, stageSharing, shareToStage, registerTabConfig } from './teams-host.js';
import { SoloSession } from './solo-session.js';
import {
	cleanName,
	colorFor,
	createPin,
	encodeModelParam,
	initialsFor,
	modelKey,
	modelSourceUrl,
	normalizeAnim,
	normalizeModelState,
	parseModelInput,
	pinsForModel,
	pinsToMarkdown,
	playbackTime,
	poseDistance,
} from './stage-model.js';
import { resolveDevR2Url } from '../shared/dev-r2-proxy.js';

const params = new URLSearchParams(location.search);
const ORIGIN = location.origin;
const EXPORT_ORIGIN = 'https://three.ws';
const TIMEOUT_MS = 12_000;
const POSE_SEND_MS = 66;
const POINTER_SEND_MS = 100;
const CLICK_SLOP_PX = 5;

const FOLLOWING = new Set(['followPresenter', 'followUser']);
const SUSPENDED = new Set(['suspendFollowPresenter', 'suspendFollowUser']);

const $ = (id) => document.getElementById(id);

const state = {
	host: { inTeams: false },
	mode: 'solo',
	session: null,
	sv: null,
	me: { id: '', name: '' },
	current: null, // { ms, key, loaded }
	models: new Map(), // key -> { ref, name } for the export
	pinMode: false,
	pending: null, // pin being composed: { position, normal }
	scrubbing: false,
	lastPointer: null,
	loadSeq: 0,
};

// ── Small helpers ────────────────────────────────────────────────────────────

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function announce(text) {
	const el = $('rs-live');
	el.textContent = '';
	requestAnimationFrame(() => (el.textContent = text));
}

function throttle(fn, ms) {
	let last = 0;
	let timer = null;
	let lastArgs = null;
	return (...args) => {
		lastArgs = args;
		const wait = ms - (Date.now() - last);
		if (wait <= 0) {
			clearTimeout(timer);
			timer = null;
			last = Date.now();
			fn(...lastArgs);
		} else if (!timer) {
			timer = setTimeout(() => {
				timer = null;
				last = Date.now();
				fn(...lastArgs);
			}, wait);
		}
	};
}

async function getJson(url, { credentials } = {}) {
	const res = await fetch(url, { headers: { accept: 'application/json' }, credentials, signal: AbortSignal.timeout(TIMEOUT_MS) });
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		const err = new Error(body?.error_description || body?.error || `Request failed (${res.status})`);
		err.status = res.status;
		throw err;
	}
	return body;
}

function randomId() {
	return crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function applyTheme(theme) {
	if (!theme) return;
	const light = theme === 'default' || theme === 'light';
	document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
}

function showView(view) {
	document.body.dataset.view = view;
	$('rs-boot').hidden = true;
	$('rs-stage').hidden = view !== 'stage';
	$('rs-panel').hidden = view !== 'panel';
	$('rs-config').hidden = view !== 'config';
}

function modelNameFromUrl(url) {
	try {
		const file = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
		return cleanName(file.replace(/\.(glb|gltf|vrm)$/i, '').replace(/[-_]+/g, ' ')) || 'Model';
	} catch {
		return 'Model';
	}
}

/** A model's display name: the avatar's own name from the API, else the file name. */
async function nameForRef(ref) {
	if (ref.kind === 'url') return modelNameFromUrl(ref.url);
	try {
		const body = await getJson(`/api/avatars/${encodeURIComponent(ref.id)}`);
		return cleanName(body?.avatar?.name) || 'Avatar';
	} catch {
		return 'Avatar';
	}
}

function stageUrl(ms) {
	const u = new URL('/microsoft/teams-stage', ORIGIN);
	u.searchParams.set('model', encodeModelParam(ms.ref));
	u.searchParams.set('model_name', ms.name);
	u.searchParams.set('at', String(Date.now()));
	const theme = params.get('theme');
	if (theme) u.searchParams.set('theme', theme);
	return u.href;
}

// ── Model picker (stage dialog and side panel) ───────────────────────────────

function thumbHtml(a) {
	const src = a.thumb_url || a.thumbnail_url;
	if (src) return `<img class="rs-thumb" src="${esc(resolveDevR2Url(src))}" alt="" loading="lazy" decoding="async" />`;
	return `<span class="rs-thumb" aria-hidden="true">${esc(initialsFor(a.name))}</span>`;
}

function skeletonRows(n = 4) {
	return `<ul class="rs-items" aria-busy="true">${'<li class="rs-skel is-row" aria-hidden="true"></li>'.repeat(n)}</ul>`;
}

function mountPicker(slot, { onPick }) {
	slot.replaceChildren($('rs-picker-tpl').content.cloneNode(true));
	const root = slot.querySelector('.rs-picker');
	const tabs = [...root.querySelectorAll('.rs-tab')];
	const panels = Object.fromEntries([...root.querySelectorAll('.rs-tabpanel')].map((p) => [p.dataset.panel, p]));
	const loaded = new Set();
	let selectedKey = state.current?.key || '';

	const uid = Math.random().toString(36).slice(2, 8);
	tabs.forEach((t) => {
		t.id = `rs-tab-${t.dataset.tab}-${uid}`;
		panels[t.dataset.tab].setAttribute('aria-labelledby', t.id);
		const input = panels[t.dataset.tab].querySelector('input');
		if (input) {
			input.id = `rs-link-input-${uid}`;
			panels[t.dataset.tab].querySelector('label').htmlFor = input.id;
		}
	});

	function select(name) {
		for (const t of tabs) {
			const on = t.dataset.tab === name;
			t.setAttribute('aria-selected', String(on));
			t.tabIndex = on ? 0 : -1;
			panels[t.dataset.tab].hidden = !on;
		}
		if (!loaded.has(name)) {
			loaded.add(name);
			if (name === 'mine') loadMine();
			if (name === 'library') loadLibrary();
		}
		if (name === 'link') panels.link.querySelector('input').focus();
	}

	tabs.forEach((t, i) => {
		t.addEventListener('click', () => select(t.dataset.tab));
		t.addEventListener('keydown', (e) => {
			if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
			const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
			next.focus();
			select(next.dataset.tab);
		});
	});

	function pick(ms) {
		selectedKey = modelKey(ms.ref);
		root.querySelectorAll('.rs-item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.key === selectedKey)));
		onPick(ms);
	}

	function renderItems(panel, avatars, { emptyHtml }) {
		if (!avatars.length) {
			panel.innerHTML = emptyHtml;
			return;
		}
		panel.innerHTML = `<ul class="rs-items">${avatars
			.map((a) => {
				const key = `avatar:${a.id}`;
				const priv = a.visibility === 'private';
				const sub = priv ? 'Private: make it unlisted or public so the meeting can load it' : a.visibility === 'unlisted' ? 'Unlisted' : 'Public';
				return `<li><button class="rs-item" type="button" data-id="${esc(a.id)}" data-name="${esc(a.name)}" data-key="${esc(key)}" aria-current="${key === selectedKey}" ${priv ? 'disabled' : ''} data-testid="picker-item">
					${thumbHtml(a)}
					<span class="rs-item-text"><span class="rs-item-name">${esc(a.name || 'Untitled')}</span><span class="rs-item-sub">${esc(sub)}</span></span>
				</button></li>`;
			})
			.join('')}</ul>`;
		panel.querySelectorAll('.rs-item:not([disabled])').forEach((b) =>
			b.addEventListener('click', () => pick({ ref: { kind: 'avatar', id: b.dataset.id }, name: cleanName(b.dataset.name) || 'Avatar' })),
		);
	}

	function renderError(panel, err, retry) {
		panel.innerHTML = `<div class="rs-note is-error" role="alert"><p><strong>Could not load this list.</strong></p><p>${esc(err.message)}. Check your connection and try again.</p><button class="rs-btn is-ghost is-small" type="button">Try again</button></div>`;
		panel.querySelector('button').addEventListener('click', retry);
	}

	async function loadMine() {
		const panel = panels.mine;
		panel.innerHTML = skeletonRows();
		try {
			const me = await getJson('/api/auth/me', { credentials: 'include' }).catch((err) => (err.status === 401 ? { user: null } : Promise.reject(err)));
			if (!me?.user) {
				panel.innerHTML = `<div class="rs-note">
					<p><strong>Sign in to see your models.</strong></p>
					<p>Your three.ws models appear here once you are signed in. Some Teams clients block the sign-in cookie inside meetings; if the list stays empty after signing in, paste your model's link instead.</p>
					<div class="rs-row"><a class="rs-btn is-small" href="/login?return=${encodeURIComponent('/microsoft/teams-stage')}" target="_blank" rel="noopener" data-signin>Sign in to three.ws</a>
					<button class="rs-btn is-small is-ghost" type="button" data-go="library">Browse the library</button></div>
				</div>`;
				panel.querySelector('[data-go]').addEventListener('click', () => select('library'));
				panel.querySelector('[data-signin]').addEventListener('click', () => {
					const retry = () => {
						window.removeEventListener('focus', retry);
						loadMine();
					};
					window.addEventListener('focus', retry);
				});
				return;
			}
			const body = await getJson('/api/avatars?limit=48', { credentials: 'include' });
			renderItems(panel, body?.avatars || [], {
				emptyHtml: `<div class="rs-note"><p><strong>You have no models yet.</strong></p><p>Create one in <a href="/studio" target="_blank" rel="noopener">three.ws Studio</a>, pick one from the library, or paste a link to a .glb file.</p></div>`,
			});
		} catch (err) {
			renderError(panel, err, loadMine);
		}
	}

	async function loadLibrary() {
		const panel = panels.library;
		panel.innerHTML = skeletonRows();
		try {
			const body = await getJson('/api/avatars/featured?limit=24');
			renderItems(panel, body?.avatars || [], {
				emptyHtml: `<div class="rs-note"><p><strong>The library is empty right now.</strong></p><p>Paste a link to a .glb file instead.</p></div>`,
			});
		} catch (err) {
			renderError(panel, err, loadLibrary);
		}
	}

	const form = panels.link.querySelector('form');
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const input = form.querySelector('input');
		const errEl = form.querySelector('.rs-form-error');
		const { ref, error } = parseModelInput(input.value, { origin: ORIGIN });
		errEl.hidden = !error;
		errEl.textContent = error || '';
		input.setAttribute('aria-invalid', String(!!error));
		if (!ref) return;
		pick({ ref, name: await nameForRef(ref) });
	});

	select('mine');
	return { select };
}

// ── Stage ────────────────────────────────────────────────────────────────────

async function resolveMe() {
	if (state.mode === 'local') {
		const id = params.get('user') || randomId();
		return { id, name: cleanName(params.get('name')) || `Guest ${id.slice(0, 4)}` };
	}
	if (state.host.inTeams) {
		return { id: state.host.user.id || randomId(), name: cleanName(state.host.user.name) || 'Guest' };
	}
	try {
		const body = await getJson('/api/auth/me', { credentials: 'include' });
		const u = body?.user;
		if (u) return { id: u.id || randomId(), name: cleanName(u.display_name || u.username) || 'You' };
	} catch {
		// Anonymous visitor: the stage works the same without an account.
	}
	return { id: randomId(), name: 'You' };
}

function setConn(kind, text) {
	const el = $('rs-conn');
	el.dataset.state = kind;
	el.textContent = text;
}

function showSolo(text) {
	if (text) $('rs-solo-text').textContent = text;
	$('rs-solo').hidden = false;
}

async function joinShared() {
	setConn('connecting', 'Joining the meeting');
	const { joinSession } = await import('./session.js');
	const opts = { mode: state.mode, user: state.me, profile: { name: state.me.name } };
	if (state.mode === 'local') {
		opts.endpoint = params.get('fluid') || 'http://localhost:7070';
	} else {
		opts.teamsHost = createLiveShareHost(state.host);
	}
	return joinSession(opts);
}

async function startStage() {
	showView('stage');
	state.me = await resolveMe();
	const wantsShared = state.mode === 'local' || (state.host.inTeams && state.host.meetingId);

	if (wantsShared) {
		try {
			state.session = await joinShared();
			setConn('connected', state.mode === 'local' ? 'Local session' : 'Live');
		} catch (err) {
			state.session = new SoloSession({ userId: state.me.id, profile: { name: state.me.name } });
			setConn('offline', 'Single user');
			showSolo(`Could not join the meeting's shared session (${err?.message || err}). You can still review on your own; reopen the stage to try again.`);
		}
	} else {
		state.session = new SoloSession({ userId: state.me.id, profile: { name: state.me.name } });
		setConn('offline', 'Single user');
		if (state.host.inTeams) {
			showSolo('This tab is not part of a meeting, so there is nobody to review with. Add three.ws to a Teams meeting and share it to the stage to review together. You can still orbit, pin and export here.');
		} else {
			showSolo();
		}
	}

	wireStageUi();
	try {
		await initViewer();
	} catch (err) {
		showError('3D is not available here', `${err?.message || err}. Your browser or device could not start WebGL. Try another browser, or enable hardware acceleration.`, false);
		return;
	}
	wireSession();
	if (state.mode === 'local') {
		// Local test mode only: a read-only view of the camera and playhead, so
		// tests/e2e/microsoft-teams-stage.spec.js can compare two browsers exactly.
		window.threewsReviewStage = Object.freeze({
			pose: () => state.sv.getPose(),
			time: () => state.sv.currentTime(),
			clip: () => state.sv.current?.entry.id || '',
			loaded: () => !!state.current?.loaded,
		});
	}
	await chooseInitialModel();
	renderAll();
}

async function initViewer() {
	const { StageViewer } = await import('./stage-viewer.js');
	const sendPose = throttle((pose) => state.session.updatePose(pose), POSE_SEND_MS);
	state.sv = new StageViewer($('rs-canvas'), {
		onUserCameraStart: () => {
			const type = state.session.followState?.type;
			if (FOLLOWING.has(type)) state.session.suspend();
		},
		onUserCamera: (pose) => {
			if (state.session.shared) sendPose(pose);
		},
		onFrame: () => updateOverlay(),
	});
}

async function chooseInitialModel() {
	const session = state.session;
	const shared = normalizeModelState(session.modelState);
	const fromUrl = params.get('model') ? parseModelInput(params.get('model'), { origin: ORIGIN }).ref : null;
	if (fromUrl) {
		const at = Number(params.get('at')) || 0;
		const differs = !shared || modelKey(shared.ref) !== modelKey(fromUrl);
		if (differs && (!shared || at > shared.at)) {
			const name = cleanName(params.get('model_name')) || (await nameForRef(fromUrl));
			await session.setModel({ ref: fromUrl, name, at: at || session.now() });
			if (!session.shared) return;
		}
	}
	const now = normalizeModelState(session.modelState);
	if (now) await loadModel(now);
	else showEmpty();
}

function showEmpty() {
	$('rs-empty').hidden = false;
	$('rs-error').hidden = true;
	$('rs-model-skel').hidden = true;
	$('rs-model-name').textContent = 'No model yet';
}

function showError(title, text, canRetry = true) {
	$('rs-model-skel').hidden = true;
	$('rs-empty').hidden = true;
	$('rs-error').hidden = false;
	$('rs-error-title').textContent = title;
	$('rs-error-text').textContent = text;
	$('rs-retry').hidden = !canRetry;
}

async function loadModel(ms, { force = false } = {}) {
	const key = modelKey(ms.ref);
	state.models.set(key, { ref: ms.ref, name: ms.name });
	if (!force && state.current?.key === key) return;
	const seq = ++state.loadSeq;
	state.current = { ms, key, loaded: false };
	closeComposer();
	$('rs-model-name').textContent = ms.name;
	$('rs-empty').hidden = true;
	$('rs-error').hidden = true;
	$('rs-model-skel').hidden = false;
	$('rs-anim').hidden = true;
	state.session.updatePresence({ modelKey: key, pointer: null });
	const url = resolveDevR2Url(modelSourceUrl(ms.ref, { origin: ORIGIN }));
	try {
		await state.sv.load(url);
	} catch (err) {
		if (seq !== state.loadSeq) return;
		showError(
			'This model did not load',
			`${err?.message || 'The file could not be read'}. Everyone in the meeting downloads the model themselves, so the link must be public, served over https, and allow cross-origin requests.`,
		);
		announce(`${ms.name} did not load.`);
		return;
	}
	if (seq !== state.loadSeq) return;
	state.current.loaded = true;
	$('rs-model-skel').hidden = true;
	announce(`${ms.name} is on the stage.`);
	renderClips();
	await applyAnim();
	const fs = state.session.followState;
	if (fs && FOLLOWING.has(fs.type) && fs.value) state.sv.setPose(fs.value);
	else if (state.session.shared) state.session.updatePose(state.sv.getPose());
	renderPins();
}

function wireSession() {
	const s = state.session;
	s.on('model', (value) => {
		const ms = normalizeModelState(value);
		if (ms) loadModel(ms);
		else showEmpty();
	});
	s.on('anim', () => applyAnim());
	s.on('pins', () => renderPins());
	s.on('presence', () => {
		renderPeople();
		state.sv?.viewer.invalidate();
	});
	s.on('follow', (fs) => {
		if (fs && FOLLOWING.has(fs.type) && fs.value && state.current?.loaded) {
			if (poseDistance(fs.value, state.sv.getPose()) > 0.0005) state.sv.setPose(fs.value);
		}
		renderFollow();
		renderPeople();
		renderAnimBar();
	});
	s.on('connection', (kind) => {
		if (kind === 'connected') setConn('connected', state.mode === 'local' ? 'Local session' : 'Live');
		else setConn('offline', 'Reconnecting');
	});
	window.addEventListener('pagehide', () => s.dispose());
}

function renderAll() {
	renderPeople();
	renderFollow();
	renderPins();
	renderAnimBar();
}

// ── Presence and follow mode ─────────────────────────────────────────────────

function participants() {
	const seen = new Set();
	return state.session.participants().filter((p) => (seen.has(p.userId) ? false : seen.add(p.userId)));
}

function nameOf(userId) {
	if (!userId) return 'the presenter';
	return participants().find((p) => p.userId === userId)?.name || 'the presenter';
}

/** The user whose camera leads, or '' when everyone is free. */
function presenterId() {
	const fs = state.session.followState;
	if (!fs) return '';
	if (fs.type === 'activePresenter') return state.session.userId;
	if (fs.type === 'followPresenter' || fs.type === 'suspendFollowPresenter') return fs.followingUserId || '';
	return '';
}

function renderPeople() {
	const list = participants().sort((a, b) => (a.isLocal ? -1 : b.isLocal ? 1 : a.name.localeCompare(b.name)));
	const leader = presenterId();
	const MAX = 6;
	const shown = list.slice(0, MAX);
	const ul = $('rs-people');
	ul.innerHTML = shown
		.map((p) => {
			const role = p.userId === leader ? 'presenting' : p.isLocal ? 'you' : '';
			const label = `${p.name}${role ? ` (${role})` : ''}`;
			const canFollow = state.session.shared && !p.isLocal;
			return `<li><button class="rs-chip${p.userId === leader ? ' is-leader' : ''}" type="button" style="--chip:${colorFor(p.userId)}" data-user="${esc(p.userId)}" title="${esc(canFollow ? `${label}. Click to follow their view.` : label)}" aria-label="${esc(canFollow ? `Follow ${p.name}` : label)}" ${canFollow ? '' : 'aria-disabled="true"'} data-testid="presence-chip" data-name="${esc(p.name)}">${esc(initialsFor(p.name))}</button></li>`;
		})
		.join('');
	if (list.length > MAX) ul.insertAdjacentHTML('beforeend', `<li><span class="rs-chip is-more" title="${esc(list.slice(MAX).map((p) => p.name).join(', '))}">+${list.length - MAX}</span></li>`);
	ul.querySelectorAll('.rs-chip[data-user]:not([aria-disabled])').forEach((b) => b.addEventListener('click', () => state.session.followUser(b.dataset.user)));
}

function setFollowButtons(primary, secondary) {
	const p = $('rs-follow-primary');
	const s = $('rs-follow-secondary');
	p.textContent = primary.label;
	p.onclick = primary.run;
	s.hidden = !secondary;
	if (secondary) {
		s.textContent = secondary.label;
		s.onclick = secondary.run;
	}
}

function renderFollow() {
	const bar = $('rs-follow');
	const session = state.session;
	if (!session.shared) {
		bar.hidden = true;
		return;
	}
	bar.hidden = false;
	const fs = session.followState;
	const type = fs?.type || 'local';
	const leader = nameOf(fs?.followingUserId);
	const others = fs?.otherUsersCount || 0;
	const text = $('rs-follow-text');
	const present = async () => {
		await session.present();
		session.updatePose(state.sv.getPose());
	};
	bar.dataset.mode = type;
	switch (type) {
		case 'activePresenter':
			text.textContent = others ? `You are presenting to ${others} ${others === 1 ? 'person' : 'people'}` : 'You are presenting';
			setFollowButtons({ label: 'Stop presenting', run: () => session.stopPresenting() });
			break;
		case 'followPresenter':
			text.textContent = `Following ${leader}`;
			setFollowButtons({ label: 'Take control', run: present });
			break;
		case 'suspendFollowPresenter':
			text.textContent = `${leader} is presenting. You are looking around on your own.`;
			setFollowButtons({ label: `Jump back to ${leader}`, run: () => session.resume() });
			break;
		case 'followUser':
			text.textContent = `Following ${leader}`;
			setFollowButtons({ label: 'Stop following', run: () => session.stopFollowing() });
			break;
		case 'suspendFollowUser':
			text.textContent = `You moved away from ${leader}'s view`;
			setFollowButtons({ label: `Jump back to ${leader}`, run: () => session.resume() }, { label: 'Stop following', run: () => session.stopFollowing() });
			break;
		case 'activeFollowers':
			text.textContent = `${others} ${others === 1 ? 'person is' : 'people are'} following your view`;
			setFollowButtons({ label: 'Present to everyone', run: present });
			break;
		default:
			text.textContent = 'Everyone is looking around freely';
			setFollowButtons({ label: 'Present', run: present });
	}
}

// ── Overlay: lasers and pin markers ──────────────────────────────────────────

const laserEls = new Map();
const pinEls = new Map();

function updateOverlay() {
	const sv = state.sv;
	const cur = state.current;
	if (!sv || !cur?.loaded) {
		for (const el of laserEls.values()) el.hidden = true;
		for (const el of pinEls.values()) el.hidden = true;
		return;
	}
	const layer = $('rs-lasers');
	const live = new Set();
	for (const p of participants()) {
		if (p.isLocal || !p.pointer || p.modelKey !== cur.key) continue;
		live.add(p.userId);
		let el = laserEls.get(p.userId);
		if (!el) {
			el = document.createElement('div');
			el.className = 'rs-laser';
			el.dataset.testid = 'laser';
			el.innerHTML = '<span class="rs-laser-dot"></span><span class="rs-laser-name"></span>';
			layer.appendChild(el);
			laserEls.set(p.userId, el);
		}
		el.style.setProperty('--laser', colorFor(p.userId));
		el.querySelector('.rs-laser-name').textContent = p.name;
		el.dataset.name = p.name;
		const s = sv.project(p.pointer);
		el.hidden = !s;
		if (s) el.style.transform = `translate(${s.x}px, ${s.y}px)`;
	}
	for (const [id, el] of laserEls) {
		if (!live.has(id)) {
			el.remove();
			laserEls.delete(id);
		}
	}
	for (const [id, el] of pinEls) {
		const s = sv.project(el._p);
		el.hidden = !s;
		if (s) el.style.transform = `translate(${s.x}px, ${s.y}px)`;
		el.dataset.visible = String(!!s);
		void id;
	}
	if (!state.scrubbing && sv.current) {
		const t = sv.currentTime();
		$('rs-scrub').value = String(t);
		$('rs-time').textContent = `${t.toFixed(1)}s`;
	}
}

function sendPointer(clientX, clientY) {
	if (!state.session?.shared || !state.current?.loaded) return;
	const hit = clientX == null ? null : state.sv.pick(clientX, clientY);
	const next = hit ? hit.position.map((n) => Math.round(n * 1000) / 1000) : null;
	const prev = state.lastPointer;
	if (!next && !prev) return;
	if (next && prev && Math.max(...next.map((n, i) => Math.abs(n - prev[i]))) < 0.002) return;
	state.lastPointer = next;
	state.session.updatePresence({ pointer: next });
}

// ── Pins ─────────────────────────────────────────────────────────────────────

function currentPins() {
	return state.current ? pinsForModel(state.session.pinList(), state.current.ms.ref) : [];
}

function fmtTime(ts) {
	return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(ts));
}

function renderPins() {
	const pins = currentPins();
	$('rs-pin-count').textContent = String(pins.length);
	$('rs-pin-empty').hidden = pins.length > 0;
	const list = $('rs-pin-list');
	list.innerHTML = pins
		.map((p, i) => {
			const mine = p.authorId === state.session.userId;
			return `<li class="rs-pin-item" data-id="${esc(p.id)}" data-testid="pin-item" style="--pin:${esc(p.color)}">
				<span class="rs-pin-num" aria-hidden="true">${i + 1}</span>
				<div class="rs-pin-body">
					<p class="rs-pin-text">${esc(p.text)}</p>
					<p class="rs-pin-meta">${esc(p.authorName)} · ${esc(fmtTime(p.createdAt))}</p>
				</div>
				${mine ? `<button class="rs-icon-btn is-small" type="button" data-del="${esc(p.id)}" aria-label="Delete comment ${i + 1}" title="Delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>` : ''}
			</li>`;
		})
		.join('');
	list.querySelectorAll('[data-del]').forEach((b) =>
		b.addEventListener('click', () => {
			state.session.removePin(b.dataset.del);
			announce('Comment deleted.');
		}),
	);

	const layer = $('rs-pins-layer');
	const live = new Set(pins.map((p) => p.id));
	for (const [id, el] of pinEls) {
		if (!live.has(id)) {
			el.remove();
			pinEls.delete(id);
		}
	}
	pins.forEach((p, i) => {
		let el = pinEls.get(p.id);
		if (!el) {
			el = document.createElement('button');
			el.type = 'button';
			el.className = 'rs-pin';
			el.tabIndex = -1; // keyboard and screen readers use the comments drawer
			el.dataset.testid = 'pin-marker';
			el.addEventListener('click', () => focusPin(p.id));
			layer.appendChild(el);
			pinEls.set(p.id, el);
		}
		el._p = p.p;
		el.textContent = String(i + 1);
		el.style.setProperty('--pin', p.color);
		el.title = `${p.authorName}: ${p.text}`;
		el.setAttribute('aria-label', `Comment ${i + 1} by ${p.authorName}: ${p.text}`);
	});
	state.sv?.viewer.invalidate();
}

function focusPin(id) {
	openDrawer(true);
	const item = $('rs-pin-list').querySelector(`[data-id="${CSS.escape(id)}"]`);
	if (!item) return;
	item.classList.remove('is-flash');
	void item.offsetWidth;
	item.classList.add('is-flash');
	item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function openDrawer(open) {
	$('rs-drawer').hidden = !open;
	$('rs-pins-toggle').setAttribute('aria-expanded', String(open));
}

function setPinMode(on) {
	state.pinMode = on && !!state.current?.loaded;
	$('rs-pin-mode').setAttribute('aria-pressed', String(state.pinMode));
	$('rs-stage').classList.toggle('is-pinning', state.pinMode);
	if (on && !state.current?.loaded) announce('Load a model first, then place pins on it.');
	else if (state.pinMode) announce('Click the model where you want to leave a comment.');
	if (!state.pinMode) closeComposer();
}

function openComposer(hit, clientX, clientY) {
	state.pending = hit;
	const form = $('rs-composer');
	const stageRect = $('rs-stage').getBoundingClientRect();
	form.hidden = false;
	const w = form.offsetWidth;
	const h = form.offsetHeight;
	const x = Math.min(Math.max(clientX - stageRect.left + 12, 8), stageRect.width - w - 8);
	const y = Math.min(Math.max(clientY - stageRect.top + 12, 8), stageRect.height - h - 8);
	form.style.transform = `translate(${x}px, ${y}px)`;
	$('rs-composer-error').hidden = true;
	const ta = $('rs-composer-text');
	ta.value = '';
	ta.focus();
}

function closeComposer() {
	state.pending = null;
	$('rs-composer').hidden = true;
}

function savePin() {
	const cur = state.current;
	if (!state.pending || !cur) return;
	const { pin, error } = createPin({
		id: randomId(),
		position: state.pending.position,
		normal: state.pending.normal,
		text: $('rs-composer-text').value,
		authorId: state.session.userId,
		authorName: state.me.name,
		modelRef: cur.ms.ref,
		createdAt: state.session.now(),
	});
	if (error) {
		const el = $('rs-composer-error');
		el.textContent = error;
		el.hidden = false;
		return;
	}
	state.session.addPin(pin);
	closeComposer();
	setPinMode(false);
	announce('Comment pinned.');
}

function exportMarkdown() {
	const pins = state.session.pinList();
	const names = [...participants().map((p) => p.name), ...pins.map((p) => p.authorName)];
	return pinsToMarkdown(pins, { models: [...state.models.values()], participants: names, origin: EXPORT_ORIGIN });
}

async function copyMarkdown() {
	const md = exportMarkdown();
	const btn = $('rs-copy-md');
	let ok = false;
	try {
		await navigator.clipboard.writeText(md);
		ok = true;
	} catch {
		const ta = document.createElement('textarea');
		ta.value = md;
		ta.setAttribute('readonly', '');
		ta.className = 'rs-sr';
		document.body.appendChild(ta);
		ta.select();
		ok = document.execCommand('copy');
		ta.remove();
	}
	btn.textContent = ok ? 'Copied' : 'Copy blocked: use Download';
	announce(ok ? 'Review notes copied as markdown.' : 'This client blocked the clipboard. Use Download instead.');
	setTimeout(() => (btn.textContent = 'Copy as markdown'), 2000);
}

function downloadMarkdown() {
	const blob = new Blob([exportMarkdown()], { type: 'text/markdown;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `three-ws-review-${new Date().toISOString().slice(0, 10)}.md`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Animation sync ───────────────────────────────────────────────────────────

function animLockedBy() {
	const leader = presenterId();
	return leader && leader !== state.session.userId ? nameOf(leader) : '';
}

function renderClips() {
	const sel = $('rs-clip');
	const clips = state.sv.clipList;
	const own = clips.filter((c) => c.clip);
	const lib = clips.filter((c) => c.lib);
	const opt = (c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`;
	sel.innerHTML =
		'<option value="">No animation</option>' +
		(own.length ? `<optgroup label="In this model">${own.map(opt).join('')}</optgroup>` : '') +
		(lib.length ? `<optgroup label="Animation library">${lib.map(opt).join('')}</optgroup>` : '');
	$('rs-anim').hidden = clips.length === 0;
}

function renderAnimBar() {
	const sv = state.sv;
	if (!sv || !state.current?.loaded) return;
	const locked = animLockedBy();
	const cur = sv.current;
	$('rs-clip').value = cur?.entry.id || '';
	$('rs-clip').disabled = !!locked;
	$('rs-play').disabled = !!locked || !cur;
	$('rs-scrub').disabled = !!locked || !cur;
	const playing = !!cur && !cur.action.paused;
	$('rs-play').classList.toggle('is-playing', playing);
	$('rs-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
	$('rs-scrub').max = String(sv.duration() || 1);
	const note = $('rs-anim-note');
	note.hidden = !locked;
	note.textContent = locked ? `${locked} controls playback` : '';
}

async function applyAnim() {
	const sv = state.sv;
	const cur = state.current;
	if (!sv || !cur?.loaded) return;
	const a = normalizeAnim(state.session.animState);
	if (a.model === cur.key) {
		if (!a.clip) sv.stopClip();
		else {
			const entry = sv.clipById(a.clip);
			const now = state.session.now();
			await sv.applyClip(a.clip, {
				time: (dur) => playbackTime(a, a.sentAt || now, now, dur, { loop: entry?.loop !== false }),
				playing: a.playing,
				rate: a.rate,
			});
		}
	} else if (!sv.current) {
		const fallback = sv.clipById('lib:idle') || sv.clipById('glb:0');
		if (fallback) await sv.applyClip(fallback.id, { time: 0, playing: true });
	}
	renderAnimBar();
}

function shareAnim(patch) {
	const sv = state.sv;
	const cur = sv.current;
	const base = {
		clip: cur?.entry.id || '',
		playing: cur ? !cur.action.paused : false,
		time: sv.currentTime(),
		rate: 1,
	};
	state.session.setAnim({ ...base, ...patch, model: state.current.key, sentAt: state.session.now() });
}

// ── Stage UI wiring ──────────────────────────────────────────────────────────

let pickerDialog = null;

function openPicker() {
	const dlg = $('rs-picker-dialog');
	if (!pickerDialog) {
		pickerDialog = mountPicker($('rs-dialog-picker'), {
			onPick: (ms) => {
				dlg.close();
				state.session.setModel({ ref: ms.ref, name: ms.name, at: state.session.now() });
			},
		});
	}
	dlg.showModal();
}

function wireStageUi() {
	document.querySelectorAll('[data-action="open-picker"]').forEach((b) => b.addEventListener('click', openPicker));
	$('rs-picker-close').addEventListener('click', () => $('rs-picker-dialog').close());
	$('rs-picker-dialog').addEventListener('click', (e) => {
		if (e.target === e.currentTarget) e.currentTarget.close();
	});
	$('rs-retry').addEventListener('click', () => state.current && loadModel(state.current.ms, { force: true }));
	$('rs-solo-close').addEventListener('click', () => ($('rs-solo').hidden = true));
	$('rs-pin-mode').addEventListener('click', () => setPinMode(!state.pinMode));
	$('rs-pins-toggle').addEventListener('click', () => openDrawer($('rs-drawer').hidden));
	$('rs-drawer-close').addEventListener('click', () => openDrawer(false));
	$('rs-reset-cam').addEventListener('click', () => {
		state.sv?.resetCamera();
		if (state.session.shared) state.session.updatePose(state.sv.getPose());
	});
	$('rs-copy-md').addEventListener('click', copyMarkdown);
	$('rs-download-md').addEventListener('click', downloadMarkdown);

	$('rs-composer').addEventListener('submit', (e) => {
		e.preventDefault();
		savePin();
	});
	$('rs-composer-cancel').addEventListener('click', closeComposer);
	$('rs-composer-text').addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			savePin();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeComposer();
		}
	});

	$('rs-clip').addEventListener('change', (e) => shareAnim({ clip: e.target.value, playing: !!e.target.value, time: 0 }));
	$('rs-play').addEventListener('click', () => {
		const cur = state.sv.current;
		if (cur) shareAnim({ playing: cur.action.paused });
	});
	const scrub = $('rs-scrub');
	scrub.addEventListener('input', () => {
		const cur = state.sv.current;
		if (!cur) return;
		if (!state.scrubbing) state.scrubbing = { wasPlaying: !cur.action.paused };
		const t = Number(scrub.value);
		$('rs-time').textContent = `${t.toFixed(1)}s`;
		state.sv.applyClip(cur.entry.id, { time: t, playing: false });
	});
	scrub.addEventListener('change', () => {
		const wasPlaying = state.scrubbing ? state.scrubbing.wasPlaying : false;
		state.scrubbing = false;
		shareAnim({ time: Number(scrub.value), playing: wasPlaying });
	});

	const canvasEl = $('rs-canvas');
	const sendPointerThrottled = throttle(sendPointer, POINTER_SEND_MS);
	let down = null;
	canvasEl.addEventListener('pointermove', (e) => sendPointerThrottled(e.clientX, e.clientY));
	canvasEl.addEventListener('pointerleave', () => sendPointerThrottled(null, null));
	canvasEl.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
	canvasEl.addEventListener('pointerup', (e) => {
		if (!down || !state.pinMode) return;
		const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
		down = null;
		if (moved > CLICK_SLOP_PX) return;
		const hit = state.sv.pick(e.clientX, e.clientY);
		if (!hit) {
			announce('That spot is empty. Click on the model itself.');
			return;
		}
		openComposer(hit, e.clientX, e.clientY);
	});

	document.addEventListener('keydown', (e) => {
		const t = e.target;
		if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		if ($('rs-picker-dialog').open) return;
		if (e.key === 'p' || e.key === 'P') setPinMode(!state.pinMode);
		else if (e.key === 'c' || e.key === 'C') openDrawer($('rs-drawer').hidden);
		else if (e.key === 'Escape') {
			if (state.pinMode) setPinMode(false);
			else openDrawer(false);
		}
	});
}

// ── Side panel ───────────────────────────────────────────────────────────────

async function startPanel() {
	showView('panel');
	const status = $('rs-share-status');
	const btn = $('rs-share');
	let selected = null;
	mountPicker($('rs-panel-picker'), {
		onPick: (ms) => {
			selected = ms;
			$('rs-selected').innerHTML = `Selected: <strong>${esc(ms.name)}</strong>`;
			btn.disabled = false;
			status.textContent = '';
		},
	});

	const inMeeting = state.host.inTeams && state.host.meetingId;
	if (inMeeting) {
		const sharing = await stageSharing(state.host);
		if (!sharing.canShare) {
			status.textContent = 'Only meeting organizers and presenters can share to the stage. Ask one of them to press Share, or have them give you the presenter role.';
		} else if (sharing.isSharing) {
			status.textContent = 'three.ws is on the stage now. Pick another model and share again to switch it.';
		}
	} else {
		btn.textContent = 'Open the stage';
		status.textContent = 'Outside a Teams meeting this opens the stage in a new tab. Inside a meeting, this button puts the model on the shared stage for everyone.';
	}

	btn.addEventListener('click', async () => {
		if (!selected) return;
		const url = stageUrl(selected);
		if (!inMeeting) {
			window.open(url, '_blank', 'noopener');
			return;
		}
		btn.disabled = true;
		btn.classList.add('is-busy');
		status.textContent = 'Sharing to the stage';
		try {
			await shareToStage(state.host, url);
			status.textContent = `${selected.name} is on the meeting stage.`;
			announce(`${selected.name} shared to the stage.`);
		} catch (err) {
			status.textContent = `Teams did not share it: ${err.message}. Make sure you are a presenter in this meeting, then try again.`;
		} finally {
			btn.disabled = false;
			btn.classList.remove('is-busy');
		}
	});
}

// ── Configurable tab settings ────────────────────────────────────────────────

function startConfig() {
	showView('config');
	const status = $('rs-config-status');
	if (!state.host.inTeams) {
		status.innerHTML = `This is the step Teams shows when someone adds three.ws to a meeting. To try the stage on its own, <a href="/microsoft/teams-stage">open it here</a>.`;
		return;
	}
	registerTabConfig(state.host, {
		contentUrl: `${ORIGIN}/microsoft/teams-stage?theme={theme}`,
		websiteUrl: `${ORIGIN}/microsoft/teams-stage`,
	});
	status.textContent = 'Ready. Press Save to add the tab.';
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
	const local = params.get('liveshare') === 'local';
	if (local) {
		state.mode = 'local';
	} else {
		$('rs-boot-text').textContent = 'Connecting to Teams';
		state.host = await detectTeams();
		if (state.host.inTeams) {
			state.mode = state.host.meetingId ? 'teams' : 'solo';
			applyTheme(state.host.theme);
			onThemeChange(state.host, applyTheme);
		}
	}
	const fc = state.host.inTeams ? state.host.frameContext : '';
	const view = params.get('view') || (fc === 'settings' ? 'config' : fc === 'sidePanel' ? 'panel' : 'stage');
	if (view === 'config') return startConfig();
	if (view === 'panel') return startPanel();
	return startStage();
}

boot().catch((err) => {
	$('rs-boot').hidden = false;
	$('rs-boot').removeAttribute('aria-busy');
	$('rs-boot').querySelector('.rs-boot-skel').hidden = true;
	$('rs-boot-text').innerHTML = `<strong>The review stage could not start.</strong><br />${esc(err?.message || err)}. Reload the page to try again.`;
});

// /play/lite: the 2D way into a /play world. Same walk_world room, same people,
// same chat, dance-off, signature wall and meetup agenda as the 3D client, drawn
// as a live top-down map instead of a WebGL scene, so a phone without a GPU, a
// locked-down work laptop or a ten-year-old tablet can still join the room.
//
// Every decision that can be tested without a DOM lives in play-lite-core.js.
// This module is the wiring: DOM, the canvas map, and the CommunityNet events.
// It exposes a small window.__CC__ so the shared overlays (meetup-event.js for
// the agenda, banners and group photo, world-pa.js for the stage PA) attach to
// this client exactly as they attach to the 3D one.

import './play-lite.css';
import { CommunityNet, selfResyncTarget } from './community-net.js';
import { ensurePlayAccess } from './play-gate.js';
import { ChatLogView } from './chat-log-view.js';
import { SignatureWallData, WallClientError, recallSigned, rememberSigned } from './signature-wall-data.js';
import {
	LITE_PREF_KEY, fullUrlFrom, canUseWebGL, coinFromSearch,
	MAP_RADIUS, LITE_PLACES, LITE_WATER, LITE_DANGER, worldToMap, mapToWorld,
	safeTarget, stepToward, placeAt, approachPoint, WALK_RADIUS,
	LITE_REACTIONS, LITE_EMOTES, onDanceFloor, danceView,
} from './play-lite-core.js';

const NAME_KEY = 'cc-name';
const NAME_MAX = 24;
const CHAT_MAX = 200;
const ZOOMS = [1, 1.8, 3.2];
const FLOAT_MS = 2400;
const NOTICE_KEY = 'cc-lite-notice-seen';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of [].concat(children)) if (c != null) n.append(c);
	return n;
}

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }

function colorOf(c) {
	const n = Number(c);
	return Number.isFinite(n) && n > 0 ? `#${(n & 0xffffff).toString(16).padStart(6, '0')}` : '#d8d8de';
}

const EMOTE_ICON = new Map(LITE_EMOTES.map((e) => [e.name, e.icon]));

// ── App state ────────────────────────────────────────────────────────────────

const coin = coinFromSearch(location.search);
const worldTitle = coin.name || coin.symbol || 'Community world';

const app = {
	net: null,
	selfId: '',
	joined: false,
	status: 'connecting',
	pos: { x: 0, z: 0, yaw: 0 },
	moving: false,
	target: null,
	targetLabel: '',
	keys: new Set(),
	players: new Map(), // id -> { id, name, color, x, z, dx, dz, yaw, motion, emote, emoteTs }
	floats: [],         // { id, glyph, born }
	zoom: 0,
	dance: { state: null, votedRound: 0, dancedRound: 0 },
	tab: 'chat',
	unread: 0,
	playPass: '',
	account: '',
	lastPlaceId: '',
	driftSince: 0,
};

// ── Toasts ───────────────────────────────────────────────────────────────────

function toast(message, kind = 'info') {
	const host = $('pl-toasts');
	if (!host || !message) return;
	const t = el('div', { class: `pl-toast pl-toast-${kind}`, role: kind === 'error' ? 'alert' : 'status', text: message });
	host.append(t);
	requestAnimationFrame(() => t.classList.add('is-in'));
	const ttl = kind === 'error' ? 6500 : 4200;
	setTimeout(() => { t.classList.remove('is-in'); t.addEventListener('transitionend', () => t.remove(), { once: true }); setTimeout(() => t.remove(), 400); }, ttl);
	while (host.children.length > 3) host.firstChild.remove();
}

function announce(text) {
	const live = $('pl-live');
	if (live) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); }
}

// ── Header and status ────────────────────────────────────────────────────────

const STATUS_COPY = {
	connecting: { label: 'Joining', tone: 'wait' },
	online: { label: 'Live', tone: 'ok' },
	offline: { label: 'Reconnecting', tone: 'wait' },
	failed: { label: 'Offline', tone: 'bad' },
	denied: { label: 'Not admitted', tone: 'bad' },
	unavailable: { label: 'Unavailable', tone: 'bad' },
};

function setStatus(status, error) {
	app.status = status;
	const copy = STATUS_COPY[status] || STATUS_COPY.connecting;
	const pill = $('pl-status');
	pill.dataset.tone = copy.tone;
	pill.querySelector('.pl-status-label').textContent = copy.label;
	$('pl-retry').hidden = !(status === 'failed' || status === 'offline');
	document.body.dataset.net = status;
	const overlay = $('pl-map-state');
	if (status === 'online' && app.joined) {
		overlay.hidden = true;
	} else if (status === 'failed' || status === 'unavailable') {
		showMapState({
			title: status === 'unavailable' ? 'The live world is not available here' : 'Can’t reach the world',
			body: status === 'unavailable'
				? 'This copy of the site has no game server configured. Open three.ws/play/lite to join the live world.'
				: 'Your connection or network blocked the live link. Some work and venue Wi-Fi blocks it: try mobile data, then retry. We keep trying in the background.',
			action: status === 'failed' ? { label: 'Try again', run: () => app.net?.retry() } : null,
			detail: error || '',
		});
	} else if (status === 'offline' && app.joined) {
		showMapState({ title: 'Reconnecting', body: 'The link dropped. You will rejoin where you were in a moment.', busy: true, action: { label: 'Retry now', run: () => app.net?.retry() } });
	}
	setInteractive(status === 'online' && app.joined);
}

function showMapState({ title, body, action = null, busy = false, detail = '' }) {
	const box = $('pl-map-state');
	box.replaceChildren(
		busy ? el('span', { class: 'pl-spinner', 'aria-hidden': 'true' }) : null,
		el('strong', { class: 'pl-state-title', text: title }),
		el('p', { class: 'pl-state-body', text: body }),
		detail ? el('p', { class: 'pl-state-detail', text: detail }) : null,
		action ? el('button', { type: 'button', class: 'pl-btn pl-btn-primary', text: action.label, onclick: action.run }) : null,
	);
	box.hidden = false;
}

function setInteractive(on) {
	document.querySelectorAll('[data-needs-net]').forEach((b) => { b.disabled = !on; });
}

function updateCount() {
	const n = app.players.size;
	$('pl-count').textContent = n === 1 ? '1 here' : `${n.toLocaleString()} here`;
	$('pl-people-count').textContent = String(n);
}

// ── Players ──────────────────────────────────────────────────────────────────

function upsertPlayer(p, id) {
	const prev = app.players.get(id);
	const entry = prev || { id, dx: p.x, dz: p.z, emoteTs: p.emoteTs || 0 };
	entry.name = p.name || 'guest';
	entry.color = p.color;
	entry.x = p.x;
	entry.z = p.z;
	entry.yaw = p.yaw;
	entry.motion = p.motion;
	if (prev && p.emote && p.emoteTs && p.emoteTs !== prev.emoteTs) {
		pushFloat(id, EMOTE_ICON.get(p.emote) || '✨');
	}
	entry.emote = p.emote;
	entry.emoteTs = p.emoteTs || 0;
	app.players.set(id, entry);
	return entry;
}

function onAdd(p, id) {
	upsertPlayer(p, id);
	if (id === app.net?.sessionId) {
		// A (re)join: the server seats us where it decided (spawn, or the rejoin
		// spot). Everything local follows the server from here.
		app.selfId = id;
		app.pos = { x: p.x, z: p.z, yaw: p.yaw || 0 };
		app.target = null;
		if (!app.joined) {
			app.joined = true;
			setStatus(app.status);
			announce(`You joined ${worldTitle}.`);
		}
	}
	updateCount();
	renderRoster();
}

function onChange(p, id) {
	upsertPlayer(p, id);
	scheduleRoster();
}

// The server is the anchor every move is clamped against. Its echo of our own
// position trails a walk by one round trip, so a gap is normal while moving; a gap
// that outlives the round trip means it put us somewhere else (a respawn) or
// refused a step, and every later move would be refused too. Adopt its position.
function reconcileSelf(now) {
	const srv = app.players.get(app.selfId);
	if (!srv) return;
	const snap = selfResyncTarget({ x: app.pos.x, z: app.pos.z }, { x: srv.x, y: 0, z: srv.z });
	const far = snap && (!app.moving || Math.hypot(srv.x - app.pos.x, srv.z - app.pos.z) > 3);
	if (!far) { app.driftSince = 0; return; }
	if (!app.driftSince) { app.driftSince = now; return; }
	if (now - app.driftSince < 1500) return;
	app.driftSince = 0;
	app.pos.x = snap.x; app.pos.z = snap.z;
	app.target = null;
}

function onRemove(id) {
	app.players.delete(id);
	updateCount();
	renderRoster();
}

let rosterTimer = 0;
function scheduleRoster() {
	if (rosterTimer) return;
	rosterTimer = setTimeout(() => { rosterTimer = 0; renderRoster(); }, 500);
}

function renderRoster() {
	const list = $('pl-roster');
	const me = app.players.get(app.selfId);
	const others = [...app.players.values()].filter((p) => p.id !== app.selfId)
		.sort((a, b) => a.name.localeCompare(b.name));
	$('pl-roster-empty').hidden = others.length > 0 || !app.joined;
	const rows = [];
	if (me) rows.push(rosterRow(me, true));
	for (const p of others.slice(0, 150)) rows.push(rosterRow(p, false));
	list.replaceChildren(...rows);
	if (others.length > 150) list.append(el('li', { class: 'pl-roster-more', text: `and ${others.length - 150} more on the plaza` }));
	setInteractive(app.status === 'online' && app.joined);
}

function rosterRow(p, self) {
	const dist = Math.round(Math.hypot(p.x - app.pos.x, p.z - app.pos.z));
	const where = placeAt(p.x, p.z);
	return el('li', {}, el('button', {
		type: 'button', class: 'pl-roster-row' + (self ? ' is-self' : ''), 'data-needs-net': self ? null : '',
		'aria-label': self ? `${p.name}, you` : `Walk to ${p.name}`,
		onclick: self ? () => $('pl-rename-input').focus() : () => walkToPlayer(p.id),
	}, [
		el('span', { class: 'pl-dot', style: `background:${colorOf(p.color)}`, 'aria-hidden': 'true' }),
		el('span', { class: 'pl-roster-name', text: p.name }),
		el('span', { class: 'pl-roster-meta', text: self ? 'you' : (where ? where.label : `${dist} m`) }),
	]));
}

function walkToPlayer(id) {
	const p = app.players.get(id);
	if (!p) return;
	// Stop just short of them, on our side, so the two avatars don't overlap.
	const dx = app.pos.x - p.x, dz = app.pos.z - p.z;
	const d = Math.hypot(dx, dz) || 1;
	setTarget(safeTarget(p.x + (dx / d) * 1.4, p.z + (dz / d) * 1.4), p.name);
	if (window.matchMedia('(max-width: 899px)').matches) $('pl-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Movement ─────────────────────────────────────────────────────────────────

function setTarget(pt, label = '') {
	if (!app.joined) return;
	app.target = { x: pt.x, z: pt.z };
	app.targetLabel = label;
	updateWhere();
}

const KEY_DIRS = {
	ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
	ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
};

function keyVector() {
	let x = 0, z = 0;
	for (const k of app.keys) { const d = KEY_DIRS[k]; if (d) { x += d[0]; z += d[1]; } }
	const len = Math.hypot(x, z);
	return len ? { x: x / len, z: z / len } : null;
}

function typingInField(e) {
	const t = e.target;
	return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function stepSelf(dt, now) {
	if (!app.joined) return;
	reconcileSelf(now);
	const dir = keyVector();
	if (dir) {
		app.target = safeTarget(app.pos.x + dir.x * 2, app.pos.z + dir.z * 2);
		app.targetLabel = '';
	}
	let moving = false;
	if (app.target) {
		const s = stepToward(app.pos, app.target, dt);
		app.pos.x = s.x; app.pos.z = s.z; app.pos.yaw = s.yaw;
		moving = !s.arrived;
		if (s.arrived && !dir) { app.target = null; app.targetLabel = ''; }
	}
	if (moving !== app.moving) { app.moving = moving; updateWhere(); }
	app.net?.sendMove({ x: app.pos.x, y: 0, z: app.pos.z, yaw: app.pos.yaw, motion: moving ? 'walk' : 'idle' });
	const self = app.players.get(app.selfId);
	if (self) { self.dx = app.pos.x; self.dz = app.pos.z; }
}

function stepPeers(dt) {
	const k = 1 - Math.exp(-dt * 10);
	for (const p of app.players.values()) {
		if (p.id === app.selfId) continue;
		// Snap on a long jump (a respawn or a teleport) rather than gliding across the map.
		if (Math.hypot(p.x - p.dx, p.z - p.dz) > 8) { p.dx = p.x; p.dz = p.z; continue; }
		p.dx += (p.x - p.dx) * k;
		p.dz += (p.z - p.dz) * k;
	}
}

function updateWhere() {
	const here = placeAt(app.pos.x, app.pos.z);
	let text;
	if (!app.joined) text = 'Joining the plaza';
	else if (app.moving) text = app.targetLabel ? `Walking to ${app.targetLabel}` : 'Walking';
	else if (here) text = `You’re at the ${here.label.toLowerCase()}`;
	else text = 'Tap the map to walk';
	$('pl-where').textContent = text;
	if (here?.id !== app.lastPlaceId) {
		app.lastPlaceId = here?.id || '';
		if (here && !app.moving) announce(`Arrived at the ${here.label.toLowerCase()}.`);
		renderDance();
	}
}

// ── The map ──────────────────────────────────────────────────────────────────

const map = { canvas: null, ctx: null, size: 0, dpr: 1 };

function view() {
	const zoom = ZOOMS[app.zoom];
	const radius = MAP_RADIUS / zoom;
	if (zoom === 1) return { cx: 0, cz: 0, radius };
	// Follow the player, but never past the world's edge.
	const lim = Math.max(0, MAP_RADIUS - radius);
	const clamp = (v) => Math.max(-lim, Math.min(lim, v));
	return { cx: clamp(app.pos.x), cz: clamp(app.pos.z), radius };
}

function resizeMap() {
	const rect = map.canvas.getBoundingClientRect();
	const size = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
	map.dpr = Math.min(window.devicePixelRatio || 1, 2);
	map.size = size;
	map.canvas.width = Math.round(size * map.dpr);
	map.canvas.height = Math.round(size * map.dpr);
}

function drawMap(ctx, size, v, now, { forPhoto = false } = {}) {
	const m = size / (2 * v.radius); // px per metre
	ctx.clearRect(0, 0, size, size);
	ctx.fillStyle = '#0b0b0d';
	ctx.fillRect(0, 0, size, size);

	// The world disc and a 10 m grid.
	const c = toPxSized(0, 0, v, size);
	ctx.fillStyle = '#141417';
	ctx.beginPath(); ctx.arc(c.px, c.py, MAP_RADIUS * m, 0, Math.PI * 2); ctx.fill();
	ctx.save();
	ctx.beginPath(); ctx.arc(c.px, c.py, MAP_RADIUS * m, 0, Math.PI * 2); ctx.clip();
	ctx.strokeStyle = 'rgba(255,255,255,0.05)';
	ctx.lineWidth = 1;
	for (let g = -MAP_RADIUS; g <= MAP_RADIUS; g += 10) {
		const a = toPxSized(g, -MAP_RADIUS, v, size), b = toPxSized(g, MAP_RADIUS, v, size);
		ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
		const e = toPxSized(-MAP_RADIUS, g, v, size), f = toPxSized(MAP_RADIUS, g, v, size);
		ctx.beginPath(); ctx.moveTo(e.px, e.py); ctx.lineTo(f.px, f.py); ctx.stroke();
	}
	ctx.restore();
	// Walkable edge.
	ctx.strokeStyle = 'rgba(255,255,255,0.10)';
	ctx.setLineDash([4, 6]);
	ctx.beginPath(); ctx.arc(c.px, c.py, WALK_RADIUS * m, 0, Math.PI * 2); ctx.stroke();
	ctx.setLineDash([]);

	for (const w of LITE_WATER) {
		const p = toPxSized(w.x, w.z, v, size);
		ctx.fillStyle = 'rgba(92,150,190,0.30)';
		ctx.strokeStyle = 'rgba(120,180,220,0.45)';
		ctx.beginPath(); ctx.arc(p.px, p.py, w.r * m, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
	}
	for (const d of LITE_DANGER) {
		const p = toPxSized(d.x, d.z, v, size);
		ctx.fillStyle = 'rgba(220,70,70,0.10)';
		ctx.strokeStyle = 'rgba(230,90,90,0.45)';
		ctx.setLineDash([3, 4]);
		ctx.beginPath(); ctx.arc(p.px, p.py, d.r * m, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.setLineDash([]);
	}

	const dancing = app.dance.state && app.dance.state.phase && app.dance.state.phase !== 'idle';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	const labelPx = Math.max(10, Math.min(13, size / 34));
	for (const pl of LITE_PLACES) {
		const p = toPxSized(pl.x, pl.z, v, size);
		const r = Math.max(4, pl.r * m);
		if (pl.kind === 'dance') {
			ctx.fillStyle = dancing ? 'rgba(255,206,92,0.22)' : 'rgba(255,206,92,0.10)';
			ctx.strokeStyle = dancing ? 'rgba(255,206,92,0.95)' : 'rgba(255,206,92,0.55)';
			ctx.lineWidth = dancing ? 2 : 1.5;
		} else {
			ctx.fillStyle = 'rgba(255,255,255,0.06)';
			ctx.strokeStyle = pl.go ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.22)';
			ctx.lineWidth = 1;
		}
		ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.lineWidth = 1;
		ctx.font = `600 ${labelPx}px Inter, system-ui, sans-serif`;
		ctx.fillStyle = pl.kind === 'dance' ? 'rgba(255,214,120,0.95)' : (pl.go ? 'rgba(245,245,246,0.85)' : 'rgba(245,245,246,0.5)');
		ctx.fillText(pl.label, p.px, p.py + r + 3);
	}

	if (app.target && !forPhoto) {
		const t = toPxSized(app.target.x, app.target.z, v, size);
		ctx.strokeStyle = 'rgba(255,255,255,0.7)';
		ctx.beginPath(); ctx.arc(t.px, t.py, 5, 0, Math.PI * 2); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(t.px - 8, t.py); ctx.lineTo(t.px + 8, t.py); ctx.moveTo(t.px, t.py - 8); ctx.lineTo(t.px, t.py + 8); ctx.stroke();
	}

	// Players: everyone else first, you on top.
	const crowd = app.players.size;
	const nameAll = forPhoto || crowd <= 24 || app.zoom > 0;
	const dotR = Math.max(3.5, Math.min(6, size / 90));
	const order = [...app.players.values()].sort((a, b) => (a.id === app.selfId) - (b.id === app.selfId));
	ctx.font = `600 ${Math.max(10, labelPx - 1)}px Inter, system-ui, sans-serif`;
	ctx.textBaseline = 'bottom';
	for (const p of order) {
		const self = p.id === app.selfId;
		const x = self ? app.pos.x : p.dx, z = self ? app.pos.z : p.dz;
		const q = toPxSized(x, z, v, size);
		if (q.px < -20 || q.py < -20 || q.px > size + 20 || q.py > size + 20) continue;
		if (self) {
			ctx.fillStyle = 'rgba(255,255,255,0.14)';
			ctx.beginPath(); ctx.arc(q.px, q.py, dotR * 2.6, 0, Math.PI * 2); ctx.fill();
			// Facing tick.
			const yaw = app.pos.yaw || 0;
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 2;
			ctx.beginPath(); ctx.moveTo(q.px, q.py); ctx.lineTo(q.px + Math.sin(yaw) * dotR * 2.4, q.py + Math.cos(yaw) * dotR * 2.4); ctx.stroke();
			ctx.lineWidth = 1;
		}
		ctx.fillStyle = colorOf(p.color);
		ctx.strokeStyle = self ? '#ffffff' : 'rgba(0,0,0,0.7)';
		ctx.lineWidth = self ? 2 : 1;
		ctx.beginPath(); ctx.arc(q.px, q.py, self ? dotR + 1.5 : dotR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.lineWidth = 1;
		const near = Math.hypot(x - app.pos.x, z - app.pos.z) < 8;
		if (self || nameAll || near) {
			const label = self ? `${p.name} (you)` : p.name;
			ctx.fillStyle = 'rgba(0,0,0,0.65)';
			const w = ctx.measureText(label).width + 8;
			const ly = q.py - dotR - 4;
			ctx.fillRect(q.px - w / 2, ly - labelPx - 2, w, labelPx + 4);
			ctx.fillStyle = self ? '#ffffff' : 'rgba(245,245,246,0.9)';
			ctx.fillText(label, q.px, ly + 1);
		}
	}

	// Reactions and emotes float up from whoever sent them.
	if (!forPhoto) {
		ctx.textBaseline = 'middle';
		ctx.font = `${Math.max(16, dotR * 4)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
		app.floats = app.floats.filter((f) => now - f.born < FLOAT_MS);
		for (const f of app.floats) {
			const p = app.players.get(f.id);
			if (!p) continue;
			const self = f.id === app.selfId;
			const q = toPxSized(self ? app.pos.x : p.dx, self ? app.pos.z : p.dz, v, size);
			const t = (now - f.born) / FLOAT_MS;
			ctx.globalAlpha = 1 - t * t;
			ctx.fillText(f.glyph, q.px + f.jitter, q.py - dotR * 3 - t * 36);
		}
		ctx.globalAlpha = 1;
	}
}

function toPxSized(x, z, v, size) { return worldToMap(x - v.cx, z - v.cz, size, v.radius); }

function pushFloat(id, glyph) {
	app.floats.push({ id, glyph, born: performance.now(), jitter: (Math.random() - 0.5) * 14 });
	if (app.floats.length > 80) app.floats.splice(0, app.floats.length - 80);
}

function pointerToWorld(e) {
	const rect = map.canvas.getBoundingClientRect();
	const v = view();
	const w = mapToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, v.radius);
	return { x: w.x + v.cx, z: w.z + v.cz };
}

function onMapTap(e) {
	if (!app.joined) return;
	const w = pointerToWorld(e);
	// A tap on (or just beside) a landmark walks to its standing spot.
	const hit = LITE_PLACES.find((p) => Math.hypot(w.x - p.x, w.z - p.z) <= p.r + 1.2);
	if (hit) setTarget(approachPoint(hit), hit.label.toLowerCase());
	else setTarget(safeTarget(w.x, w.z));
}

function setZoom(i) {
	app.zoom = Math.max(0, Math.min(ZOOMS.length - 1, i));
	$('pl-zoom-out').disabled = app.zoom === 0;
	$('pl-zoom-in').disabled = app.zoom === ZOOMS.length - 1;
}

// ── Frame loop ───────────────────────────────────────────────────────────────

let lastFrame = performance.now();
function frame(now) {
	const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
	lastFrame = now;
	stepSelf(dt, now);
	stepPeers(dt);
	const ctx = map.ctx;
	ctx.setTransform(map.dpr, 0, 0, map.dpr, 0, 0);
	drawMap(ctx, map.size, view(), now);
	requestAnimationFrame(frame);
}

// ── Social: reactions, emotes, chat ──────────────────────────────────────────

let chat = null;

function sendChat(e) {
	e.preventDefault();
	const input = $('pl-chat-input');
	const text = input.value.trim().slice(0, CHAT_MAX);
	if (!text) return;
	if (!app.net?.isLive()) { toast('Not connected yet. Your message is still in the box.', 'warn'); return; }
	app.net.sendChat(text);
	input.value = '';
	const btn = $('pl-chat-send');
	btn.disabled = true;
	setTimeout(() => { btn.disabled = !(app.status === 'online' && app.joined); }, 700);
}

function onChat(msg) {
	if (!msg?.text) return;
	const mine = msg.id === app.selfId;
	const added = chat.addLive({ mid: msg.mid, name: msg.name || 'guest', text: msg.text, ts: msg.ts, mine });
	if (added && !mine && app.tab !== 'chat') { app.unread++; renderUnread(); }
}

function renderUnread() {
	const b = $('pl-unread');
	b.hidden = app.unread === 0;
	b.textContent = app.unread > 99 ? '99+' : String(app.unread);
}

function react(emoji) {
	if (!app.net?.isLive()) return;
	app.net.sendReaction(emoji);
}

function emote(name) {
	if (!app.net?.isLive()) return;
	app.net.sendEmote(name);
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function selectTab(name, { focus = false } = {}) {
	app.tab = name;
	document.querySelectorAll('.pl-tab').forEach((t) => {
		const on = t.dataset.tab === name;
		t.setAttribute('aria-selected', on ? 'true' : 'false');
		t.tabIndex = on ? 0 : -1;
		if (on && focus) t.focus();
	});
	document.querySelectorAll('.pl-panel').forEach((p) => { p.hidden = p.id !== `pl-panel-${name}`; });
	if (name === 'chat') { app.unread = 0; renderUnread(); }
	if (name === 'wall') loadWall();
}

function onTabKey(e) {
	const tabs = [...document.querySelectorAll('.pl-tab')];
	const i = tabs.findIndex((t) => t.dataset.tab === app.tab);
	let j = -1;
	if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
	else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
	else if (e.key === 'Home') j = 0;
	else if (e.key === 'End') j = tabs.length - 1;
	if (j < 0) return;
	e.preventDefault();
	selectTab(tabs[j].dataset.tab, { focus: true });
}

// ── Places ───────────────────────────────────────────────────────────────────

function renderPlaces() {
	const list = $('pl-places');
	const rows = LITE_PLACES.filter((p) => p.go).map((p) => el('li', {}, el('button', {
		type: 'button', class: 'pl-place', 'data-needs-net': '',
		onclick: () => setTarget(approachPoint(p), p.label.toLowerCase()),
	}, [
		el('span', { class: 'pl-place-label', text: p.label }),
		el('span', { class: 'pl-place-hint', text: p.hint }),
	])));
	rows.push(el('li', {}, el('button', {
		type: 'button', class: 'pl-place', 'data-needs-net': '',
		onclick: () => setTarget({ x: 0, z: 2 }, 'spawn'),
	}, [el('span', { class: 'pl-place-label', text: 'Back to spawn' }), el('span', { class: 'pl-place-hint', text: 'The middle of the plaza' })])));
	list.replaceChildren(...rows);
	setInteractive(app.status === 'online' && app.joined);
}

// ── Dance-off ────────────────────────────────────────────────────────────────

const START_REASON = {
	'not-on-floor': 'Step onto the dance floor first.',
	'need-two': 'A round needs at least two dancers on the floor.',
	'too-soon': 'A round just ended. Give it a moment.',
	busy: 'A round is already running.',
};
const VOTE_REASON = {
	closed: 'Voting has closed.',
	self: 'You can’t vote for yourself.',
	'not-contestant': 'They’re not dancing this round.',
	'already-voted': 'You already voted this round.',
};

function onDance(msg) {
	if (msg.kind === 'state') {
		app.dance.state = msg;
		const v = danceView(msg, { selfId: app.selfId });
		// A contestant in lite dances the moment the round starts, once per round.
		if (msg.phase === 'performing' && v.contestants?.some((c) => c.self) && app.dance.dancedRound !== msg.roundId) {
			app.dance.dancedRound = msg.roundId;
			emote('dance');
		}
		if (msg.phase === 'joining' && msg.event === 'open') announce('A dance-off is starting. Walk onto the dance floor to compete.');
		if (msg.phase === 'winner' && msg.winner?.name) announce(`${msg.winner.name} won the dance-off.`);
		renderDance();
	} else if (msg.kind === 'ack') {
		if ('start' in msg) {
			if (msg.reason) toast(START_REASON[msg.reason] || 'Couldn’t start a round.', 'warn');
			return;
		}
		if (msg.counted) {
			app.dance.votedRound = msg.roundId;
			const who = app.players.get(msg.target)?.name;
			toast(who ? `Vote counted for ${who}.` : 'Vote counted.', 'ok');
		} else if (msg.reason) {
			if (msg.reason === 'already-voted') app.dance.votedRound = msg.roundId;
			toast(VOTE_REASON[msg.reason] || 'That vote didn’t count.', 'warn');
		}
		renderDance();
	} else if (msg.kind === 'reward') {
		toast(msg.first ? 'You won the dance-off. The champion cosmetic is now in your wardrobe in 3D.' : 'You won the dance-off again.', 'ok');
	}
}

function renderDance() {
	const card = $('pl-dance');
	const onFloor = app.joined && onDanceFloor(app.pos.x, app.pos.z);
	const v = danceView(app.dance.state, { selfId: app.selfId, onFloor, votedRound: app.dance.votedRound });
	if (!v.visible) { card.hidden = true; return; }
	card.hidden = false;
	card.dataset.phase = v.phase;
	$('pl-dance-title').textContent = v.title;
	$('pl-dance-detail').textContent = v.detail;
	const actions = [];
	if (v.canEnter) {
		actions.push(el('button', {
			type: 'button', class: 'pl-btn pl-btn-gold', 'data-needs-net': '',
			onclick: () => setTarget(approachPoint(LITE_PLACES.find((p) => p.id === 'dance')), 'the dance floor'),
		}, 'Walk to the dance floor'));
	}
	if (v.phase === 'idle' && onFloor) {
		actions.push(el('button', { type: 'button', class: 'pl-btn pl-btn-gold', 'data-needs-net': '', onclick: () => app.net?.sendDanceStart() }, 'Start a round'));
	}
	$('pl-dance-actions').replaceChildren(...actions);
	const list = $('pl-dance-list');
	list.replaceChildren(...v.contestants.map((c) => el('li', { class: c.self ? 'is-self' : '' }, [
		el('span', { class: 'pl-dance-name', text: c.self ? `${c.name} (you)` : c.name }),
		el('span', { class: 'pl-dance-votes', text: c.votes === 1 ? '1 vote' : `${c.votes} votes` }),
		v.canVote && !c.self ? el('button', {
			type: 'button', class: 'pl-btn pl-btn-sm', 'data-needs-net': '',
			'aria-label': `Vote for ${c.name}`, onclick: () => app.net?.sendReaction('🔥', c.id),
		}, '🔥 Vote') : null,
	])));
	list.hidden = v.contestants.length === 0;
	setInteractive(app.status === 'online' && app.joined);
}

// ── Signature wall ───────────────────────────────────────────────────────────

const wall = { data: new SignatureWallData(), loading: null, loaded: false };

function loadWall() {
	if (wall.loaded || wall.loading) return wall.loading;
	$('pl-wall-total').textContent = 'Loading signatures';
	wall.loading = wall.data.load()
		.then(() => { wall.loaded = true; renderWall(); })
		.catch((err) => {
			$('pl-wall-total').textContent = err?.message || 'Could not load the wall.';
			$('pl-wall-total').append(' ', el('button', { type: 'button', class: 'pl-link', onclick: () => loadWall() }, 'Retry'));
		})
		.finally(() => { wall.loading = null; });
	return wall.loading;
}

function renderWall() {
	const total = wall.data.total || 0;
	$('pl-wall-total').textContent = total === 0
		? 'Nobody has signed yet. Be the first name on the wall.'
		: `${total.toLocaleString()} ${total === 1 ? 'name' : 'names'} on the wall`;
	const recent = wall.data.recent.slice(0, 18);
	$('pl-wall-recent').replaceChildren(...recent.map((s) => el('li', {}, [
		el('span', { class: 'pl-wall-no', text: `#${s.no}` }),
		el('span', { class: 'pl-wall-name', text: s.name }),
		s.line ? el('span', { class: 'pl-wall-line', text: s.line }) : null,
	])));
	const mine = recallSigned();
	if (mine) {
		$('pl-wall-form').hidden = true;
		$('pl-wall-mine').hidden = false;
		$('pl-wall-mine').textContent = `You signed as ${mine.name}, number ${Number(mine.no).toLocaleString()}. It’s on the wall in 3D for everyone to see.`;
	}
}

async function signWall(e) {
	e.preventDefault();
	const name = $('pl-wall-name').value.trim().slice(0, NAME_MAX);
	const line = $('pl-wall-line').value.trim().slice(0, 80);
	const msg = $('pl-wall-msg');
	if (!name) { msg.textContent = 'Add the name you want on the wall.'; $('pl-wall-name').focus(); return; }
	const btn = $('pl-wall-submit');
	btn.disabled = true;
	btn.setAttribute('aria-busy', 'true');
	msg.textContent = '';
	try {
		const res = await wall.data.sign({ name, line, playPass: app.playPass });
		rememberSigned(res.signature);
		app.net?.sendSigwallPing();
		toast(`Signed. You’re number ${Number(res.signature.no).toLocaleString()} on the wall.`, 'ok');
		renderWall();
	} catch (err) {
		if (err instanceof WallClientError && err.existing) {
			rememberSigned(err.existing);
			renderWall();
		}
		msg.textContent = err?.retryAfter ? `${err.message} Try again in ${err.retryAfter}s.` : (err?.message || 'Could not sign the wall. Try again.');
	} finally {
		btn.disabled = false;
		btn.removeAttribute('aria-busy');
	}
}

async function onSigwallPing() {
	if (!wall.loaded) return;
	try { const fresh = await wall.data.refresh(); if (fresh.length) renderWall(); } catch { /* the next ping retries */ }
}

// ── Commemorative photo (the 2D take on photo mode) ──────────────────────────

let photoUrl = '';

function closePhoto() {
	const box = $('pl-photo');
	box.hidden = true;
	if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = ''; }
	$('pl-photo-open')?.focus();
}

async function openPhoto() {
	const W = 1200, H = 630, M = 560;
	const c = document.createElement('canvas');
	c.width = W; c.height = H;
	const ctx = c.getContext('2d');
	ctx.fillStyle = '#060607'; ctx.fillRect(0, 0, W, H);
	ctx.save();
	ctx.translate(36, 35);
	drawMap(ctx, M, { cx: 0, cz: 0, radius: MAP_RADIUS }, performance.now(), { forPhoto: true });
	ctx.restore();
	ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.strokeRect(36.5, 35.5, M, M);
	const x = 640;
	ctx.textAlign = 'left'; ctx.textBaseline = 'top';
	ctx.fillStyle = '#ffce5c'; ctx.font = '800 18px Inter, system-ui, sans-serif';
	ctx.fillText('THREE.WS / PLAY', x, 60);
	ctx.fillStyle = '#f5f5f6'; ctx.font = '800 44px Inter, system-ui, sans-serif';
	wrapText(ctx, worldTitle, x, 92, W - x - 48, 52, 2);
	ctx.fillStyle = '#8c8c92'; ctx.font = '500 20px Inter, system-ui, sans-serif';
	const when = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
	ctx.fillText(`${when} · ${app.players.size} in the world`, x, 210);
	const names = [...app.players.values()].map((p) => p.name).filter(Boolean).slice(0, 16);
	ctx.fillStyle = '#f5f5f6'; ctx.font = '600 20px Inter, system-ui, sans-serif';
	names.forEach((n, i) => ctx.fillText(n.slice(0, 22), x + (i % 2) * 260, 262 + Math.floor(i / 2) * 32));
	if (app.players.size > names.length) {
		ctx.fillStyle = '#8c8c92';
		ctx.fillText(`and ${app.players.size - names.length} more`, x, 262 + Math.ceil(names.length / 2) * 32);
	}
	const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
	if (!blob) { toast('Couldn’t make the photo on this device.', 'error'); return; }
	if (photoUrl) URL.revokeObjectURL(photoUrl);
	photoUrl = URL.createObjectURL(blob);
	$('pl-photo-img').src = photoUrl;
	const file = new File([blob], 'three-ws-play.png', { type: 'image/png' });
	const share = $('pl-photo-share');
	share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
	share.onclick = () => navigator.share({ files: [file], title: worldTitle }).catch(() => {});
	const dl = $('pl-photo-download');
	dl.href = photoUrl;
	$('pl-photo').hidden = false;
	dl.focus();
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
	const words = String(text).split(/\s+/);
	let line = '', lines = 0;
	for (const w of words) {
		const test = line ? `${line} ${w}` : w;
		if (ctx.measureText(test).width > maxW && line) {
			ctx.fillText(line, x, y + lines * lineH);
			line = w;
			if (++lines >= maxLines) return;
		} else line = test;
	}
	if (line) ctx.fillText(line, x, y + lines * lineH);
}

async function openBuy() {
	try {
		const { openBuyModal } = await import('./coin-buy.js');
		openBuyModal(coin);
	} catch {
		toast('Couldn’t open the buy panel. Check your connection and try again.', 'error');
	}
}

// ── Joining ──────────────────────────────────────────────────────────────────

function askName() {
	return new Promise((resolve) => {
		const dlg = $('pl-join');
		const input = $('pl-join-name');
		input.value = lsGet(NAME_KEY) || '';
		dlg.hidden = false;
		input.focus();
		$('pl-join-form').addEventListener('submit', (e) => {
			e.preventDefault();
			const name = input.value.trim().slice(0, NAME_MAX);
			if (name) lsSet(NAME_KEY, name);
			dlg.hidden = true;
			resolve(name || 'guest');
		}, { once: true });
	});
}

async function join() {
	const stored = (lsGet(NAME_KEY) || '').trim();
	const name = stored || await askName();
	$('pl-rename-input').value = name === 'guest' ? '' : name;
	$('pl-wall-name').value = name === 'guest' ? '' : name;
	showMapState({ title: 'Joining the plaza', body: `Connecting to ${worldTitle}.`, busy: true });

	try {
		const access = await ensurePlayAccess();
		if (access?.required) { app.playPass = access.playPass || ''; app.account = access.wallet || ''; }
	} catch {
		// The gate fails open by design (play-gate.js); the server stays the authority.
	}

	const net = new CommunityNet({ name, avatar: '', coin, tier: '', playPass: app.playPass, account: app.account });
	app.net = net;
	net.on('status', ({ status, error }) => setStatus(status, error));
	net.on('add', onAdd);
	net.on('change', onChange);
	net.on('remove', onRemove);
	net.on('chat', onChat);
	net.on('chatHistory', (lines) => chat.addHistory(lines));
	net.on('reaction', (msg) => { if (msg?.id && msg.emoji) pushFloat(msg.id, msg.emoji); });
	net.on('danceOff', onDance);
	net.on('sigwall', onSigwallPing);
	net.on('ready', (info) => {
		if (info?.name || info?.symbol) $('pl-world-name').textContent = info.name || info.symbol;
	});
	net.on('denied', () => {
		showMapState({
			title: 'This world needs a sign-in',
			body: 'Its owner gated it to wallet holders. Open it in 3D to sign in with your wallet, then come back to lite.',
			action: { label: 'Open in 3D', run: openFull },
		});
	});
	net.on('removed', ({ reason, detail }) => {
		showMapState({
			title: reason === 'banned' ? 'You can’t join this world' : 'You were removed from this world',
			body: detail || 'A moderator removed you. You can explore other worlds from three.ws/play.',
		});
	});

	// Hand the shared overlays the same surface the 3D app exposes.
	window.__CC__ = {
		lite: true,
		phase: 'world',
		coin,
		net,
		ui: { toast },
		_emote: (n) => emote(n),
		_openBuy: () => openBuy(),
		_openPhotoMode: () => openPhoto(),
	};

	await net.connect();
	updateWhere();
}

function openFull() {
	lsSet(LITE_PREF_KEY, null);
	location.href = fullUrlFrom(location.search);
}

function rename(e) {
	e.preventDefault();
	const name = $('pl-rename-input').value.trim().slice(0, NAME_MAX);
	if (!name) { $('pl-rename-input').focus(); return; }
	lsSet(NAME_KEY, name);
	app.net?.rename(name);
	toast(`You’re now ${name}.`, 'ok');
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function wire() {
	document.title = `${worldTitle} · Play lite · three.ws`;
	$('pl-world-name').textContent = worldTitle;

	map.canvas = $('pl-map');
	map.ctx = map.canvas.getContext('2d');
	resizeMap();
	new ResizeObserver(resizeMap).observe(map.canvas);
	map.canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) onMapTap(e); });
	$('pl-zoom-in').addEventListener('click', () => setZoom(app.zoom + 1));
	$('pl-zoom-out').addEventListener('click', () => setZoom(app.zoom - 1));
	setZoom(0);

	window.addEventListener('keydown', (e) => {
		if (typingInField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
		if (KEY_DIRS[e.code]) {
			// Arrow keys only steer while the map has focus, so they keep scrolling the page elsewhere.
			if (e.code.startsWith('Arrow') && document.activeElement !== map.canvas) return;
			app.keys.add(e.code);
			e.preventDefault();
		} else if (e.key === 'Escape' && !$('pl-photo').hidden) closePhoto();
		else if (e.key === 'Enter' && document.activeElement === document.body) $('pl-chat-input').focus();
	});
	window.addEventListener('keyup', (e) => app.keys.delete(e.code));
	window.addEventListener('blur', () => app.keys.clear());

	const reactions = $('pl-reactions');
	for (const r of LITE_REACTIONS) {
		reactions.append(el('button', { type: 'button', class: 'pl-chip pl-chip-emoji', 'data-needs-net': '', 'aria-label': `React ${r}`, onclick: () => react(r) }, r));
	}
	const emotes = $('pl-emotes');
	for (const em of LITE_EMOTES) {
		emotes.append(el('button', { type: 'button', class: 'pl-chip', 'data-needs-net': '', onclick: () => emote(em.name) }, [
			el('span', { 'aria-hidden': 'true', text: em.icon }), el('span', { text: em.label }),
		]));
	}

	chat = new ChatLogView({ log: $('pl-chat-log'), empty: $('pl-chat-empty'), announce });
	$('pl-chat-form').addEventListener('submit', sendChat);
	$('pl-chat-empty-say').addEventListener('click', () => $('pl-chat-input').focus());

	document.querySelectorAll('.pl-tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
	$('pl-tabs').addEventListener('keydown', onTabKey);
	selectTab('chat');

	renderPlaces();
	$('pl-rename').addEventListener('submit', rename);
	$('pl-copy-link').addEventListener('click', async () => {
		const url = `${location.origin}/play/lite${location.search}`;
		try { await navigator.clipboard.writeText(url); toast('Link copied. Send it to a friend.', 'ok'); }
		catch { toast(url, 'info'); }
	});
	$('pl-wall-form').addEventListener('submit', signWall);
	$('pl-photo-open').addEventListener('click', openPhoto);
	$('pl-photo-close').addEventListener('click', closePhoto);
	$('pl-photo').addEventListener('click', (e) => { if (e.target === $('pl-photo')) closePhoto(); });
	$('pl-retry').addEventListener('click', () => app.net?.retry());
	$('pl-open-3d').addEventListener('click', openFull);

	const pref = $('pl-pref');
	pref.checked = lsGet(LITE_PREF_KEY) === '1';
	pref.addEventListener('change', () => {
		lsSet(LITE_PREF_KEY, pref.checked ? '1' : null);
		toast(pref.checked ? 'This device will open the lite world from three.ws/play.' : 'three.ws/play will open in 3D again.', 'ok');
	});

	const webgl = canUseWebGL(() => document.createElement('canvas'));
	if (!webgl) $('pl-open-3d').textContent = 'Try 3D anyway';
	if (!ssGet(NOTICE_KEY)) {
		const n = $('pl-notice');
		n.querySelector('.pl-notice-text').textContent = webgl
			? 'You’re in lite mode: the same live world and the same people, drawn as a map so it runs on any device.'
			: 'This browser can’t draw the 3D world, so you’re in lite mode: the same live world and the same people, drawn as a map.';
		n.hidden = false;
		n.querySelector('button').addEventListener('click', () => { n.hidden = true; ssSet(NOTICE_KEY, '1'); });
	}

	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			// Stop walking rather than freeze mid-stride for everyone watching.
			app.target = null; app.keys.clear();
			app.net?.sendMove({ x: app.pos.x, y: 0, z: app.pos.z, yaw: app.pos.yaw, motion: 'idle' });
		} else app.net?.resume();
	});
	window.addEventListener('online', () => app.net?.resume());

	setInterval(() => { if (app.dance.state) renderDance(); }, 1000);
	setStatus('connecting');
	requestAnimationFrame(frame);
}

wire();
join().catch((err) => {
	showMapState({
		title: 'Couldn’t open the world',
		body: 'Something stopped the lite world from starting. Reload to try again.',
		detail: err?.message || '',
		action: { label: 'Reload', run: () => location.reload() },
	});
});

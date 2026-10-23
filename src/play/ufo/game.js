// Flappin UFO (/play/ufo): the canvas client.
//
// All physics lives in sim.js, which the server replays to verify every
// submitted run. This file owns what the simulation does not: the fixed-step
// loop, input capture (pointer, touch, keyboard), drawing, the ghost of the
// top run, and the leaderboard panel.
//
// Input is recorded as the ticks at which the thrust button flipped. That list
// per level is the entire replay, and it is exactly what gets submitted.

import {
	DT,
	MIN_EDGE_GAP,
	PILLAR_W,
	SHIP_R,
	SHIP_X,
	WORLD_H,
	createLevelState,
	pillarCount,
	pillarX,
	step,
	upAt,
} from './sim.js';
import './ufo.css';

const STEP_MS = DT * 1000;
const MAX_STEPS_PER_FRAME = 5;
const MIN_VISIBLE_WIDTH = 520;
const SHIP_SCREEN_X = 0.25;
const CRASH_PANEL_DELAY_MS = 1100;
const CLEAR_BANNER_MS = 1700;
const NAME_KEY = 'three-ws-ufo-name';
const BEST_KEY = 'three-ws-ufo-best';
const API = '/api/play/ufo-runs';

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function store(op, key, value) {
	try {
		if (op === 'get') return localStorage.getItem(key);
		localStorage.setItem(key, value);
	} catch {
		return null;
	}
	return null;
}

const canvas = $('ufo-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const el = {
	score: $('hud-score'),
	level: $('hud-level'),
	best: $('hud-best'),
	hint: $('hint'),
	banner: $('banner'),
	live: $('live'),
	title: $('panel-title'),
	over: $('panel-over'),
	overScore: $('over-score'),
	overLevel: $('over-level'),
	overNote: $('over-note'),
	form: $('submit-form'),
	name: $('submit-name'),
	submit: $('submit-btn'),
	status: $('submit-status'),
	again: $('again-btn'),
	play: $('play-btn'),
	boardTitle: $('board-title'),
	boardOver: $('board-over'),
};

// ── run state ───────────────────────────────────────────────────────────────

const game = {
	phase: 'title', // title | ready | playing | crashed | cleared | over
	level: 1,
	sim: createLevelState(1),
	runLevels: [],
	edges: [],
	curUp: false,
	lastEdge: -Infinity,
	inputDown: false,
	score: 0,
	best: Number(store('get', BEST_KEY)) || 0,
	acc: 0,
	prevY: WORLD_H / 2,
	displayY: WORLD_H / 2,
	phaseAt: 0,
	particles: [],
	shake: 0,
	submitted: false,
};

const ghost = { run: null, state: null };
let board = { rows: [], loading: true, error: false };

// ── layout ──────────────────────────────────────────────────────────────────

const view = { w: 0, h: 0, dpr: 1, scale: 1, ox: 0, oy: 0 };

function resize() {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	view.w = window.innerWidth;
	view.h = window.innerHeight;
	view.dpr = dpr;
	canvas.width = Math.round(view.w * dpr);
	canvas.height = Math.round(view.h * dpr);
	view.scale = Math.min(view.h / WORLD_H, view.w / MIN_VISIBLE_WIDTH);
	view.ox = view.w * SHIP_SCREEN_X - SHIP_X * view.scale;
	view.oy = (view.h - WORLD_H * view.scale) / 2;
}

const sx = (wx) => view.ox + wx * view.scale;
const sy = (wy) => view.oy + wy * view.scale;

// ── stars ───────────────────────────────────────────────────────────────────

const stars = Array.from({ length: 70 }, (_, i) => {
	const r = (n) => {
		const x = Math.sin(i * 127.1 + n * 311.7) * 43758.5453;
		return x - Math.floor(x);
	};
	return { x: r(1), y: r(2), z: 0.15 + r(3) * 0.5, s: 0.6 + r(4) * 1.6, tw: r(5) * 6.28 };
});

// ── input ───────────────────────────────────────────────────────────────────

const downKeys = new Set();
const downPointers = new Set();
const THRUST_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);

function syncInput() {
	const next = downKeys.size > 0 || downPointers.size > 0;
	if (next === game.inputDown) return;
	game.inputDown = next;
	if (next) onPress();
}

function onPress() {
	if (game.phase === 'ready') startPlaying();
}

function interactive(target) {
	return target instanceof Element && target.closest('button, a, input, form, [data-no-fly]');
}

canvas.addEventListener('pointerdown', (e) => {
	if (e.button > 0) return;
	e.preventDefault();
	canvas.setPointerCapture?.(e.pointerId);
	downPointers.add(e.pointerId);
	syncInput();
});
const releasePointer = (e) => {
	if (downPointers.delete(e.pointerId)) syncInput();
};
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', releasePointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
	if (!THRUST_KEYS.has(e.code) || interactive(e.target)) return;
	e.preventDefault();
	if (e.repeat) return;
	downKeys.add(e.code);
	syncInput();
});
window.addEventListener('keyup', (e) => {
	if (downKeys.delete(e.code)) syncInput();
});
window.addEventListener('blur', () => {
	downKeys.clear();
	downPointers.clear();
	syncInput();
});
document.addEventListener('visibilitychange', () => {
	if (document.hidden) {
		downKeys.clear();
		downPointers.clear();
		syncInput();
	}
	game.acc = 0;
	lastFrame = 0;
});

// ── phases ──────────────────────────────────────────────────────────────────

function announce(text) {
	el.live.textContent = text;
}

function showPanel(which) {
	el.title.hidden = which !== 'title';
	el.over.hidden = which !== 'over';
}

function setHud() {
	el.score.textContent = String(game.score);
	el.level.textContent = String(game.level);
	el.best.textContent = String(game.best);
}

function setBanner(text) {
	el.banner.textContent = text || '';
	el.banner.classList.toggle('show', !!text);
}

function prepareLevel(level) {
	game.level = level;
	game.sim = createLevelState(level);
	game.edges = [];
	game.curUp = false;
	game.lastEdge = -Infinity;
	game.acc = 0;
	game.prevY = game.sim.y;
	game.phase = 'ready';
	game.phaseAt = performance.now();
	ghost.state = ghostLevelState(level);
	el.hint.hidden = false;
	setBanner('');
	setHud();
}

function ghostLevelState(level) {
	const levels = ghost.run?.levels;
	if (!levels?.[level - 1]) return null;
	return { state: createLevelState(level), edges: levels[level - 1].edges, gone: 0 };
}

function newRun() {
	game.runLevels = [];
	game.score = 0;
	game.submitted = false;
	game.particles = [];
	showPanel(null);
	prepareLevel(1);
	announce('Ready. Hold to fly.');
}

function startPlaying() {
	game.phase = 'playing';
	game.phaseAt = performance.now();
	el.hint.hidden = true;
}

function onCleared() {
	game.runLevels.push({ edges: game.edges });
	game.phase = 'cleared';
	game.phaseAt = performance.now();
	setBanner(`Level ${game.level} cleared`);
	announce(`Level ${game.level} cleared. Score ${game.score}.`);
}

function onCrashed() {
	game.runLevels.push({ edges: game.edges });
	game.phase = 'crashed';
	game.phaseAt = performance.now();
	game.shake = reducedMotion ? 0 : 1;
	const hue = ['#ffd166', '#ff7b54', '#a78bff', '#6ee7ff'];
	for (let i = 0; i < 38; i++) {
		const a = (i / 38) * Math.PI * 2 + i;
		const v = 80 + ((i * 53) % 220);
		game.particles.push({
			x: SHIP_X,
			y: game.sim.y,
			vx: Math.cos(a) * v,
			vy: Math.sin(a) * v - 40,
			life: 1,
			c: hue[i % hue.length],
			r: 1.5 + (i % 4),
		});
	}
	if (game.score > game.best) {
		game.best = game.score;
		store('set', BEST_KEY, String(game.best));
	}
	setHud();
	announce(`Crashed on level ${game.level}. Score ${game.score}.`);
}

function showGameOver() {
	game.phase = 'over';
	el.overScore.textContent = String(game.score);
	el.overLevel.textContent = String(game.level);
	el.overNote.textContent =
		game.score === 0
			? 'Pass a pillar to post a score.'
			: game.score >= game.best
				? 'New personal best.'
				: `Personal best ${game.best}.`;
	el.name.value = store('get', NAME_KEY) || '';
	el.submit.disabled = game.score === 0;
	el.submit.textContent = 'Post score';
	el.status.textContent = '';
	el.status.dataset.tone = '';
	el.form.hidden = false;
	showPanel('over');
	renderBoard();
	el.again.focus({ preventScroll: true });
}

// ── tick ────────────────────────────────────────────────────────────────────

function tickOnce() {
	const s = game.sim;
	if (game.inputDown !== game.curUp && s.tick - game.lastEdge >= MIN_EDGE_GAP) {
		game.curUp = game.inputDown;
		game.edges.push(s.tick);
		game.lastEdge = s.tick;
	}
	game.prevY = s.y;
	const before = s.passed;
	step(s, game.curUp);
	if (s.passed !== before) {
		game.score += s.passed - before;
		setHud();
	}
	if (ghost.state && ghost.state.state.status === 'playing') {
		step(ghost.state.state, upAt(ghost.state.edges, ghost.state.state.tick));
		if (ghost.state.state.status !== 'playing') ghost.state.gone = performance.now();
	}
	if (s.status === 'crashed') onCrashed();
	else if (s.status === 'cleared') onCleared();
}

let lastFrame = 0;

function frame(now) {
	requestAnimationFrame(frame);
	const dtMs = lastFrame ? Math.min(now - lastFrame, 100) : 0;
	lastFrame = now;

	if (game.phase === 'playing') {
		game.acc += dtMs;
		let steps = 0;
		while (game.acc >= STEP_MS && game.phase === 'playing' && steps < MAX_STEPS_PER_FRAME) {
			tickOnce();
			game.acc -= STEP_MS;
			steps++;
		}
		if (steps === MAX_STEPS_PER_FRAME) game.acc = 0;
	} else if (game.phase === 'ready' && game.inputDown && now - game.phaseAt > 250) {
		startPlaying();
	} else if (game.phase === 'cleared' && now - game.phaseAt > CLEAR_BANNER_MS) {
		prepareLevel(game.level + 1);
		announce(`Level ${game.level}. Hold to fly.`);
	} else if (game.phase === 'crashed' && now - game.phaseAt > CRASH_PANEL_DELAY_MS) {
		showGameOver();
	}

	updateParticles(dtMs / 1000);
	draw(now);
}

function updateParticles(dt) {
	for (const p of game.particles) {
		p.x += p.vx * dt;
		p.y += p.vy * dt;
		p.vy += 500 * dt;
		p.life -= dt * 0.9;
	}
	game.particles = game.particles.filter((p) => p.life > 0);
	game.shake = Math.max(0, game.shake - dt * 3);
}

// ── drawing ─────────────────────────────────────────────────────────────────

function drawBackground(now, scrollTicks) {
	const g = ctx.createLinearGradient(0, 0, 0, view.h);
	g.addColorStop(0, '#05060f');
	g.addColorStop(0.55, '#0c0f24');
	g.addColorStop(1, '#1a1238');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, view.w, view.h);

	const drift = scrollTicks * DT * 60;
	for (const st of stars) {
		const x = (((st.x * view.w - drift * st.z * view.scale) % view.w) + view.w) % view.w;
		const y = st.y * view.h;
		const a = 0.35 + 0.35 * Math.sin(now / 900 + st.tw);
		ctx.globalAlpha = a * (0.4 + st.z);
		ctx.fillStyle = '#dfe6ff';
		ctx.fillRect(x, y, st.s, st.s);
	}
	ctx.globalAlpha = 1;
}

function drawBounds() {
	const top = sy(0);
	const bottom = sy(WORLD_H);
	ctx.fillStyle = 'rgba(255, 90, 110, 0.10)';
	if (top > 0) ctx.fillRect(0, 0, view.w, top);
	if (bottom < view.h) ctx.fillRect(0, bottom, view.w, view.h - bottom);
	ctx.strokeStyle = 'rgba(255, 110, 130, 0.55)';
	ctx.lineWidth = 2;
	ctx.setLineDash([10, 8]);
	ctx.beginPath();
	ctx.moveTo(0, top);
	ctx.lineTo(view.w, top);
	ctx.moveTo(0, bottom);
	ctx.lineTo(view.w, bottom);
	ctx.stroke();
	ctx.setLineDash([]);
}

function rockPath(x, w, yEdge, dir, seed) {
	// dir -1: rock hangs from the top edge; +1: rises from the bottom. The tips
	// touch the collision edge exactly and the valleys recede into the rock, so a
	// visible hit is always a real hit.
	const farY = dir < 0 ? sy(0) - 400 : sy(WORLD_H) + 400;
	ctx.beginPath();
	ctx.moveTo(x, farY);
	ctx.lineTo(x, yEdge);
	const teeth = 6;
	for (let i = 1; i <= teeth; i++) {
		const jag = (((Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1) + 1) % 1;
		const depth = i % 2 === 1 ? (4 + jag * 9) * view.scale : 0;
		ctx.lineTo(x + (w * i) / teeth, yEdge + dir * depth);
	}
	ctx.lineTo(x + w, farY);
	ctx.closePath();
}

function drawPillar(course, i, tick) {
	const p = course.pillars[i];
	const wx = pillarX(course, i, tick);
	const x = sx(wx);
	const w = PILLAR_W * view.scale;
	if (x + w < -20 || x > view.w + 20) return;
	const g = ctx.createLinearGradient(x, 0, x + w, 0);
	g.addColorStop(0, '#3a2f5c');
	g.addColorStop(0.5, '#5b4a8a');
	g.addColorStop(1, '#2b2246');
	ctx.fillStyle = g;
	ctx.strokeStyle = 'rgba(167, 139, 255, 0.55)';
	ctx.lineWidth = 1.5;
	rockPath(x, w, sy(p.top), -1, i + course.level * 31);
	ctx.fill();
	ctx.stroke();
	rockPath(x, w, sy(p.bottom), 1, i + course.level * 17);
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = 'rgba(8, 6, 20, 0.35)';
	for (let k = 0; k < 3; k++) {
		const cy = k * 70 + 14;
		ctx.beginPath();
		ctx.ellipse(x + w * (0.3 + 0.35 * ((k + i) % 2)), sy(p.top) - cy * view.scale - 18 * view.scale, 6 * view.scale, 4 * view.scale, 0, 0, 6.283);
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse(x + w * (0.65 - 0.3 * ((k + i) % 2)), sy(p.bottom) + cy * view.scale + 18 * view.scale, 6 * view.scale, 4 * view.scale, 0, 0, 6.283);
		ctx.fill();
	}
}

function drawUfo(wy, vy, up, now, { alpha = 1, tint = null, label = null } = {}) {
	const x = sx(SHIP_X);
	const y = sy(wy);
	const k = view.scale;
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.translate(x, y);
	ctx.rotate(Math.max(-0.35, Math.min(0.35, vy / 1200)));
	if (up) {
		const f = ctx.createLinearGradient(0, 8 * k, 0, 40 * k);
		f.addColorStop(0, 'rgba(255, 220, 120, 0.95)');
		f.addColorStop(1, 'rgba(255, 110, 60, 0)');
		ctx.fillStyle = f;
		ctx.beginPath();
		ctx.moveTo(-9 * k, 8 * k);
		ctx.lineTo(9 * k, 8 * k);
		ctx.lineTo(0, (30 + 10 * Math.sin(now / 40)) * k);
		ctx.closePath();
		ctx.fill();
	}
	const body = ctx.createLinearGradient(0, -8 * k, 0, 12 * k);
	body.addColorStop(0, tint ? '#9fe9ff' : '#d9dfef');
	body.addColorStop(1, tint ? '#2a8fb0' : '#6b7596');
	ctx.fillStyle = body;
	ctx.beginPath();
	ctx.ellipse(0, 2 * k, 26 * k, 9 * k, 0, 0, 6.283);
	ctx.fill();
	const dome = ctx.createRadialGradient(-3 * k, -9 * k, 1, 0, -6 * k, 13 * k);
	dome.addColorStop(0, 'rgba(190, 255, 220, 0.95)');
	dome.addColorStop(1, 'rgba(60, 200, 150, 0.55)');
	ctx.fillStyle = dome;
	ctx.beginPath();
	ctx.ellipse(0, -3 * k, 12 * k, 11 * k, 0, Math.PI, 0);
	ctx.fill();
	for (let i = -2; i <= 2; i++) {
		ctx.fillStyle = (Math.floor(now / 160) + i) % 2 ? '#ffd166' : '#a78bff';
		ctx.beginPath();
		ctx.arc(i * 8 * k, 3 * k, 1.8 * k, 0, 6.283);
		ctx.fill();
	}
	ctx.restore();
	if (label) {
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.font = `600 ${Math.max(10, 11 * k)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
		ctx.textAlign = 'center';
		ctx.fillStyle = '#9fe9ff';
		ctx.fillText(label, x, y - 24 * k);
		ctx.restore();
	}
}

function draw(now) {
	const s = game.sim;
	const alpha = game.phase === 'playing' ? game.acc / STEP_MS : 0;
	const tickF = s.tick + alpha;

	ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
	if (game.shake > 0) {
		ctx.translate((Math.random() - 0.5) * 12 * game.shake, (Math.random() - 0.5) * 12 * game.shake);
	}
	drawBackground(now, tickF);
	drawBounds();

	const course = s.course;
	for (let i = 0; i < course.pillars.length; i++) drawPillar(course, i, tickF);

	if (ghost.state) {
		const g = ghost.state;
		const live = g.state.status === 'playing';
		const fade = live ? 1 : Math.max(0, 1 - (now - g.gone) / 700);
		if (fade > 0 && (game.phase === 'playing' || game.phase === 'ready')) {
			drawUfo(g.state.y, g.state.vy, live && upAt(g.edges, g.state.tick), now, {
				alpha: 0.38 * fade,
				tint: true,
				label: live ? `ghost: ${ghost.run.name}` : null,
			});
		}
	}

	let shipY;
	if (game.phase === 'ready') {
		const target = WORLD_H / 2 + (reducedMotion ? 0 : Math.sin(now / 420) * 8);
		game.displayY += (target - game.displayY) * 0.18;
		shipY = game.displayY;
	} else {
		shipY = game.prevY + (s.y - game.prevY) * alpha;
		game.displayY = shipY;
	}
	if (game.phase !== 'crashed' && game.phase !== 'over') {
		drawUfo(shipY, game.phase === 'playing' ? s.vy : 0, game.phase === 'playing' && game.curUp, now);
	}

	for (const p of game.particles) {
		ctx.globalAlpha = Math.max(0, p.life);
		ctx.fillStyle = p.c;
		ctx.beginPath();
		ctx.arc(sx(p.x), sy(p.y), p.r * view.scale, 0, 6.283);
		ctx.fill();
	}
	ctx.globalAlpha = 1;
}

// ── leaderboard ─────────────────────────────────────────────────────────────

function renderBoard() {
	for (const list of [el.boardTitle, el.boardOver]) {
		list.replaceChildren();
		if (board.loading) {
			for (let i = 0; i < 4; i++) {
				const li = document.createElement('li');
				li.className = 'skeleton';
				list.append(li);
			}
			continue;
		}
		if (board.error) {
			const li = document.createElement('li');
			li.className = 'note';
			li.append('Leaderboard unavailable. ');
			const retry = document.createElement('button');
			retry.type = 'button';
			retry.className = 'link';
			retry.textContent = 'Retry';
			retry.addEventListener('click', loadBoard);
			li.append(retry);
			list.append(li);
			continue;
		}
		if (!board.rows.length) {
			const li = document.createElement('li');
			li.className = 'note';
			li.textContent = 'No scores yet. Post the first one.';
			list.append(li);
			continue;
		}
		for (const row of board.rows.slice(0, 10)) {
			const li = document.createElement('li');
			const rank = document.createElement('span');
			rank.className = 'rank';
			rank.textContent = String(row.rank);
			const name = document.createElement('span');
			name.className = 'who';
			name.textContent = row.name;
			const lvl = document.createElement('span');
			lvl.className = 'lvl';
			lvl.textContent = `L${row.level}`;
			const score = document.createElement('span');
			score.className = 'pts';
			score.textContent = String(row.score);
			li.append(rank, name, lvl, score);
			list.append(li);
		}
	}
}

async function loadBoard() {
	board = { ...board, loading: true, error: false };
	renderBoard();
	try {
		const res = await fetch(`${API}?ghost=1&limit=10`, { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(String(res.status));
		const data = await res.json();
		board = { rows: data.rows || [], loading: false, error: false };
		ghost.run = data.ghost || null;
		if (game.phase === 'ready') ghost.state = ghostLevelState(game.level);
	} catch {
		board = { rows: [], loading: false, error: true };
	}
	renderBoard();
}

async function submitRun(e) {
	e.preventDefault();
	if (game.submitted || game.score === 0) return;
	const name = el.name.value.trim();
	el.submit.disabled = true;
	el.submit.textContent = 'Posting...';
	el.status.dataset.tone = '';
	el.status.textContent = '';
	try {
		const res = await fetch(API, {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ name, levels: game.runLevels }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const messages = {
				400: data.error_description || 'Enter a name to post your score.',
				409: 'This run is already on the board.',
				422: 'That run could not be verified, so it was not posted.',
				429: 'Too many submissions. Try again in a few minutes.',
			};
			throw new Error(messages[res.status] || 'The server could not take your score. Try again.');
		}
		if (name) store('set', NAME_KEY, name);
		game.submitted = true;
		el.form.hidden = true;
		el.overNote.textContent = `Posted as ${data.name}: rank ${data.rank}${data.isPersonalBest ? ', personal best' : ''}.`;
		announce(`Score posted. Rank ${data.rank}.`);
		loadBoard();
	} catch (err) {
		el.status.dataset.tone = 'error';
		el.status.textContent = err instanceof TypeError ? 'Network error. Check your connection and try again.' : err.message;
		el.submit.disabled = false;
		el.submit.textContent = 'Retry';
	}
}

// ── boot ────────────────────────────────────────────────────────────────────

el.form.addEventListener('submit', submitRun);
el.again.addEventListener('click', newRun);
el.play.addEventListener('click', newRun);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

resize();
setHud();
renderBoard();
loadBoard();
requestAnimationFrame(frame);
el.play.focus({ preventScroll: true });

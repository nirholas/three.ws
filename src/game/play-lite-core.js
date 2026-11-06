// Pure logic for /play/lite, the 2D way into a /play world for devices that can't
// run the 3D scene (no WebGL, a blocklisted GPU, a very old phone, a locked-down
// work laptop) or people who would rather not. No DOM rendering and no three.js,
// so every decision here is unit-tested in node (tests/play-lite-core.test.js).
//
// A lite player is a real player in the same walk_world room as everyone in 3D:
// they appear on the plaza as the guest avatar, walk when they tap the map, chat,
// react, emote, vote in the dance-off and sign the wall. Positions and landmarks
// come from the same modules the server and the 3D scene read, never hand-copied,
// so the map and the world cannot drift apart.

import {
	WHEEL, GACHA, WAR_PORTAL, PLAZA_STAGE, FISHING_SPOTS, DANGER_ZONES, WORLD_RADIUS,
} from '../../multiplayer/src/world-features.js';
import { DANCE_FLOOR } from '../../multiplayer/src/dance-off.js';
import { SIGNATURE_WALL } from './signature-wall-layout.js';

export const LITE_PATH = '/play/lite';
export const FULL_PATH = '/play';
/** localStorage key: the player chose lite on purpose, so /play sends them back. */
export const LITE_PREF_KEY = 'cc-lite-pref';
/** The world a bare /play/lite link opens: the $THREE community, the platform's home world. */
export const HOME_COIN = Object.freeze({
	mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
	name: 'three.ws',
	symbol: 'three',
});

// Query keys that only steer which client opens; never forwarded across the switch.
const SWITCH_KEYS = ['lite', 'full'];

function cleanSearch(search) {
	const q = new URLSearchParams(search || '');
	for (const k of SWITCH_KEYS) q.delete(k);
	const s = q.toString();
	return s ? `?${s}` : '';
}

/** The lite URL for the world a /play query names (coin, name, symbol, image survive). */
export function liteUrlFrom(search) { return LITE_PATH + cleanSearch(search); }

/** The 3D URL for the world a /play/lite query names. `full=1` tells /play not to bounce back. */
export function fullUrlFrom(search) {
	const q = new URLSearchParams(cleanSearch(search));
	q.set('full', '1');
	return `${FULL_PATH}?${q.toString()}`;
}

/**
 * Should a /play visit open the lite client instead? Pure: the caller supplies the
 * query, the stored preference, and whether a WebGL context could be created.
 * `?full=1` always wins (the "Open in 3D" button), and `?director=1` (the venue
 * projector camera) is never redirected. Then `?lite=1`, then a missing GPU,
 * then the remembered choice. pages/play.html inlines this same rule.
 * @returns {null | 'asked' | 'no-webgl' | 'preference'}
 */
export function liteReason({ search = '', pref = null, webgl = true } = {}) {
	const q = new URLSearchParams(search);
	if (q.get('full') === '1' || q.get('director') === '1') return null;
	if (q.get('lite') === '1') return 'asked';
	if (!webgl) return 'no-webgl';
	if (pref === '1') return 'preference';
	return null;
}

/**
 * Whether this browser can create any WebGL context. `makeCanvas` is injected so
 * the probe runs in node tests; in a page it is `() => document.createElement('canvas')`.
 */
export function canUseWebGL(makeCanvas) {
	try {
		const c = makeCanvas();
		const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
		if (!gl) return false;
		// Release the probe context so it never counts against the page's GPU budget.
		gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
		return true;
	} catch {
		return false;
	}
}

/** The coin world a lite query names, defaulting to the $THREE home world. */
export function coinFromSearch(search) {
	const q = new URLSearchParams(search || '');
	const mint = (q.get('coin') || '').trim();
	if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return { ...HOME_COIN, image: '' };
	return {
		mint,
		name: (q.get('name') || '').slice(0, 48),
		symbol: (q.get('symbol') || '').slice(0, 16),
		image: (q.get('image') || '').slice(0, 600),
	};
}

// ── The map ─────────────────────────────────────────────────────────────────
// Top-down, north up, matching the 3D HUD minimap at yaw 0 (src/game/hud/minimap.js):
// world +x is screen right, world +z is screen down.

/** How far from the plaza centre a lite player may walk. Inside the server's world disc. */
export const WALK_RADIUS = WORLD_RADIUS - 6;
/** Metres the map shows from centre to edge. */
export const MAP_RADIUS = WORLD_RADIUS;

/** Every place on the plaza worth walking to, read from the modules that place it. */
export const LITE_PLACES = Object.freeze([
	{ id: 'totem', label: 'Totem', hint: 'Group photo spot', x: 0, z: -12, r: 2, kind: 'poi', go: true },
	{ id: 'dance', label: 'Dance floor', hint: 'Stand here to enter a dance-off', x: DANCE_FLOOR.x, z: DANCE_FLOOR.z, r: DANCE_FLOOR.r, kind: 'dance', go: true },
	{ id: 'stage', label: 'Plaza stage', hint: 'Shows and talks', x: PLAZA_STAGE.x, z: PLAZA_STAGE.z, r: PLAZA_STAGE.r, kind: 'poi', go: true },
	{ id: 'wall', label: 'Signature wall', hint: 'Sign it from the panel', x: SIGNATURE_WALL.x, z: SIGNATURE_WALL.z, r: 2.5, kind: 'poi', go: true },
	{ id: 'wheel', label: 'Wheel', hint: 'Fortune’s Folly', x: WHEEL[0].x, z: WHEEL[0].z, r: WHEEL[0].r, kind: 'poi', go: false },
	{ id: 'portal', label: 'War portal', hint: 'Coin Wars', x: WAR_PORTAL.x, z: WAR_PORTAL.z, r: WAR_PORTAL.r, kind: 'poi', go: false },
	{ id: 'gacha', label: 'Gacha', hint: 'Card machine', x: GACHA[0].x, z: GACHA[0].z, r: 1.2, kind: 'poi', go: false },
	{ id: 'chart', label: 'Chart screen', hint: 'Live price chart', x: 0, z: -30, r: 2.5, kind: 'poi', go: false },
]);

export const LITE_WATER = Object.freeze(FISHING_SPOTS.map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.r })));
export const LITE_DANGER = Object.freeze(DANGER_ZONES.map((d) => ({ id: d.id, label: d.name, x: d.x, z: d.z, r: d.r })));

/** Map a world point to canvas pixels for a square map of `size` px. */
export function worldToMap(x, z, size, radius = MAP_RADIUS) {
	const s = size / (2 * radius);
	return { px: size / 2 + x * s, py: size / 2 + z * s };
}

/** Map canvas pixels back to a world point. */
export function mapToWorld(px, py, size, radius = MAP_RADIUS) {
	const s = (2 * radius) / size;
	return { x: (px - size / 2) * s, z: (py - size / 2) * s };
}

function pushOutOf(pt, circle, margin) {
	const dx = pt.x - circle.x, dz = pt.z - circle.z;
	const d = Math.hypot(dx, dz);
	const min = circle.r + margin;
	if (d >= min) return pt;
	// Dead centre has no direction; step out toward the plaza centre.
	const ux = d > 1e-6 ? dx / d : -circle.x / (Math.hypot(circle.x, circle.z) || 1);
	const uz = d > 1e-6 ? dz / d : -circle.z / (Math.hypot(circle.x, circle.z) || 1);
	return { x: circle.x + ux * min, z: circle.z + uz * min };
}

/**
 * Turn a tap into a place a lite avatar can stand: inside the walkable disc, on a
 * pond's bank rather than in the water, and outside the PvP danger pockets (a lite
 * player has no way to fight back, so they never stroll into one).
 */
export function safeTarget(x, z) {
	let pt = { x: Number(x) || 0, z: Number(z) || 0 };
	for (const w of LITE_WATER) pt = pushOutOf(pt, w, 0.8);
	for (const d of LITE_DANGER) pt = pushOutOf(pt, d, 1.5);
	const d = Math.hypot(pt.x, pt.z);
	if (d > WALK_RADIUS) pt = { x: (pt.x / d) * WALK_RADIUS, z: (pt.z / d) * WALK_RADIUS };
	return pt;
}

/** Walking speed, metres per second. Close to the 3D walk so peers see a natural stride. */
export const WALK_SPEED = 3.6;
/** Never move further than this in one tick: under the server's 1.2 m anti-teleport step. */
export const MAX_TICK_STEP = 0.9;

/**
 * Advance one tick from `pos` toward `target`. Returns the new position, the yaw
 * the 3D avatar should face (same atan2(dx, dz) convention as coincommunities.js),
 * and whether the target was reached.
 */
export function stepToward(pos, target, dt, speed = WALK_SPEED) {
	const dx = target.x - pos.x, dz = target.z - pos.z;
	const d = Math.hypot(dx, dz);
	const yaw = d > 1e-4 ? Math.atan2(dx, dz) : pos.yaw || 0;
	const step = Math.min(Math.max(0, dt) * speed, MAX_TICK_STEP);
	if (d <= step || d < 0.05) return { x: target.x, z: target.z, yaw, arrived: true };
	return { x: pos.x + (dx / d) * step, z: pos.z + (dz / d) * step, yaw, arrived: false };
}

/** The place the point is standing at, if any (used for "You're at the dance floor"). */
export function placeAt(x, z) {
	for (const p of LITE_PLACES) if (Math.hypot(x - p.x, z - p.z) <= Math.max(p.r, 2) + 1.5) return p;
	return null;
}

/** A standing spot for a place: just in front of it, toward spawn, so avatars don't stand inside props. */
export function approachPoint(place) {
	if (place.id === 'dance') return { x: place.x, z: place.z }; // must stand ON the floor to enter
	const d = Math.hypot(place.x, place.z) || 1;
	const off = place.r + 1.6;
	return safeTarget(place.x - (place.x / d) * off, place.z - (place.z / d) * off);
}

// ── Social vocabulary (mirrors the server allowlists) ─────────────────────────

/** WalkRoom._handleReaction accepts exactly these. */
export const LITE_REACTIONS = Object.freeze(['🎉', '😂', '🔥', '❤️', '👏', '🤔']);

/** Emotes every 3D client already has clips for (coincommunities-ui.js emote wheel). */
export const LITE_EMOTES = Object.freeze([
	{ name: 'wave', label: 'Wave', icon: '👋' },
	{ name: 'av-cheering', label: 'Cheer', icon: '🙌' },
	{ name: 'dance', label: 'Dance', icon: '💃' },
	{ name: 'celebrate', label: 'Celebrate', icon: '🥳' },
	{ name: 'av-back-flip', label: 'Backflip', icon: '🤸' },
	{ name: 'pray', label: 'Thanks', icon: '🙏' },
]);

// ── Dance-off ──────────────────────────────────────────────────────────────

/** True when (x, z) is on the dance pad: the server's own rule (dance-off.js onFloor). */
export function onDanceFloor(x, z) {
	return Math.hypot(x - DANCE_FLOOR.x, z - DANCE_FLOOR.z) <= DANCE_FLOOR.r;
}

/**
 * What the dance-off card should say, from the server's `dance:state` snapshot
 * (multiplayer/src/dance-off.js snapshot(): phase idle | joining | performing |
 * tally | winner). Contestants are only picked when the join window closes, so
 * during `joining` the caller says whether this player is standing on the pad.
 * `votedRound` is the round this player already voted in.
 */
export function danceView(state, { selfId = '', onFloor = false, votedRound = 0, now = Date.now() } = {}) {
	if (!state || !state.phase) return { visible: false };
	const skew = Number(state.now) ? now - Number(state.now) : 0; // local minus server clock
	const secs = (t) => Math.max(0, Math.ceil(((Number(t) || 0) + skew - now) / 1000));
	const mark = (list) => (list || []).map((c) => ({ id: c.id, name: c.name, votes: Number(c.votes) || 0, self: c.id === selfId }));
	switch (state.phase) {
		case 'joining':
			return {
				visible: true, phase: 'joining', title: 'Dance-off starting',
				detail: onFloor
					? `You're on the floor. The round starts in ${secs(state.endsAt)}s, stay put.`
					: `Walk onto the dance floor in the next ${secs(state.endsAt)}s to compete.`,
				contestants: [], canVote: false, canEnter: !onFloor,
			};
		case 'performing': {
			const contestants = mark(state.contestants);
			const dancing = contestants.some((c) => c.self);
			const voted = !!votedRound && votedRound === state.roundId;
			let detail = `Vote for your favourite. ${secs(state.endsAt)}s left.`;
			if (dancing) detail = `You're dancing. ${secs(state.endsAt)}s left, the crowd is voting.`;
			else if (voted) detail = 'Vote counted. Keep the reactions coming.';
			return { visible: true, phase: 'performing', title: 'Dance-off live', detail, contestants, canVote: !voted && !dancing, canEnter: false };
		}
		case 'tally':
			return { visible: true, phase: 'tally', title: 'Counting votes', detail: 'Votes are frozen.', contestants: mark(state.standings), canVote: false, canEnter: false };
		case 'winner':
			return {
				visible: true, phase: 'winner', title: 'Dance-off winner',
				detail: state.winner?.name ? `${state.winner.name} takes the crown.` : 'Round over.',
				contestants: mark(state.standings), canVote: false, canEnter: false,
			};
		default: {
			const next = Number(state.nextAt) ? secs(state.nextAt) : 0;
			let detail = 'Stand on the dance floor with someone else to start a round.';
			if (next) detail = next < 60 ? `Next round in ${next}s. Stand on the floor to join it.` : `Next round in about ${Math.round(next / 60)} min. Stand on the floor to join it.`;
			if (state.notice) detail = `${state.notice} ${detail}`;
			return { visible: true, phase: 'idle', title: 'Dance-off', detail, contestants: [], canVote: false, canEnter: !onFloor };
		}
	}
}

// ── The 3D side: offering lite to a device that can't keep up ─────────────────

/**
 * Watches frame times in the 3D world and fires once when the device stays far
 * below a usable frame rate even at the lowest render tier. The caller only feeds
 * frames judged fair (full-rate cap, past the entry grace), exactly like the
 * quality watchdog, so a background tab or a loading burst never triggers it.
 */
export function createStruggleDetector({ slowSec = 1 / 10, holdSec = 15, emaAlpha = 0.05 } = {}) {
	let avg = 1 / 30;
	let slowFor = 0;
	let fired = false;
	return {
		get fired() { return fired; },
		/** @returns {boolean} true exactly once, on the tick the device is judged too slow */
		tick(dt, tier) {
			if (fired || !Number.isFinite(dt) || dt <= 0) return false;
			avg = avg * (1 - emaAlpha) + Math.min(dt, 1) * emaAlpha;
			if (tier !== 'low' || avg < slowSec) { slowFor = 0; return false; }
			slowFor += dt;
			if (slowFor < holdSec) return false;
			fired = true;
			return true;
		},
	};
}

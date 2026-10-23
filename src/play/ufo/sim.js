// Flappin UFO simulation: the one physics definition shared by the browser game,
// the ghost replay, and the server that verifies every submitted run
// (api/play/ufo-runs.js). It is pure and deterministic: a fixed 60 Hz step, a
// seeded course per level, and only + - * / and comparisons (no trig, no
// Math.random), so the same inputs produce the same run on every JS engine.
//
// A run is a list of levels. Each level is replayed from its own start with the
// recorded input edges: the ticks at which the thrust button flipped. That is
// the whole replay format, a few hundred integers per level.
//
// Ported from the owner's flappin-ufo (DOM and CSS-transition physics) to a
// fixed-step model so a run can be re-simulated and verified instead of trusted.

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const WORLD_H = 600;
export const SHIP_X = 160;
export const SHIP_R = 17;
export const PILLAR_W = 64;
export const PILLAR_SPACING = 300;
export const FIRST_PILLAR_X = SHIP_X + 480;

const GRAVITY = 1500;
const THRUST = 1900;
const MAX_VY = 420;
const CENTER_MARGIN = 40;
const MAX_CENTER_STEP = 170;

/** Fewest ticks between two input flips, so a replay cannot be a frame-perfect jitter bot. */
export const MIN_EDGE_GAP = 2;
export const MAX_EDGES_PER_LEVEL = 1500;
export const MAX_LEVELS = 30;

export const pillarCount = (level) => 5 + level * 2;
export const gapSize = (level) => Math.max(150, 270 - 12 * (level - 1));
export const scrollSpeed = (level) => Math.min(250 * (1 + 0.025 * (level - 1)), 340);

/** Ticks a level can possibly last before its last pillar has scrolled past the ship. */
export function maxLevelTicks(level) {
	const travel = FIRST_PILLAR_X + (pillarCount(level) - 1) * PILLAR_SPACING + PILLAR_W - SHIP_X;
	return Math.ceil((travel / scrollSpeed(level)) * TICK_HZ) + TICK_HZ;
}

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The course is fixed per level: every player, and every ghost, flies the same one. */
export function levelCourse(level) {
	const rand = mulberry32(Math.imul(level, 0x9e3779b1) ^ 0x7f4a7c15);
	const gap = gapSize(level);
	const lo = gap / 2 + CENTER_MARGIN;
	const hi = WORLD_H - gap / 2 - CENTER_MARGIN;
	const count = pillarCount(level);
	const pillars = [];
	let center = WORLD_H / 2 + (rand() * 2 - 1) * 60;
	for (let i = 0; i < count; i++) {
		if (i > 0) center += (rand() * 2 - 1) * MAX_CENTER_STEP;
		center = Math.min(hi, Math.max(lo, center));
		pillars.push({ x: FIRST_PILLAR_X + i * PILLAR_SPACING, top: center - gap / 2, bottom: center + gap / 2 });
	}
	return { level, gap, speed: scrollSpeed(level), pillars };
}

export function createLevelState(level) {
	return {
		level,
		course: levelCourse(level),
		tick: 0,
		y: WORLD_H / 2,
		vy: 0,
		passed: 0,
		status: 'playing',
	};
}

function hitsPillar(y, px, pillar) {
	const left = px;
	const right = px + PILLAR_W;
	const dx = Math.max(left - SHIP_X, 0, SHIP_X - right);
	if (dx >= SHIP_R) return false;
	const dyTop = Math.max(0 - y, 0, y - pillar.top);
	if (dx * dx + dyTop * dyTop < SHIP_R * SHIP_R) return true;
	const dyBottom = Math.max(pillar.bottom - y, 0, y - WORLD_H);
	return dx * dx + dyBottom * dyBottom < SHIP_R * SHIP_R;
}

/** World x of a pillar after `tick` steps. */
export const pillarX = (course, index, tick) => course.pillars[index].x - course.speed * tick * DT;

/** Advance one tick with the thrust button `up`. Mutates and returns the state. */
export function step(state, up) {
	if (state.status !== 'playing') return state;
	state.tick += 1;
	state.vy += (up ? -THRUST : GRAVITY) * DT;
	if (state.vy > MAX_VY) state.vy = MAX_VY;
	if (state.vy < -MAX_VY) state.vy = -MAX_VY;
	state.y += state.vy * DT;

	if (state.y - SHIP_R < 0 || state.y + SHIP_R > WORLD_H) {
		state.status = 'crashed';
		return state;
	}
	const { course } = state;
	for (let i = 0; i < course.pillars.length; i++) {
		const px = pillarX(course, i, state.tick);
		if (px > SHIP_X + SHIP_R) break;
		if (hitsPillar(state.y, px, course.pillars[i])) {
			state.status = 'crashed';
			return state;
		}
	}
	let passed = state.passed;
	while (passed < course.pillars.length && pillarX(course, passed, state.tick) + PILLAR_W < SHIP_X - SHIP_R) passed++;
	state.passed = passed;
	if (passed >= course.pillars.length) state.status = 'cleared';
	return state;
}

/** The thrust value at `tick` for a list of flip ticks (the button starts released). */
export function upAt(edges, tick) {
	let lo = 0;
	let hi = edges.length - 1;
	let flips = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (edges[mid] <= tick) {
			flips = mid + 1;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return flips % 2 === 1;
}

/**
 * Replay a level from its recorded flip ticks. Runs until the ship crashes, clears
 * the course, or `limitTicks` pass (a replay that just stops is `incomplete`).
 */
export function simulateLevel(level, edges, limitTicks = maxLevelTicks(level)) {
	const state = createLevelState(level);
	let next = 0;
	let up = false;
	while (state.status === 'playing' && state.tick < limitTicks) {
		while (next < edges.length && edges[next] <= state.tick) {
			up = !up;
			next++;
		}
		step(state, up);
	}
	if (state.status === 'playing') state.status = 'incomplete';
	return { status: state.status, ticks: state.tick, passed: state.passed, edgesUsed: next };
}

/** Structural check of one level's edge list: sorted integers, spaced, capped. */
export function validEdges(edges) {
	if (!Array.isArray(edges) || edges.length > MAX_EDGES_PER_LEVEL) return false;
	let prev = -Infinity;
	for (const e of edges) {
		if (!Number.isInteger(e) || e < 0) return false;
		if (e - prev < MIN_EDGE_GAP) return false;
		prev = e;
	}
	return true;
}

/**
 * Verify a whole run: `levels` is [{ edges }]. Every level but the last must clear
 * its course; the last must end in a crash (that is what ends a run). Returns the
 * authoritative score and level, or the reason the run is impossible.
 */
export function verifyRun(levels) {
	if (!Array.isArray(levels) || levels.length < 1 || levels.length > MAX_LEVELS) {
		return { ok: false, reason: 'bad_level_count' };
	}
	let score = 0;
	let ticks = 0;
	for (let i = 0; i < levels.length; i++) {
		const edges = levels[i]?.edges;
		if (!validEdges(edges)) return { ok: false, reason: 'bad_edges', level: i + 1 };
		const result = simulateLevel(i + 1, edges);
		const last = i === levels.length - 1;
		if (last ? result.status !== 'crashed' : result.status !== 'cleared') {
			return { ok: false, reason: last ? 'run_did_not_end_in_crash' : 'level_not_cleared', level: i + 1 };
		}
		if (edges.length && edges[edges.length - 1] >= result.ticks) {
			return { ok: false, reason: 'input_after_end', level: i + 1 };
		}
		score += result.passed;
		ticks += result.ticks;
	}
	return { ok: true, score, level: levels.length, ticks };
}

// Diorama game rules: the pure logic behind a microgame. No Three.js, no DOM,
// no clock of its own (callers pass `now` in milliseconds), so every rule is
// testable in Node and the play mode only has to feed it a walker position.
//
//   collect  pick up `count` of the target objects by walking next to them
//   reach    walk to the first target
//   survive  targets are hazards: touching one loses, outlasting the timer wins
//
// A state is a plain object that is never mutated: each step returns a new one.

import { ISLAND_RADIUS } from './schema.js';

export const WALKER_RADIUS = 0.3;
const PICKUP_PAD = 0.55;
const HAZARD_PAD = 0.1;
const OBSTACLE_SCALE = 0.4;
const RIM_MARGIN = 0.35;

const footprint = (o) => 0.35 + (o.scale || 1) * OBSTACLE_SCALE;

/** Most game time one rendered frame may advance: a stalled or hidden tab costs at most this. */
export const MAX_FRAME_SEC = 0.25;
/** Longest single movement step, so a walker on a slow frame cannot skip past a pickup. */
export const MAX_SUBSTEP_SEC = 1 / 30;

/**
 * The game clock. Turns one rendered frame's real delta (seconds) into the
 * game-time substeps to simulate. Movement and the timer both run on the sum,
 * so a slow device walks at full speed against an honest clock, and a visitor
 * who leaves the tab mid-run comes back to the time they left, not a loss.
 * @returns {number[]}
 */
export function frameSteps(rawSec) {
	if (!(rawSec > 0)) return [];
	const total = Math.min(rawSec, MAX_FRAME_SEC);
	const n = Math.ceil(total / MAX_SUBSTEP_SEC - 1e-9);
	return Array.from({ length: n }, () => total / n);
}

/**
 * Can this world be played right now? A goal only needs its own targets forged:
 * a failed or pending decoration does not block play. Never reports ok for a
 * world with no game, and never "wins" anything on its own.
 * @returns {{ok:boolean, reason:string, forming:string[]}}
 */
export function playability(diorama) {
	const game = diorama?.game;
	if (!game) {
		return { ok: false, reason: 'This world has no goal yet. Ask for one in the prompt.', forming: [] };
	}
	const byId = new Map((diorama.objects || []).map((o) => [o.id, o]));
	const targets = game.targetIds.map((id) => byId.get(id)).filter(Boolean);
	const ready = targets.filter((o) => o.status === 'ready' && o.glbUrl);
	const needed = game.goal === 'collect' ? game.count : targets.length;
	if (ready.length >= needed && targets.length > 0) return { ok: true, reason: '', forming: [] };
	const waiting = targets.filter((o) => !(o.status === 'ready' && o.glbUrl));
	const failed = waiting.filter((o) => o.status === 'failed');
	const forming = waiting.map((o) => o.label);
	if (failed.length && ready.length + (waiting.length - failed.length) < needed) {
		return {
			ok: false,
			reason: `${failed.map((o) => o.label).join(', ')} could not be forged, so this goal cannot be played. Retry the object or remix the world.`,
			forming,
		};
	}
	return {
		ok: false,
		reason: `Still forming: ${forming.join(', ')}. Start unlocks when the goal objects are ready.`,
		forming,
	};
}

/** One-line objective for the HUD, share text and the OG card. */
export function objectiveText(diorama) {
	const game = diorama?.game;
	if (!game) return '';
	const byId = new Map((diorama.objects || []).map((o) => [o.id, o]));
	const labels = game.targetIds.map((id) => byId.get(id)?.label).filter(Boolean);
	const limit = game.timeLimitSec ? ` in ${game.timeLimitSec}s` : '';
	if (game.goal === 'collect') {
		const what = labels.length === 1 ? labels[0] : `${game.count} of ${labels.length} objects (${labels.join(', ')})`;
		return `Collect ${what}${limit}`;
	}
	if (game.goal === 'reach') return `Reach the ${labels[0] || 'goal'}${limit}`;
	return `Survive ${game.timeLimitSec}s and keep clear of ${labels.join(', ')}`;
}

/** A fresh state in the 'ready' phase (nothing started, nothing collected). */
export function createGameState(diorama) {
	const game = diorama?.game;
	if (!game) throw new Error('createGameState needs a diorama with a game block');
	return {
		phase: 'ready',
		collected: [],
		startedAt: null,
		elapsedMs: 0,
		remainingMs: game.timeLimitSec ? game.timeLimitSec * 1000 : null,
		reason: '',
	};
}

export function startGame(state, now) {
	if (state.phase !== 'ready') return state;
	return { ...state, phase: 'playing', startedAt: now };
}

/**
 * Advance one tick: update the clock, then evaluate pickups, hazards, reach and
 * the timer against the walker position {x, z}. A finished game (won or lost)
 * is returned as is.
 */
export function stepGame(state, diorama, walker, now) {
	if (state.phase !== 'playing') return state;
	const game = diorama.game;
	const byId = new Map(diorama.objects.map((o) => [o.id, o]));
	const elapsedMs = Math.max(0, now - state.startedAt);
	const remainingMs = game.timeLimitSec ? Math.max(0, game.timeLimitSec * 1000 - elapsedMs) : null;
	let next = { ...state, elapsedMs, remainingMs };

	const near = (o, pad) => Math.hypot(walker.x - o.position[0], walker.z - o.position[2]) <= footprint(o) + WALKER_RADIUS + pad;

	if (game.goal === 'survive') {
		const hit = game.targetIds.map((id) => byId.get(id)).find((o) => o && near(o, HAZARD_PAD));
		if (hit) return { ...next, phase: 'lost', reason: `Caught by the ${hit.label}.` };
		if (remainingMs === 0) return { ...next, phase: 'won', reason: 'You survived.' };
		return next;
	}

	if (game.goal === 'collect') {
		const collected = state.collected.slice();
		for (const id of game.targetIds) {
			const o = byId.get(id);
			if (o && !collected.includes(id) && o.status === 'ready' && near(o, PICKUP_PAD)) collected.push(id);
		}
		next = { ...next, collected };
		if (collected.length >= game.count) return { ...next, phase: 'won', reason: 'Everything collected.' };
	} else {
		const goalObj = byId.get(game.targetIds[0]);
		if (goalObj && near(goalObj, PICKUP_PAD)) {
			return { ...next, phase: 'won', collected: [goalObj.id], reason: `You reached the ${goalObj.label}.` };
		}
	}

	if (remainingMs === 0) return { ...next, phase: 'lost', reason: 'Time ran out.' };
	return next;
}

/** HUD numbers: progress `n/m` (collect) and a mm:ss clock string. */
export function hudFor(state, diorama) {
	const game = diorama.game;
	const clock = state.remainingMs === null ? '' : formatClock(state.remainingMs);
	return {
		objective: objectiveText(diorama),
		progress: game.goal === 'collect' ? `${state.collected.length}/${game.count}` : '',
		clock,
	};
}

export function formatClock(ms) {
	const total = Math.ceil(Math.max(0, ms) / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Keep a walker on the island and out of solid objects. Collectible targets
 * that are not yet collected stay walk-through (you pick them up by touching
 * them); everything else, including hazards, is an obstacle except in
 * 'survive', where hazards must be touchable to lose.
 */
export function resolveWalker(pos, diorama, collected = []) {
	let { x, z } = pos;
	const game = diorama.game;
	const passable = new Set(game ? game.targetIds : []);
	for (let pass = 0; pass < 2; pass++) {
		for (const o of diorama.objects) {
			if (passable.has(o.id) || collected.includes(o.id)) continue;
			if (o.status !== 'ready') continue;
			const min = footprint(o) * 0.6 + WALKER_RADIUS;
			const dx = x - o.position[0];
			const dz = z - o.position[2];
			const d = Math.hypot(dx, dz);
			if (d < min) {
				const k = d > 1e-6 ? min / d : 1;
				x = o.position[0] + (d > 1e-6 ? dx * k : min);
				z = o.position[2] + (d > 1e-6 ? dz * k : 0);
			}
		}
	}
	const limit = ISLAND_RADIUS - RIM_MARGIN;
	const r = Math.hypot(x, z);
	if (r > limit) {
		x *= limit / r;
		z *= limit / r;
	}
	return { x, z };
}

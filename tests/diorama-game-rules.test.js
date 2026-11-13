import { describe, it, expect } from 'vitest';
import { normalizeDiorama, ISLAND_RADIUS } from '../src/diorama/schema.js';
import {
	playability,
	objectiveText,
	createGameState,
	startGame,
	stepGame,
	hudFor,
	formatClock,
	resolveWalker,
	frameSteps,
	MAX_FRAME_SEC,
	MAX_SUBSTEP_SEC,
} from '../src/diorama/game-rules.js';

const ready = (id, label, x, z, extra = {}) => ({
	id,
	label,
	prompt: `a ${label}`,
	position: [x, 0, z],
	scale: 1,
	status: 'ready',
	glbUrl: `https://cdn.example.test/${id}.glb`,
	...extra,
});

const world = (game, objects) =>
	normalizeDiorama({
		prompt: 'lanterns',
		objects: objects ?? [
			ready('l1', 'lantern', -3, 0),
			ready('l2', 'lantern', 3, 0),
			ready('l3', 'lantern', 0, -3),
			ready('rock', 'rock', 0, 0),
		],
		game,
	}).diorama;

const collect = world({ goal: 'collect', targetIds: ['l1', 'l2', 'l3'], count: 2, timeLimitSec: 30 });

describe('playability', () => {
	it('refuses a world with no goal and says how to get one', () => {
		const r = playability(world(undefined));
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/no goal yet/);
	});

	it('plays when the goal targets are ready even if a decoration failed', () => {
		const d = world({ goal: 'collect', targetIds: ['l1', 'l2'] }, [
			ready('l1', 'lantern', -3, 0),
			ready('l2', 'lantern', 3, 0),
			ready('tree', 'tree', 1, 1, { status: 'failed', glbUrl: null }),
		]);
		expect(playability(d).ok).toBe(true);
	});

	it('names the forming targets and blocks Start until they are ready', () => {
		const d = world({ goal: 'reach', targetIds: ['cabin'] }, [
			ready('rock', 'rock', 0, 0),
			ready('cabin', 'cabin', 2, 2, { status: 'forging', glbUrl: null }),
			ready('tree', 'tree', 1, 1),
		]);
		const r = playability(d);
		expect(r.ok).toBe(false);
		expect(r.forming).toEqual(['cabin']);
		expect(r.reason).toMatch(/Still forming: cabin/);
	});

	it('says so when a needed target failed to forge', () => {
		const d = world({ goal: 'reach', targetIds: ['cabin'] }, [
			ready('rock', 'rock', 0, 0),
			ready('cabin', 'cabin', 2, 2, { status: 'failed', glbUrl: null }),
			ready('tree', 'tree', 1, 1),
		]);
		expect(playability(d).reason).toMatch(/could not be forged/);
	});

	it('a collect goal needs only `count` ready targets', () => {
		const d = world({ goal: 'collect', targetIds: ['l1', 'l2', 'l3'], count: 2 }, [
			ready('l1', 'lantern', -3, 0),
			ready('l2', 'lantern', 3, 0),
			ready('l3', 'lantern', 0, -3, { status: 'failed', glbUrl: null }),
		]);
		expect(playability(d).ok).toBe(true);
	});
});

describe('objectiveText', () => {
	it('describes each goal', () => {
		expect(objectiveText(collect)).toContain('Collect 2 of 3');
		expect(objectiveText(collect)).toContain('in 30s');
		expect(objectiveText(world({ goal: 'reach', targetIds: ['rock'] }))).toBe('Reach the rock');
		expect(objectiveText(world({ goal: 'survive', targetIds: ['rock'], timeLimitSec: 20 }))).toContain('Survive 20s');
		expect(objectiveText(world(undefined))).toBe('');
	});
});

describe('collect', () => {
	it('does nothing before Start and wins on the second pickup', () => {
		let s = createGameState(collect);
		expect(stepGame(s, collect, { x: -3, z: 0 }, 1000).phase).toBe('ready');
		s = startGame(s, 1000);
		s = stepGame(s, collect, { x: -3, z: 0.2 }, 1500);
		expect(s.collected).toEqual(['l1']);
		expect(s.phase).toBe('playing');
		expect(hudFor(s, collect).progress).toBe('1/2');
		s = stepGame(s, collect, { x: 3, z: 0 }, 2000);
		expect(s.phase).toBe('won');
		expect(s.collected).toEqual(['l1', 'l2']);
	});

	it('does not pick up from far away and loses when the timer runs out', () => {
		let s = startGame(createGameState(collect), 0);
		s = stepGame(s, collect, { x: 0, z: 4 }, 29_000);
		expect(s.collected).toEqual([]);
		expect(s.phase).toBe('playing');
		s = stepGame(s, collect, { x: 0, z: 4 }, 30_000);
		expect(s.phase).toBe('lost');
		expect(s.reason).toMatch(/Time ran out/);
	});

	it('a win on the last tick beats the timeout and finished games stay finished', () => {
		let s = startGame(createGameState(collect), 0);
		s = stepGame(s, collect, { x: -3, z: 0 }, 1000);
		s = stepGame(s, collect, { x: 3, z: 0 }, 30_000);
		expect(s.phase).toBe('won');
		expect(stepGame(s, collect, { x: 0, z: 4 }, 99_000)).toBe(s);
	});
});

describe('reach', () => {
	const d = world({ goal: 'reach', targetIds: ['l1'] });
	it('wins on arrival and never loses untimed', () => {
		let s = startGame(createGameState(d), 0);
		s = stepGame(s, d, { x: 5, z: 5 }, 600_000);
		expect(s.phase).toBe('playing');
		s = stepGame(s, d, { x: -3, z: 0.1 }, 600_001);
		expect(s.phase).toBe('won');
	});
});

describe('survive', () => {
	const d = world({ goal: 'survive', targetIds: ['l1'], timeLimitSec: 20 });
	it('loses on touching a hazard', () => {
		let s = startGame(createGameState(d), 0);
		s = stepGame(s, d, { x: -3, z: 0 }, 1000);
		expect(s.phase).toBe('lost');
		expect(s.reason).toMatch(/Caught/);
	});
	it('wins when the clock runs out clear of hazards', () => {
		let s = startGame(createGameState(d), 0);
		s = stepGame(s, d, { x: 3, z: 3 }, 19_000);
		expect(s.phase).toBe('playing');
		s = stepGame(s, d, { x: 3, z: 3 }, 20_000);
		expect(s.phase).toBe('won');
	});
});

describe('resolveWalker', () => {
	it('keeps the walker on the island and out of solid objects', () => {
		const out = resolveWalker({ x: 50, z: 0 }, collect, []);
		expect(Math.hypot(out.x, out.z)).toBeLessThan(ISLAND_RADIUS);
		const pushed = resolveWalker({ x: 0.1, z: 0 }, collect, []);
		expect(Math.hypot(pushed.x, pushed.z)).toBeGreaterThan(0.5);
	});
	it('lets the walker onto a collectible target', () => {
		expect(resolveWalker({ x: -3, z: 0 }, collect, [])).toEqual({ x: -3, z: 0 });
	});
});

describe('formatClock', () => {
	it('rounds up to whole seconds', () => {
		expect(formatClock(29_001)).toBe('0:30');
		expect(formatClock(61_000)).toBe('1:01');
		expect(formatClock(-5)).toBe('0:00');
	});
});

describe('frameSteps (the game clock)', () => {
	const sum = (steps) => steps.reduce((a, b) => a + b, 0);

	it('counts a slow 10 fps frame in full, so walking speed matches the clock', () => {
		expect(sum(frameSteps(0.1))).toBeCloseTo(0.1, 9);
	});

	it('charges a hidden-tab or stalled frame at most a fraction of a second', () => {
		// A visitor who switches tabs for 30s mid-run must come back to the same
		// clock, not an instant "Time ran out".
		expect(sum(frameSteps(30))).toBeCloseTo(MAX_FRAME_SEC, 9);
		expect(MAX_FRAME_SEC).toBeLessThanOrEqual(0.25);
	});

	it('splits a frame into short substeps so a fast walker cannot skip a pickup', () => {
		for (const raw of [0.016, 0.05, 0.1, 0.25, 5]) {
			const steps = frameSteps(raw);
			expect(steps.length).toBeGreaterThan(0);
			for (const step of steps) expect(step).toBeLessThanOrEqual(MAX_SUBSTEP_SEC + 1e-12);
		}
	});

	it('ignores a zero, negative or non-numeric delta', () => {
		expect(frameSteps(0)).toEqual([]);
		expect(frameSteps(-1)).toEqual([]);
		expect(frameSteps(Number.NaN)).toEqual([]);
	});

	it('a 30s run at 10 fps ends on the frame its clock says, and a tab stall does not eat it', () => {
		let s = startGame(createGameState(collect), 0);
		let simMs = 0;
		let frames = 0;
		const far = { x: 0, z: 4 };
		while (s.phase === 'playing' && frames < 1000) {
			// Halfway through the visitor leaves the tab for a minute.
			const raw = frames === 150 ? 60 : 0.1;
			for (const step of frameSteps(raw)) simMs += step * 1000;
			s = stepGame(s, collect, far, simMs);
			frames += 1;
		}
		expect(s.phase).toBe('lost');
		// 300 frames of 0.1s, minus the at-most-0.25s the stall frame contributed.
		expect(frames).toBeGreaterThanOrEqual(298);
		expect(frames).toBeLessThanOrEqual(300);
	});
});

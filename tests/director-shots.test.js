import { describe, it, expect } from 'vitest';
import {
	KIND, MOVE, MIN_SHOT_MS, MAX_SHOT_MS, crowdClusters, buildCandidates, scoreCandidate,
	chooseShot, pickDuration, shouldCutEarly, planShot, shotPose, pushOutOfBoxes, insideBox,
	sightBlocked, segmentHitsBox, tallestTop, photoCandidate, countNear,
} from '../src/game/director-shots.js';

// Deterministic rng so shot choice is reproducible.
function seeded(seed = 7) {
	let s = seed >>> 0;
	return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

const landmarks = [
	{ id: 'totem', x: 0, z: -12, facing: 0, standoff: 20, height: 6 },
	{ id: 'jumbotron', x: 0, z: 34, facing: Math.PI, standoff: 30, height: 9 },
	{ id: 'dancefloor', x: 20, z: 10, standoff: 16, height: 6 },
];

const box = (x, z, hx, hz, top = 30) => ({ position: { x, y: top / 2, z }, halfExtents: { x: hx, y: top / 2, z: hz }, rotationY: 0 });

describe('crowdClusters', () => {
	it('returns nothing for an empty world and ignores lone players', () => {
		expect(crowdClusters([])).toEqual([]);
		expect(crowdClusters([{ x: 5, z: 5 }])).toEqual([]);
	});

	it('finds the busiest bunch and centres on its members', () => {
		const players = [
			{ x: 40, z: 40 }, { x: 42, z: 41 }, { x: 41, z: 43 }, { x: 43, z: 42 },
			{ x: -60, z: 5 }, { x: -61, z: 6 },
		];
		const c = crowdClusters(players);
		expect(c).toHaveLength(2);
		expect(c[0].count).toBe(4);
		expect(c[0].x).toBeCloseTo(41.5, 0);
		expect(c[0].z).toBeCloseTo(41.5, 0);
	});

	it('merges neighbouring cells into one crowd rather than overlapping shots', () => {
		const players = Array.from({ length: 12 }, (_, i) => ({ x: 8 + (i % 4) * 3, z: 8 + Math.floor(i / 4) * 3 }));
		expect(crowdClusters(players)).toHaveLength(1);
	});
});

describe('density drives shot choice', () => {
	it('never offers a crowd candidate for an empty corner', () => {
		const ids = buildCandidates({ landmarks, players: [] }).map((c) => c.id);
		expect(ids.some((id) => id.startsWith('crowd:'))).toBe(false);
	});

	it('favours the crowd over empty landmarks when people are bunched up', () => {
		const players = Array.from({ length: 10 }, (_, i) => ({ x: -70 + (i % 3), z: 50 + Math.floor(i / 3) }));
		const candidates = buildCandidates({ landmarks, players });
		const tally = {};
		const rng = seeded(11);
		for (let i = 0; i < 400; i++) {
			const c = chooseShot({ candidates, players, history: [], rng });
			const key = c.kind === KIND.CROWD ? 'crowd' : c.id;
			tally[key] = (tally[key] || 0) + 1;
		}
		expect(tally.crowd).toBeGreaterThan(250);
		expect((tally.totem || 0) + (tally.jumbotron || 0) + (tally.dancefloor || 0)).toBeLessThan(80);
	});

	it('weights an occupied landmark far above an empty one', () => {
		const players = Array.from({ length: 6 }, (_, i) => ({ x: 19 + i * 0.5, z: 10 }));
		const candidates = buildCandidates({ landmarks, players });
		const dance = scoreCandidate(candidates.find((c) => c.id === 'dancefloor'), players);
		const totem = scoreCandidate(candidates.find((c) => c.id === 'totem'), players);
		expect(dance.near).toBe(6);
		expect(dance.score).toBeGreaterThan(totem.score * 4);
	});

	it('still rotates through the landmarks when the world is empty', () => {
		const candidates = buildCandidates({ landmarks, players: [] });
		const seen = new Set();
		const rng = seeded(3);
		for (let i = 0; i < 200; i++) seen.add(chooseShot({ candidates, players: [], rng }).id);
		expect(seen.has('totem') && seen.has('jumbotron') && seen.has('dancefloor')).toBe(true);
	});

	it('almost never repeats the shot it just showed', () => {
		const players = [{ x: 0, z: -10 }, { x: 1, z: -11 }, { x: 20, z: 10 }, { x: 21, z: 10 }];
		const candidates = buildCandidates({ landmarks, players });
		const rng = seeded(5);
		let repeats = 0;
		let last = candidates[0];
		for (let i = 0; i < 300; i++) {
			const next = chooseShot({ candidates, players, history: [last], rng });
			if (next.id === last.id) repeats++;
			last = next;
		}
		expect(repeats).toBeLessThan(25);
	});
});

describe('durations and early cuts', () => {
	it('holds each shot between 15 and 30 seconds', () => {
		expect(pickDuration(() => 0)).toBe(MIN_SHOT_MS);
		expect(pickDuration(() => 1)).toBe(MAX_SHOT_MS);
		const rng = seeded(2);
		for (let i = 0; i < 100; i++) {
			const d = pickDuration(rng);
			expect(d).toBeGreaterThanOrEqual(MIN_SHOT_MS);
			expect(d).toBeLessThanOrEqual(MAX_SHOT_MS);
		}
	});

	it('cuts a crowd shot early once the crowd has left, but not a landmark or a locked shot', () => {
		const crowd = planShot({ id: 'crowd:1:1', kind: KIND.CROWD, x: 10, y: 1.4, z: 10, standoff: 12, height: 3, radius: 12, weight: 1, facing: null }, { rng: seeded(1) });
		expect(shouldCutEarly(crowd, [{ x: 11, z: 10 }])).toBe(false);
		expect(shouldCutEarly(crowd, [{ x: 150, z: 150 }])).toBe(true);
		expect(shouldCutEarly({ ...crowd, locked: true }, [])).toBe(false);
		const lm = planShot(buildCandidates({ landmarks, players: [] })[0], { rng: seeded(1) });
		expect(shouldCutEarly(lm, [])).toBe(false);
	});
});

describe('camera clearance', () => {
	it('detects a camera inside a building and slides it out through the nearest face', () => {
		const b = box(20, 0, 8, 8);
		expect(insideBox({ x: 22, y: 5, z: 1 }, [b])).toBe(true);
		const out = pushOutOfBoxes({ x: 22, y: 5, z: 1 }, [b]);
		expect(insideBox(out, [b])).toBe(false);
		expect(Math.abs(out.x - 22) + Math.abs(out.z - 1)).toBeLessThan(15);
	});

	it('lets a camera fly above a roof but never below the ground or outside the world', () => {
		const b = box(0, 0, 8, 8, 20);
		expect(insideBox({ x: 0, y: 40, z: 0 }, [b])).toBe(false);
		const p = pushOutOfBoxes({ x: 900, y: -4, z: -900 }, [b]);
		expect(p.y).toBeGreaterThan(1);
		expect(Math.abs(p.x)).toBeLessThanOrEqual(196);
		expect(Math.abs(p.z)).toBeLessThanOrEqual(196);
	});

	it('segmentHitsBox and sightBlocked agree on a wall between camera and subject', () => {
		const wall = box(0, 10, 10, 1);
		expect(segmentHitsBox({ x: 0, y: 3, z: 0 }, { x: 0, y: 3, z: 20 }, wall)).toBe(true);
		expect(segmentHitsBox({ x: 30, y: 3, z: 0 }, { x: 30, y: 3, z: 20 }, wall)).toBe(false);
		expect(sightBlocked({ x: 0, y: 3, z: 0 }, { x: 0, y: 3, z: 20 }, [wall])).toBe(true);
	});

	it('every sampled point of a planned path is clear of the buildings', () => {
		// A ring of towers just outside the plaza: the natural bearing is often walled off.
		const boxes = [];
		for (let a = 0; a < 8; a++) boxes.push(box(Math.sin(a * 0.785) * 75, -12 + Math.cos(a * 0.785) * 75, 9, 9));
		const candidates = buildCandidates({ landmarks, players: [{ x: 0, z: -10 }, { x: 2, z: -10 }] });
		const rng = seeded(21);
		for (let run = 0; run < 60; run++) {
			const c = candidates[run % candidates.length];
			const plan = planShot(c, { boxes, rng });
			for (let i = 0; i <= 20; i++) {
				const { pos, look } = shotPose(plan, i / 20);
				expect(insideBox(pos, boxes)).toBe(false);
				expect(sightBlocked(pos, look, boxes)).toBe(false);
			}
		}
	});

	it('falls back to a crane above the tallest roof when the subject is boxed in', () => {
		const boxes = [box(0, 0, 60, 60, 45)];
		const plan = planShot({ id: 'x', kind: KIND.LANDMARK, x: 70, y: 3, z: 0, standoff: 100, height: 4, radius: 14, weight: 1, facing: null }, { boxes, rng: seeded(9) });
		const { pos } = shotPose(plan, 0.5);
		expect(insideBox(pos, boxes)).toBe(false);
		expect(tallestTop(boxes)).toBe(45);
	});
});

describe('shot paths', () => {
	const cand = buildCandidates({ landmarks, players: [] }).find((c) => c.id === 'jumbotron');

	it('a screen shot approaches from the side the screen faces', () => {
		const plan = planShot(cand, { rng: seeded(4) });
		const { pos } = shotPose(plan, 0);
		expect(pos.z).toBeLessThan(cand.z);
	});

	it('moves over time, and holds perfectly still under reduced motion', () => {
		const moving = planShot(cand, { rng: seeded(4) });
		const a = shotPose(moving, 0), b = shotPose(moving, 1);
		expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z, a.pos.y - b.pos.y)).toBeGreaterThan(1);

		const still = planShot(cand, { rng: seeded(4), reducedMotion: true });
		expect(still.move).toBe(MOVE.STATIC);
		expect(shotPose(still, 0)).toEqual(shotPose(still, 1));
	});

	it('looks at the subject at every moment', () => {
		const plan = planShot(cand, { rng: seeded(8) });
		for (const t of [0, 0.3, 1]) expect(shotPose(plan, t).look).toEqual(plan.target);
	});
});

describe('group photo shot', () => {
	it('frames the totem and widens for a bigger turnout', () => {
		const small = photoCandidate(landmarks, [{ x: 0, z: -10 }]);
		const big = photoCandidate(landmarks, Array.from({ length: 30 }, (_, i) => ({ x: Math.cos(i) * 24, z: -12 + Math.sin(i) * 24 })));
		expect(small.x).toBe(0);
		expect(small.z).toBe(-12);
		expect(big.standoff).toBeGreaterThan(small.standoff);
		expect(photoCandidate([], [])).toBeNull();
	});

	it('plans as a locked shot with the requested length', () => {
		const plan = planShot(photoCandidate(landmarks, []), { rng: seeded(1), locked: true, durationMs: 70_000 });
		expect(plan.locked).toBe(true);
		expect(plan.durationMs).toBe(70_000);
		expect(countNear([{ x: 0, z: -12 }], 0, -12)).toBe(1);
	});
});

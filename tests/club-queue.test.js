// Tests for the /club door line: the queue layout and the conversation director.
//
// Both are pure. planDoorLine() takes geometry probes as callbacks, so the alley
// here is a few lines of arithmetic shaped like the real one: a wall behind the
// door, floor that runs out a few metres to one side, and a dumpster blocking
// the other. QueueChatter takes an injected rng and a `say` sink, so a whole
// night of conversation runs in a loop with no DOM and no clock.

import { describe, it, expect } from 'vitest';
import {
	planDoorLine,
	QueueChatter,
	lineDuration,
	EXCHANGES,
	DRUNK_EXCHANGES,
	SOLO,
	REACTIONS,
} from '../src/club-queue.js';

// Door at the origin, facing +z into the alley. `perp` for that axis is +x, so
// side +1 is +x. The wall face sits 0.6 m out from the (recessed) door point.
const door = { x: 0, z: 0 };
const dir = { x: 0, z: 1 };
const WALL_Z = 0.6;

function alley({ floorMaxX = 6, floorMinX = -6, dumpsterX = -3.2 } = {}) {
	return {
		floorAt: (x, z) => (x > floorMaxX || x < floorMinX || z < WALL_Z || z > 12 ? null : 0.26),
		wallDistance: (x, z, dx, dz) => (dz < 0 ? z - WALL_Z : null),
		// Anything crossing the dumpster's face on the -x side is blocked.
		clearBetween: (ax, az, bx, bz) => !(Math.min(ax, bx) < dumpsterX && az < 4 && bz < 4),
	};
}

const seeded = (seed = 1) => () => {
	seed = (seed * 16807) % 2147483647;
	return (seed - 1) / 2147483646;
};

describe('planDoorLine', () => {
	it('lines people up along the wall on the side that has room', () => {
		const plan = planDoorLine({ door, dir, count: 8, ...alley(), rng: seeded() });
		expect(plan.side).toBe(1); // the dumpster side fits fewer
		const line = plan.slots.filter((s) => s.role === 'line');
		expect(line.length).toBe(6); // 8 bodies: six queue, one staggers, one is on the pavement
		for (const s of line) {
			expect(s.x).toBeGreaterThanOrEqual(2.4 - 1e-9); // clear of the door and its doorman
			expect(s.z).toBeGreaterThan(WALL_Z); // in front of the wall, never inside it
			expect(s.y).toBe(0.26);
		}
		expect(line.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('keeps neighbours a body apart', () => {
		const { slots } = planDoorLine({ door, dir, count: 11, ...alley(), rng: seeded() });
		const line = slots.filter((s) => s.role === 'line');
		for (let i = 0; i < line.length; i++) {
			for (let j = i + 1; j < line.length; j++) {
				expect(Math.hypot(line[i].x - line[j].x, line[i].z - line[j].z)).toBeGreaterThan(0.55);
			}
		}
	});

	it('bends the line down the alley when the wall runs out', () => {
		const plan = planDoorLine({ door, dir, count: 11, ...alley({ floorMaxX: 4.6 }), rng: seeded() });
		const line = plan.slots.filter((s) => s.role === 'line');
		expect(line.length).toBe(9);
		const alongWall = line.filter((s) => s.z < WALL_Z + 1.2);
		const bent = line.filter((s) => s.z >= WALL_Z + 1.2);
		expect(alongWall.length).toBeGreaterThan(0);
		expect(bent.length).toBeGreaterThan(0);
		// The bent tail marches away from the wall, one behind the other.
		for (let i = 1; i < bent.length; i++) expect(bent[i].z).toBeGreaterThan(bent[i - 1].z);
		// And the rope turns the corner with it.
		const xs = new Set(plan.posts.map((p) => p.x.toFixed(2)));
		const zs = new Set(plan.posts.map((p) => p.z.toFixed(2)));
		expect(xs.size).toBeGreaterThan(1);
		expect(zs.size).toBeGreaterThan(1);
	});

	it('never stands anyone on a different level or over a void', () => {
		// Door steps: a raised block beside the door on the +x side.
		const a = alley();
		const floorAt = (x, z) => (x > 2 && x < 3.4 && z < 2 ? 0.9 : a.floorAt(x, z));
		const plan = planDoorLine({ door, dir, count: 8, ...a, floorAt, rng: seeded() });
		for (const s of plan.slots) expect(floorAt(s.x, s.z)).toBe(s.y);
		const levels = new Set(plan.slots.filter((s) => s.role === 'line').map((s) => s.y));
		expect(levels.size).toBe(1);
	});

	it('puts the rope outside the line, from its head to its tail', () => {
		const plan = planDoorLine({ door, dir, count: 8, ...alley(), rng: seeded() });
		const line = plan.slots.filter((s) => s.role === 'line');
		expect(plan.posts.length).toBeGreaterThanOrEqual(2);
		const maxLineZ = Math.max(...line.map((s) => s.z));
		for (const p of plan.posts) expect(p.z).toBeGreaterThan(maxLineZ);
		expect(Math.min(...plan.posts.map((p) => p.x))).toBeLessThan(Math.min(...line.map((s) => s.x)));
		expect(Math.max(...plan.posts.map((p) => p.x))).toBeGreaterThan(Math.max(...line.map((s) => s.x)));
		const gaps = plan.posts.slice(1).map((p, i) => Math.hypot(p.x - plan.posts[i].x, p.z - plan.posts[i].z));
		for (const g of gaps) expect(g).toBeLessThanOrEqual(1.5 + 1e-9);
	});

	it('casts the drunks by budget and keeps them off the queue side', () => {
		const small = planDoorLine({ door, dir, count: 4, ...alley(), rng: seeded() });
		expect(small.slots.every((s) => s.role === 'line')).toBe(true);
		expect(small.beat).toBeNull();

		const mid = planDoorLine({ door, dir, count: 5, ...alley(), rng: seeded() });
		expect(mid.slots.filter((s) => s.drunk === 'stagger').length).toBe(1);
		expect(mid.slots.some((s) => s.drunk === 'slump')).toBe(false);

		const full = planDoorLine({ door, dir, count: 11, ...alley(), rng: seeded() });
		expect(full.slots.length).toBe(11);
		expect(full.slots.filter((s) => s.drunk === 'sway').length).toBe(1);
		const stagger = full.slots.find((s) => s.drunk === 'stagger');
		const slump = full.slots.find((s) => s.drunk === 'slump');
		expect(stagger.x * full.side).toBeLessThan(0);
		expect(slump.x * full.side).toBeLessThan(0);
		expect(full.beat.a.x * full.side).toBeLessThan(0);
		expect(full.beat.b.x * full.side).toBeLessThan(0);
		// The stagger is dealt early so a slow connection still gets one.
		expect(full.slots.indexOf(stagger)).toBeLessThanOrEqual(3);
	});

	it('returns an empty plan when there is nowhere to stand', () => {
		const plan = planDoorLine({
			door, dir, count: 8,
			floorAt: () => null, wallDistance: () => null, clearBetween: () => true,
		});
		expect(plan.slots).toEqual([]);
		expect(plan.posts).toEqual([]);
		expect(plan.beat).toBeNull();
	});

	it('works for a door facing any direction', () => {
		// Same alley rotated a quarter turn: the door faces +x, the wall runs along z.
		const rot = {
			floorAt: (x, z) => alley().floorAt(-z, x),
			wallDistance: (x, z, dx, dz) => alley().wallDistance(-z, x, -dz, dx),
			clearBetween: (ax, az, bx, bz) => alley().clearBetween(-az, ax, -bz, bx),
		};
		const plan = planDoorLine({ door, dir: { x: 1, z: 0 }, count: 8, ...rot, rng: seeded() });
		const straight = planDoorLine({ door, dir, count: 8, ...alley(), rng: seeded() });
		expect(plan.slots.length).toBe(straight.slots.length);
		for (const s of plan.slots.filter((q) => q.role === 'line')) expect(s.x).toBeGreaterThan(WALL_Z);
	});
});

describe('script hygiene', () => {
	const everyLine = [
		...EXCHANGES.flat().map((l) => l[1]),
		...DRUNK_EXCHANGES.flat().map((l) => l[1]),
		...Object.values(SOLO).flat(),
		...REACTIONS.brush,
		...REACTIONS.staggerBump,
		...REACTIONS.cut.flat().map((l) => l[1]),
		...REACTIONS.admitted.flat().map((l) => l[1]),
	];

	it('fits a bubble and carries no banned dashes', () => {
		for (const text of everyLine) {
			expect(text.length).toBeGreaterThan(0);
			expect(text.length).toBeLessThanOrEqual(70);
			expect([...text].some((ch) => ch.charCodeAt(0) === 0x2013 || ch.charCodeAt(0) === 0x2014)).toBe(false);
		}
	});

	it('only ever names the platform coin', () => {
		const tickers = everyLine.flatMap((t) => t.match(/\$[A-Za-z]{2,}/g) || []);
		for (const t of tickers) expect(t).toBe('$THREE');
	});

	it('reads at a human pace', () => {
		expect(lineDuration('No.')).toBe(2.2);
		expect(lineDuration('x'.repeat(200))).toBe(6);
		expect(lineDuration('How long have you been out here?')).toBeGreaterThan(3);
	});
});

describe('QueueChatter', () => {
	function cast(n, { sway = -1, stagger = false } = {}) {
		const members = [];
		for (let i = 0; i < n; i++) {
			members.push({ id: `line-${i}`, role: 'line', order: i, drunk: i === sway ? 'sway' : null, position: { x: 2.4 + i * 0.6, z: 1 } });
		}
		if (stagger) members.push({ id: 'stagger', role: 'stagger', order: -1, drunk: 'stagger', position: { x: -3, z: 3 } });
		return members;
	}
	function run(chatter, seconds, ctx = {}) {
		for (let t = 0; t < seconds; t += 0.1) chatter.update(0.1, ctx);
	}

	it('stays silent with nobody there', () => {
		const said = [];
		const chatter = new QueueChatter({ say: (m, text) => said.push(text), rng: seeded() });
		run(chatter, 30);
		expect(said).toEqual([]);
	});

	it('deals exchanges to neighbours, one line at a time', () => {
		const said = [];
		let clock = 0;
		const chatter = new QueueChatter({ say: (m, text, dur) => said.push({ m, text, dur, at: clock }), rng: seeded(7) });
		for (const m of cast(6)) chatter.add(m);
		for (; clock < 120; clock += 0.1) chatter.update(0.1, { playerPos: { x: 0, z: 4 } });

		expect(said.length).toBeGreaterThan(8);
		// Nobody talks over the previous line.
		for (let i = 1; i < said.length; i++) {
			expect(said[i].at).toBeGreaterThanOrEqual(said[i - 1].at + said[i - 1].dur - 1e-6);
		}
		// Every reply comes from the person standing next to the one who spoke.
		const scripted = new Map(EXCHANGES.map((ex) => [ex[0][1], ex]));
		for (let i = 0; i < said.length; i++) {
			const ex = scripted.get(said[i].text);
			if (!ex) continue;
			const reply = said[i + 1];
			expect(reply.text).toBe(ex[1][1]);
			expect(Math.abs(reply.m.order - said[i].m.order)).toBe(1);
		}
	});

	it('does not repeat an exchange until the whole deck has been dealt', () => {
		const openers = [];
		const opening = new Set(EXCHANGES.map((ex) => ex[0][1]));
		const chatter = new QueueChatter({ say: (m, text) => { if (opening.has(text)) openers.push(text); }, rng: seeded(3) });
		for (const m of cast(6)) chatter.add(m);
		run(chatter, 400);
		const firstDeck = openers.slice(0, EXCHANGES.length);
		expect(firstDeck.length).toBe(EXCHANGES.length);
		expect(new Set(firstDeck).size).toBe(EXCHANGES.length);
	});

	it('gives the drunks their own lines', () => {
		const byRole = { sway: [], stagger: [] };
		const chatter = new QueueChatter({
			say: (m, text) => { if (m.drunk) byRole[m.drunk].push(text); },
			rng: seeded(11),
		});
		for (const m of cast(6, { sway: 4, stagger: true })) chatter.add(m);
		run(chatter, 400);
		expect(byRole.stagger.length).toBeGreaterThan(0);
		for (const text of byRole.stagger) expect(SOLO.stagger).toContain(text);
		const swayLines = [...SOLO.sway, ...DRUNK_EXCHANGES.flat().filter((l) => l[0] === 'drunk').map((l) => l[1])];
		expect(byRole.sway.length).toBeGreaterThan(0);
		for (const text of byRole.sway) expect(swayLines).toContain(text);
	});

	it('calls the player out for walking past the line, once', () => {
		const said = [];
		const chatter = new QueueChatter({ say: (m, text) => said.push({ m, text }), rng: seeded(5) });
		for (const m of cast(4)) chatter.add(m);
		run(chatter, 1, { playerPos: { x: 0, z: 1 }, nearDoor: true });
		expect(said[0].text).toBe(REACTIONS.cut[0][0][1]);
		expect(said[0].m.order).toBe(0); // the head of the line is the one who minds most

		run(chatter, 60, { playerPos: { x: 0, z: 1 }, nearDoor: true });
		expect(said.filter((s) => s.text === REACTIONS.cut[0][0][1]).length).toBe(1);
	});

	it('reacts when the player crowds the line, with a cooldown', () => {
		const said = [];
		let clock = 0;
		const chatter = new QueueChatter({ say: (m, text) => said.push({ text, at: clock }), rng: seeded(9) });
		for (const m of cast(4)) chatter.add(m);
		for (; clock < 40; clock += 0.1) chatter.update(0.1, { playerPos: { x: 2.5, z: 1.2 } });
		const brushes = said.filter((s) => REACTIONS.brush.includes(s.text));
		expect(brushes.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < brushes.length; i++) expect(brushes[i].at - brushes[i - 1].at).toBeGreaterThanOrEqual(10.9);
	});

	it('has the line grumble when the player is let in, and nothing reacts after', () => {
		const said = [];
		const chatter = new QueueChatter({ say: (m, text) => said.push(text), rng: seeded(2) });
		for (const m of cast(4)) chatter.add(m);
		chatter.admitted();
		run(chatter, 12, { playerPos: { x: 2.5, z: 1.2 }, paid: true });
		expect(said.slice(0, 2)).toEqual(REACTIONS.admitted[0].map((l) => l[1]));
		expect(said.some((t) => REACTIONS.brush.includes(t))).toBe(false);
	});

	it('picks up people who join the line late', () => {
		const speakers = new Set();
		const chatter = new QueueChatter({ say: (m) => speakers.add(m.id), rng: seeded(4) });
		const members = cast(6);
		chatter.add(members[0]);
		run(chatter, 20);
		expect(speakers.size).toBe(0); // one person has nobody to talk to
		for (const m of members.slice(1)) chatter.add(m);
		run(chatter, 300);
		expect(speakers.size).toBeGreaterThanOrEqual(4);
	});
});

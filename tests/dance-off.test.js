// Dance-off rounds: the pure round machine and tally (multiplayer/src/dance-off.js).
// Locks the fairness contract the spec asks for: one counted vote per voter, no
// self-votes, ties to the earliest-to-threshold, fewer than two dancers dissolves
// quietly, a leaver takes their votes with them, and the clock always comes back
// to idle so the floor is never stranded.

import { describe, it, expect, beforeEach } from 'vitest';
import {
	DanceOff, DEFAULT_TIMINGS, DANCE_FLOOR, onFloor, parseTimings, MAX_CONTESTANTS,
} from '../multiplayer/src/dance-off.js';

const T = { ...DEFAULT_TIMINGS, joinMs: 1000, performMs: 10_000, tallyMs: 1000, winnerMs: 2000 };
const dancer = (id, d = 1) => ({ id, name: id.toUpperCase(), d });
const crowd = (...ids) => ({ live: true, players: ids.length + 3, onFloor: ids.map((i) => dancer(i)) });

// Drive a machine to the performing phase with the given dancers.
function perform(ids, t0 = 0) {
	const m = new DanceOff({ timings: T, now: t0 });
	m.nextAt = t0;
	expect(m.tick(t0, crowd(...ids)).map((e) => e.type)).toEqual(['open']);
	expect(m.tick(t0 + T.joinMs, crowd(...ids)).map((e) => e.type)).toEqual(['start']);
	return m;
}

describe('dance-off tally', () => {
	let m;
	beforeEach(() => { m = perform(['a', 'b']); });

	it('counts one vote per voter: the first stands, later ones do not', () => {
		expect(m.vote('v1', 'a', 100)).toEqual({ counted: true, reason: '' });
		expect(m.vote('v1', 'a', 200)).toEqual({ counted: false, reason: 'already-voted' });
		expect(m.vote('v1', 'b', 300)).toEqual({ counted: false, reason: 'already-voted' });
		expect(m.votesFor('a')).toBe(1);
		expect(m.votesFor('b')).toBe(0);
	});

	it('rejects self-votes and votes for non-contestants', () => {
		expect(m.vote('a', 'a', 100).reason).toBe('self');
		expect(m.vote('v1', 'nobody', 100).reason).toBe('not-contestant');
		expect(m.votesFor('a')).toBe(0);
	});

	it('lets a contestant vote for another contestant, not themselves', () => {
		expect(m.vote('a', 'b', 100).counted).toBe(true);
		expect(m.votesFor('b')).toBe(1);
	});

	it('does not count votes outside the performing phase', () => {
		const idle = new DanceOff({ timings: T, now: 0 });
		expect(idle.vote('v', 'a', 1).reason).toBe('closed');
		m.tick(T.joinMs + T.performMs, crowd('a', 'b'));
		expect(m.phase).toBe('tally');
		expect(m.vote('late', 'a', 5).reason).toBe('closed');
	});

	it('ranks by votes, then by who reached that count first', () => {
		m.vote('v1', 'b', 100);
		m.vote('v2', 'a', 200);
		m.vote('v3', 'a', 300);
		m.vote('v4', 'b', 250);
		// 2 apiece. b reached 2 at t=250, a at t=300: b wins the tie.
		const s = m.standings();
		expect(s.map((r) => [r.id, r.votes])).toEqual([['b', 2], ['a', 2]]);
	});

	it('a later-surging contestant with more votes beats the early one', () => {
		m.vote('v1', 'a', 100);
		m.vote('v2', 'b', 200);
		m.vote('v3', 'b', 300);
		expect(m.standings()[0].id).toBe('b');
	});

	it('removes the votes a leaver cast and every vote for a leaving contestant', () => {
		const m3 = perform(['a', 'b', 'c']);
		m3.vote('v1', 'a', 10);
		m3.vote('v2', 'a', 20);
		m3.vote('v3', 'b', 30);
		m3.leave('v1');
		expect(m3.votesFor('a')).toBe(1);
		m3.leave('a');
		expect(m3.contestants.has('a')).toBe(false);
		expect(m3.ballots.has('v2')).toBe(false); // v2's vote went with a, so v2 may vote again
		expect(m3.vote('v2', 'c', 40).counted).toBe(true);
		expect(m3.phase).toBe('performing'); // two dancers left, the round goes on
	});
});

describe('dance-off round transitions', () => {
	it('runs idle, joining, performing, tally, winner, idle', () => {
		const m = new DanceOff({ timings: T, now: 0 });
		m.nextAt = 0;
		const seen = [];
		const step = (t, c) => { for (const e of m.tick(t, c)) seen.push(e.type); };
		step(0, crowd('a', 'b'));
		expect(m.phase).toBe('joining');
		step(T.joinMs, crowd('a', 'b'));
		expect(m.phase).toBe('performing');
		m.vote('v', 'a', T.joinMs + 5);
		step(T.joinMs + T.performMs, crowd('a', 'b'));
		expect(m.phase).toBe('tally');
		step(T.joinMs + T.performMs + T.tallyMs, crowd('a', 'b'));
		expect(m.phase).toBe('winner');
		step(T.joinMs + T.performMs + T.tallyMs + T.winnerMs, crowd('a', 'b'));
		expect(m.phase).toBe('idle');
		expect(seen).toEqual(['open', 'start', 'tally', 'winner', 'idle']);
		expect(m.roundId).toBe(1);
	});

	it('snapshots contestants once, at the start of the performance, nearest the centre first', () => {
		const m = new DanceOff({ timings: T, now: 0 });
		m.nextAt = 0;
		m.tick(0, crowd('a'));
		const ctx = { live: true, players: 12, onFloor: [dancer('far', 3.5), dancer('near', 0.2), dancer('mid', 2)] };
		m.tick(T.joinMs, ctx);
		expect([...m.contestants.keys()]).toEqual(['near', 'mid', 'far']);
		// A late arrival on the floor mid-performance does not become a contestant.
		m.tick(T.joinMs + 100, { ...ctx, onFloor: [...ctx.onFloor, dancer('late')] });
		expect(m.contestants.has('late')).toBe(false);
	});

	it('caps the field', () => {
		const m = new DanceOff({ timings: T, now: 0 });
		m.nextAt = 0;
		const ids = Array.from({ length: MAX_CONTESTANTS + 4 }, (_, i) => `p${i}`);
		m.tick(0, crowd(...ids));
		m.tick(T.joinMs, crowd(...ids));
		expect(m.contestants.size).toBe(MAX_CONTESTANTS);
	});

	it('dissolves quietly with fewer than two on the floor when the window closes', () => {
		const m = new DanceOff({ timings: T, now: 0 });
		m.nextAt = 0;
		m.tick(0, crowd('a'));
		const ev = m.tick(T.joinMs, crowd('a'));
		expect(ev.map((e) => e.type)).toEqual(['dissolve']);
		expect(m.phase).toBe('idle');
		expect(m.roundId).toBe(1);
		expect(m.nextAt).toBe(T.joinMs + T.eventRetryMs); // event cadence: retry soon
	});

	it('dissolves when a disconnect leaves one dancer mid-round, then returns to idle', () => {
		const m = perform(['a', 'b']);
		const ev = m.leave('b', 5000, true);
		expect(ev.map((e) => e.type)).toEqual(['dissolve']);
		expect(m.phase).toBe('idle');
		expect(m.contestants.size).toBe(0);
		expect(m.tick(5001, crowd('a')).length).toBe(0); // nothing stranded, nothing re-fires
	});

	it('a round with no votes has no winner and skips the winner phase', () => {
		const m = perform(['a', 'b']);
		m.tick(T.joinMs + T.performMs, crowd('a', 'b'));
		const ev = m.tick(T.joinMs + T.performMs + T.tallyMs, crowd('a', 'b'));
		expect(ev.map((e) => e.type)).toEqual(['idle']);
		expect(m.phase).toBe('idle');
	});

	it('is a no-op to leave when not a contestant or voter', () => {
		const m = perform(['a', 'b']);
		expect(m.leave('stranger')).toEqual([]);
		expect(m.phase).toBe('performing');
	});
});

describe('dance-off cadence', () => {
	const endRound = (live) => {
		const m = perform(['a', 'b']);
		m.vote('v', 'a', T.joinMs + 1);
		let t = T.joinMs + T.performMs;
		m.tick(t, crowd('a', 'b'));
		t += T.tallyMs; m.tick(t, { ...crowd('a', 'b'), live });
		t += T.winnerMs; m.tick(t, { ...crowd('a', 'b'), live });
		return { m, t };
	};

	it('runs on the short cadence inside the event window and the long one outside', () => {
		const inside = endRound(true);
		const outside = endRound(false);
		expect(inside.m.nextAt - inside.t).toBe(T.eventCooldownMs);
		expect(outside.m.nextAt - outside.t).toBe(T.cooldownMs);
		expect(T.eventCooldownMs).toBeLessThan(T.cooldownMs);
	});

	it('outside the event only opens on its own when two people are already on the floor', () => {
		const m = new DanceOff({ timings: T, now: 0 });
		m.nextAt = 0;
		expect(m.tick(1, { live: false, players: 30, onFloor: [dancer('a')] })).toEqual([]);
		expect(m.tick(2, { live: false, players: 30, onFloor: [dancer('a'), dancer('b')] }).map((e) => e.type)).toEqual(['open']);
	});

	it('inside the event opens for anyone in the room', () => {
		const m = new DanceOff({ timings: T, now: 0 });
		m.nextAt = 0;
		expect(m.tick(1, { live: true, players: 1, onFloor: [] }).map((e) => e.type)).toEqual(['open']);
	});

	it('waits for nextAt', () => {
		const m = new DanceOff({ timings: T, now: 0 });
		expect(m.tick(1, crowd('a', 'b'))).toEqual([]);
	});

	it('on demand: needs two on the floor, honours the gap, only from idle', () => {
		const m = new DanceOff({ timings: T, now: 0 });
		expect(m.requestStart(10, crowd('a')).reason).toBe('need-two');
		expect(m.requestStart(10, crowd('a', 'b')).ok).toBe(true);
		expect(m.requestStart(11, crowd('a', 'b')).reason).toBe('busy');
		const r = endRound(false);
		expect(r.m.requestStart(r.t + 1, crowd('a', 'b')).reason).toBe('too-soon');
		expect(r.m.requestStart(r.t + T.onDemandGapMs, crowd('a', 'b')).ok).toBe(true);
	});
});

describe('dance-off helpers', () => {
	it('parseTimings accepts known keys and ignores junk', () => {
		const t = parseTimings('joinMs=3000, performMs=12000,bogus=5,tallyMs=abc,winnerMs=1');
		expect(t.joinMs).toBe(3000);
		expect(t.performMs).toBe(12000);
		expect(t.tallyMs).toBe(DEFAULT_TIMINGS.tallyMs);
		expect(t.winnerMs).toBe(DEFAULT_TIMINGS.winnerMs);
		expect(parseTimings('')).toEqual(DEFAULT_TIMINGS);
		expect(parseTimings(undefined)).toEqual(DEFAULT_TIMINGS);
	});

	it('onFloor matches the rendered pad', () => {
		expect(onFloor(DANCE_FLOOR.x, DANCE_FLOOR.z)).toBe(true);
		expect(onFloor(DANCE_FLOOR.x + DANCE_FLOOR.r, DANCE_FLOOR.z)).toBe(true);
		expect(onFloor(DANCE_FLOOR.x + DANCE_FLOOR.r + 0.1, DANCE_FLOOR.z)).toBe(false);
		expect(onFloor(0, 0)).toBe(false);
	});

	it('the default performance is 60 to 90 seconds', () => {
		expect(DEFAULT_TIMINGS.performMs).toBeGreaterThanOrEqual(60_000);
		expect(DEFAULT_TIMINGS.performMs).toBeLessThanOrEqual(90_000);
	});
});

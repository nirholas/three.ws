// Dance-off rounds on the synced dance floor: the pure round machine and tally.
//
// Same shape as King of the Totem (WalkRoom._kingTick): one authoritative clock
// drives every phase transition, the client only renders. This file holds NO room,
// network or wall-clock state of its own; time and the floor census are passed in,
// so the whole machine is deterministic and unit-testable. The room glue lives in
// dance-off-room.js.
//
//   idle  ->  joining  ->  performing  ->  tally  ->  winner  ->  idle
//                 \             \
//                  `-- dissolve (fewer than two on the floor) --> idle
//
//   idle        waiting for the next round. `nextAt` is when a round may open on
//               its own; a player on the floor can also ask for one sooner.
//   joining     announced in-world. Step onto the floor to enter.
//   performing  contestants are the players ON the floor when this phase begins,
//               snapshotted once. The crowd votes with the reaction bar.
//   tally       votes are frozen and revealed.
//   winner      spotlight moment; the room grants the reward and posts the feed event.
//
// Voting rules (the fairness contract, locked by tests/dance-off.test.js):
//   - one counted vote per voter per round; the first vote stands, later ones are
//     cosmetic only (the reaction still broadcasts, it just does not count)
//   - nobody votes for themselves; only contestants can be voted for
//   - a player who disconnects takes their vote with them, and a contestant who
//     disconnects takes every vote cast for them (those voters may vote again)
//   - the winner has the most votes; a tie goes to whoever REACHED that count first
//   - a round with no votes has no winner, honestly
//   - fewer than two contestants at any point dissolves the round quietly

// The disco pad. Mirrors CX/CZ/R in CommunityScene._buildDanceFloor
// (src/game/coincommunities.js); keep the two in step.
export const DANCE_FLOOR = Object.freeze({ x: 14, z: -10, r: 4 });

export const MIN_CONTESTANTS = 2;
export const MAX_CONTESTANTS = 8;

/** Phase lengths and cadence. Every value is milliseconds. */
export const DEFAULT_TIMINGS = Object.freeze({
	joinMs: 20_000,          // announced window to walk onto the floor
	performMs: 75_000,       // the performance (spec: 60 to 90 s)
	tallyMs: 4_000,          // votes frozen and revealed
	winnerMs: 15_000,        // spotlight moment
	cooldownMs: 600_000,     // outside the event: a round at most every 10 minutes
	eventCooldownMs: 150_000, // inside the event window: every ~2.5 minutes after a result
	retryMs: 240_000,        // after a dissolved round, outside the event
	eventRetryMs: 60_000,    // after a dissolved round, inside the event
	onDemandGapMs: 45_000,   // a player-requested round may not follow another closer than this
});

const TIMING_KEYS = new Set(Object.keys(DEFAULT_TIMINGS));
const MIN_TIMING_MS = 500;
const MAX_TIMING_MS = 6 * 3600_000;

/**
 * Parse the dev-only DANCE_OFF_TIMINGS override, e.g.
 * `joinMs=3000,performMs=12000,eventCooldownMs=5000`. Unknown keys and
 * unparseable or out-of-range values are ignored so a typo can never produce a
 * zero-length phase; the defaults always fill the gaps.
 */
export function parseTimings(spec) {
	const out = { ...DEFAULT_TIMINGS };
	if (typeof spec !== 'string' || !spec.trim()) return out;
	for (const part of spec.split(',')) {
		const [k, v] = part.split('=').map((s) => s.trim());
		if (!TIMING_KEYS.has(k)) continue;
		const n = Number(v);
		if (Number.isFinite(n) && n >= MIN_TIMING_MS && n <= MAX_TIMING_MS) out[k] = Math.round(n);
	}
	return out;
}

/** Is (x, z) on the pad? Edge counts as on. */
export function onFloor(x, z) {
	return Math.hypot(x - DANCE_FLOOR.x, z - DANCE_FLOOR.z) <= DANCE_FLOOR.r;
}

export class DanceOff {
	/**
	 * @param {object} [opts]
	 * @param {object} [opts.timings] merged over DEFAULT_TIMINGS
	 * @param {number} [opts.now]
	 */
	constructor({ timings, now = Date.now() } = {}) {
		this.t = { ...DEFAULT_TIMINGS, ...(timings || {}) };
		this.phase = 'idle';
		this.roundId = 0;
		this.phaseEndsAt = 0;       // end of the current timed phase (0 while idle)
		this.nextAt = now + this.t.eventCooldownMs; // first automatic round may open then
		this.lastEndedAt = 0;
		this.contestants = new Map(); // id -> { id, name, votes: [{ voter, at }] }
		this.ballots = new Map();     // voterId -> contestantId (the one counted vote)
		this.result = null;           // { winner|null, standings }
		this.notice = '';             // why the last round dissolved, for the HUD
	}

	// --- votes ---------------------------------------------------------------

	/** Votes a contestant currently holds. */
	votesFor(id) {
		return this.contestants.get(id)?.votes.length || 0;
	}

	/**
	 * Cast a vote. Returns { counted, reason }. `reason` is set when not counted:
	 * 'closed' (not performing), 'self', 'not-contestant', 'already-voted'.
	 * The caller must only pass voters that are present in the room.
	 */
	vote(voterId, targetId, now = Date.now()) {
		if (this.phase !== 'performing') return { counted: false, reason: 'closed' };
		if (voterId === targetId) return { counted: false, reason: 'self' };
		const target = this.contestants.get(targetId);
		if (!target) return { counted: false, reason: 'not-contestant' };
		if (this.ballots.has(voterId)) return { counted: false, reason: 'already-voted' };
		this.ballots.set(voterId, targetId);
		target.votes.push({ voter: voterId, at: now });
		return { counted: true, reason: '' };
	}

	/**
	 * Standings, best first: most votes, then the contestant who reached that count
	 * earliest (their last counted vote has the earliest timestamp), then name for a
	 * stable order among the vote-less.
	 */
	standings() {
		const rows = [...this.contestants.values()].map((c) => ({
			id: c.id,
			name: c.name,
			votes: c.votes.length,
			reachedAt: c.votes.length ? c.votes[c.votes.length - 1].at : Infinity,
		}));
		rows.sort((a, b) => b.votes - a.votes || a.reachedAt - b.reachedAt || a.name.localeCompare(b.name));
		return rows;
	}

	// --- membership ----------------------------------------------------------

	/**
	 * A session left the room (or the floor-state became invalid for it). Drops the
	 * vote they cast and, if they were a contestant, every vote cast for them.
	 * Returns a 'dissolve' event if that leaves fewer than two contestants mid-round.
	 */
	leave(id, now = Date.now(), live = false) {
		const events = [];
		const cast = this.ballots.get(id);
		if (cast !== undefined) {
			this.ballots.delete(id);
			const t = this.contestants.get(cast);
			if (t) t.votes = t.votes.filter((v) => v.voter !== id);
		}
		const mine = this.contestants.get(id);
		if (mine) {
			for (const v of mine.votes) this.ballots.delete(v.voter);
			this.contestants.delete(id);
			if (this.phase === 'performing' && this.contestants.size < MIN_CONTESTANTS) {
				events.push(this._dissolve(now, 'A dancer left. Not enough dancers for a dance-off.', live));
			}
		}
		return events;
	}

	// --- round control -------------------------------------------------------

	/**
	 * A player asks for a round now. Only from idle, only after the on-demand gap,
	 * and only when the room has at least two players on the floor to compete.
	 */
	requestStart(now, ctx) {
		if (this.phase !== 'idle') return { ok: false, reason: 'busy' };
		if (this.lastEndedAt && now - this.lastEndedAt < this.t.onDemandGapMs) return { ok: false, reason: 'too-soon' };
		if ((ctx?.onFloor?.length || 0) < MIN_CONTESTANTS) return { ok: false, reason: 'need-two' };
		this._open(now);
		return { ok: true, reason: '', events: [{ type: 'open' }] };
	}

	/**
	 * Advance the machine. `ctx`:
	 *   live      true inside the event window (rounds run on the frequent cadence)
	 *   players   number of players in the room
	 *   onFloor   [{ id, name, d }] live players on the pad now; d = distance to its centre
	 * Returns the transitions that happened this tick, in order.
	 */
	tick(now, ctx) {
		const events = [];
		const floor = ctx?.onFloor || [];

		if (this.phase === 'idle') {
			if (now < this.nextAt) return events;
			// Inside the event window a round opens whenever anyone is around, because
			// the crowd walking on is the point. Outside it, only when two people are
			// already on the floor, so an empty plaza is never nagged.
			const ready = ctx?.live ? (ctx.players || 0) >= 1 : floor.length >= MIN_CONTESTANTS;
			if (!ready) return events;
			this._open(now);
			events.push({ type: 'open' });
			return events;
		}

		if (this.phase === 'joining' && now >= this.phaseEndsAt) {
			const picked = [...floor].sort((a, b) => a.d - b.d).slice(0, MAX_CONTESTANTS);
			if (picked.length < MIN_CONTESTANTS) {
				events.push(this._dissolve(now, 'Nobody joined the floor. Try again soon.', ctx?.live));
				return events;
			}
			this.contestants = new Map(picked.map((p) => [p.id, { id: p.id, name: p.name, votes: [] }]));
			this.ballots = new Map();
			this.phase = 'performing';
			this.phaseEndsAt = now + this.t.performMs;
			events.push({ type: 'start' });
			return events;
		}

		if (this.phase === 'performing' && now >= this.phaseEndsAt) {
			const standings = this.standings();
			const top = standings[0];
			this.result = { winner: top && top.votes > 0 ? { id: top.id, name: top.name, votes: top.votes } : null, standings };
			this.phase = 'tally';
			this.phaseEndsAt = now + this.t.tallyMs;
			events.push({ type: 'tally' });
			return events;
		}

		if (this.phase === 'tally' && now >= this.phaseEndsAt) {
			if (this.result?.winner) {
				this.phase = 'winner';
				this.phaseEndsAt = now + this.t.winnerMs;
				events.push({ type: 'winner', winner: this.result.winner, standings: this.result.standings });
			} else {
				events.push(this._finish(now, ctx?.live, 'Nobody got a vote. Dance-off over.'));
			}
			return events;
		}

		if (this.phase === 'winner' && now >= this.phaseEndsAt) {
			events.push(this._finish(now, ctx?.live, ''));
		}
		return events;
	}

	// --- internals -----------------------------------------------------------

	_open(now) {
		this.roundId += 1;
		this.phase = 'joining';
		this.phaseEndsAt = now + this.t.joinMs;
		this.contestants = new Map();
		this.ballots = new Map();
		this.result = null;
		this.notice = '';
	}

	_dissolve(now, notice, live) {
		this.phase = 'idle';
		this.phaseEndsAt = 0;
		this.contestants = new Map();
		this.ballots = new Map();
		this.result = null;
		this.notice = notice;
		this.lastEndedAt = now;
		this.nextAt = now + (live ? this.t.eventRetryMs : this.t.retryMs);
		return { type: 'dissolve', notice };
	}

	_finish(now, live, notice) {
		this.phase = 'idle';
		this.phaseEndsAt = 0;
		this.lastEndedAt = now;
		this.notice = notice;
		this.nextAt = now + (live ? this.t.eventCooldownMs : this.t.cooldownMs);
		return { type: 'idle', notice };
	}

	/** Wire snapshot, used for the broadcast and the join sync. */
	snapshot(event, now = Date.now(), live = false) {
		const standings = this.phase === 'tally' || this.phase === 'winner'
			? this.result?.standings || []
			: this.standings();
		return {
			event,
			phase: this.phase,
			roundId: this.roundId,
			now,
			endsAt: this.phaseEndsAt,
			nextAt: this.phase === 'idle' ? this.nextAt : 0,
			live: !!live,
			floor: DANCE_FLOOR,
			contestants: [...this.contestants.values()].map((c) => ({ id: c.id, name: c.name, votes: c.votes.length })),
			standings: standings.map((s) => ({ id: s.id, name: s.name, votes: s.votes })),
			winner: this.phase === 'winner' ? this.result?.winner || null : null,
			notice: this.notice,
		};
	}
}

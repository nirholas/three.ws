// R07 — King of the Totem: server-authoritative area control. The full WalkRoom
// needs the Colyseus runtime, so these tests drive the pure round + scoring
// helpers against a minimal stand-in (Object.create avoids the Room constructor).
// They lock the invariants a client must not be able to break: only a SOLE
// occupant of the totem zone scores, contested/empty hold pays nobody, rounds
// start/end on the machine, a winner is the top PRESENT player (or none), and a
// player outside the zone can never score.

import { describe, it, expect, beforeEach } from 'vitest';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';

// The totem zone the server scores around (mirrors KING_ZONE in WalkRoom.js).
const ZONE = { x: 0, z: -12, r: 3.5 };

// A Player-like record carrying only the fields the king helpers read.
function player(name, x, z, dead = false) {
	return { name, x, y: 0, z, dead };
}

// Build a WalkRoom instance without the Colyseus constructor, wiring only the
// state + broadcast surface the king helpers touch. `broadcasts` captures
// outgoing room messages so tests can assert what every client receives.
function makeRoom() {
	const room = Object.create(WalkRoom.prototype);
	Object.defineProperty(room, 'state', { value: { players: new Map() }, writable: true, configurable: true });
	room.clients = [];
	room.broadcasts = [];
	room.sent = [];
	room.broadcast = (type, msg) => room.broadcasts.push({ type, msg });
	room.send = (client, type, msg) => room.sent.push({ client, type, msg });
	room._king = {
		phase: 'idle', roundId: 0, startedAt: 0, endsAt: 0, nextAt: 0,
		lastTickAt: 0, scores: new Map(), kingId: null, winner: null,
	};
	return room;
}

function seat(room, id, name, x, z, dead = false) {
	room.state.players.set(id, player(name, x, z, dead));
	room.clients.push({ sessionId: id });
}

// Place a player at the zone centre / well outside it for occupancy tests.
const atTotem = (room, id, name) => seat(room, id, name, ZONE.x, ZONE.z);
const farAway = (room, id, name) => seat(room, id, name, ZONE.x + 50, ZONE.z + 50);

describe('WalkRoom King of the Totem (R07)', () => {
	let room;
	beforeEach(() => { room = makeRoom(); });

	it('counts only live players inside the zone as occupants', () => {
		atTotem(room, 'a', 'Alice');
		farAway(room, 'b', 'Bob');
		seat(room, 'c', 'Cara', ZONE.x, ZONE.z, true); // dead — can't hold the zone
		// Exactly on the radius edge counts as inside; just outside does not.
		seat(room, 'd', 'Dee', ZONE.x + ZONE.r, ZONE.z);
		seat(room, 'e', 'Eve', ZONE.x + ZONE.r + 0.5, ZONE.z);

		const occ = room._kingOccupants();
		expect(occ.sort()).toEqual(['a', 'd']);
	});

	it('awards points only to a SOLE occupant; contested pays nobody', () => {
		atTotem(room, 'a', 'Alice');
		farAway(room, 'b', 'Bob');
		room._startKingRound();
		expect(room._king.phase).toBe('active');

		// Rewind lastTick 1s so a's solo hold earns ~1s of points.
		room._king.lastTickAt = Date.now() - 1000;
		room._kingTick();
		expect(room._king.scores.get('a')).toBeGreaterThan(0);
		expect(room._king.scores.get('b') || 0).toBe(0);
		expect(room._king.kingId).toBe('a');

		// Bob steps onto the totem — now contested, so the next second pays no one.
		const before = room._king.scores.get('a');
		room.state.players.get('b').x = ZONE.x; room.state.players.get('b').z = ZONE.z;
		room._king.lastTickAt = Date.now() - 1000;
		room._kingTick();
		expect(room._king.scores.get('a')).toBe(before); // frozen while contested
		expect(room._king.kingId).toBeNull();
	});

	it('never lets a player outside the zone score', () => {
		farAway(room, 'a', 'Alice');
		room._startKingRound();
		room._king.lastTickAt = Date.now() - 1000;
		room._kingTick();
		expect(room._king.scores.get('a')).toBe(0);
		expect(room._king.kingId).toBeNull();
	});

	it('ends the round on time and crowns the top present player', () => {
		atTotem(room, 'a', 'Alice');
		farAway(room, 'b', 'Bob');
		room._startKingRound();
		room._king.scores.set('a', 120);
		room._king.scores.set('b', 30);
		// Force the clock past the round end. lastTick = now so the final beat adds ~0
		// (a is still the sole occupant) and the asserted total stays exactly 120.
		room._king.endsAt = Date.now() - 1;
		room._king.lastTickAt = Date.now();
		room._kingTick();

		expect(room._king.phase).toBe('intermission');
		expect(room._king.winner).toEqual({ id: 'a', name: 'Alice', score: 120 });
		expect(room._king.kingId).toBeNull();
		const end = room.broadcasts.find((b) => b.type === 'game:king' && b.msg.event === 'end');
		expect(end).toBeTruthy();
		expect(end.msg.winner.id).toBe('a');
	});

	it('declares no winner when nobody scored', () => {
		atTotem(room, 'a', 'Alice');
		room._startKingRound(); // everyone starts at 0
		room._king.endsAt = Date.now() - 1;
		room._endKingRound();
		expect(room._king.winner).toBeNull();
		const end = room.broadcasts.find((b) => b.msg?.event === 'end');
		expect(end.msg.winner).toBeNull();
	});

	it('starts a round from idle once a player is present, and the scoreboard sorts high→low capped at 8', () => {
		for (let i = 0; i < 10; i++) atTotem(room, `p${i}`, `P${i}`);
		room._kingTick(); // idle → active
		expect(room._king.phase).toBe('active');

		for (let i = 0; i < 10; i++) room._king.scores.set(`p${i}`, i * 5);
		const rows = room._kingScoreRows();
		expect(rows).toHaveLength(8);
		expect(rows[0].id).toBe('p9'); // highest score first
		const scores = rows.map((r) => r.score);
		expect(scores).toEqual([...scores].sort((a, b) => b - a));
	});

	it('does not award a king who left mid-round (handled by score cleanup)', () => {
		atTotem(room, 'a', 'Alice');
		room._startKingRound();
		room._king.scores.set('a', 200);
		room._king.kingId = 'a';
		// Simulate onLeave's king cleanup: drop their score + demote.
		room.state.players.delete('a');
		room._king.scores.delete('a');
		room._king.kingId = null;
		room._king.endsAt = Date.now() - 1;
		room._endKingRound();
		expect(room._king.winner).toBeNull(); // the departed leader can't win
	});

	it('intermission rolls into the next round when players remain', () => {
		atTotem(room, 'a', 'Alice');
		room._startKingRound();
		const firstRound = room._king.roundId;
		room._endKingRound();
		expect(room._king.phase).toBe('intermission');
		room._king.nextAt = Date.now() - 1; // intermission elapsed
		room._kingTick();
		expect(room._king.phase).toBe('active');
		expect(room._king.roundId).toBe(firstRound + 1);
	});

	it('intermission drops back to idle when the room empties', () => {
		atTotem(room, 'a', 'Alice');
		room._startKingRound();
		room._endKingRound();
		room.state.players.clear(); // everyone left
		room._king.nextAt = Date.now() - 1;
		room._kingTick();
		expect(room._king.phase).toBe('idle');
	});
});

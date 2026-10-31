// Dance-off room glue (multiplayer/src/dance-off-room.js) against a stand-in room:
// the broadcast stream, the reward being granted exactly once across repeat wins,
// the feed event, mid-round disconnects, the dev kill switch, and the floor
// returning to idle after every path.

import { describe, it, expect, beforeEach } from 'vitest';
import { attachDanceOff, CHAMPION_COSMETIC } from '../multiplayer/src/dance-off-room.js';
import { DANCE_FLOOR } from '../multiplayer/src/dance-off.js';
import { newProfile, grantCosmetic } from '../multiplayer/src/economy.js';
import { getCosmetic, isEventCosmetic } from '../multiplayer/src/cosmetics-catalog.js';

const ON = { x: DANCE_FLOOR.x, z: DANCE_FLOOR.z };
const OFF = { x: 0, z: 0 };

function makeRoom() {
	const room = {
		roomId: 'room1',
		state: { players: new Map(), coin: 'COIN' },
		clients: [],
		econ: new Map(),
		sentProfile: [],
		persisted: [],
		handlers: {},
		intervals: [],
		broadcasts: [],
		clock: { setInterval: (fn, ms) => room.intervals.push({ fn, ms }) },
		onMessage: (type, fn) => { room.handlers[type] = fn; },
		broadcast: (type, msg) => room.broadcasts.push({ type, msg }),
		_persistEcon: (id) => room.persisted.push(id),
		_sendProfile: (c) => room.sentProfile.push(c.sessionId),
	};
	return room;
}

function seat(room, id, pos, account = id) {
	room.state.players.set(id, { name: id.toUpperCase(), x: pos.x, z: pos.z, dead: false, account });
	const client = { sessionId: id, sent: [], send(type, msg) { this.sent.push({ type, msg }); } };
	room.clients.push(client);
	room.econ.set(id, newProfile(account));
	return client;
}

const TIMINGS = 'joinMs=1000,performMs=2000,tallyMs=1000,winnerMs=1000,eventCooldownMs=1000,cooldownMs=1000';

describe('dance-off room glue', () => {
	let room, clockNow, feedEvents, ctl;
	const states = () => room.broadcasts.filter((b) => b.type === 'dance:state').map((b) => b.msg.event);

	function build(extra = {}) {
		ctl = attachDanceOff(room, {
			env: { DANCE_OFF_TIMINGS: TIMINGS },
			now: () => clockNow,
			isLive: () => true,
			publishFeedEvent: (e, key) => { feedEvents.push({ e, key }); },
			...extra,
		});
		ctl.machine.nextAt = 0;
		return ctl;
	}
	const advance = (ms) => { clockNow += ms; ctl.tick(); };

	beforeEach(() => {
		room = makeRoom();
		clockNow = 1_000_000;
		feedEvents = [];
	});

	it('the reward is an event-tier aura, never sold', () => {
		const c = getCosmetic(CHAMPION_COSMETIC);
		expect(c).toBeTruthy();
		expect(isEventCosmetic(CHAMPION_COSMETIC)).toBe(true);
		expect(c.slot).toBe('aura');
		expect(c.price).toBe(0);
	});

	it('registers the start message and a one second clock', () => {
		build();
		expect(typeof room.handlers['dance:start']).toBe('function');
		expect(room.intervals.map((i) => i.ms)).toEqual([1000]);
	});

	it('is off when DANCE_OFF=off', () => {
		expect(attachDanceOff(room, { env: { DANCE_OFF: 'off' } })).toBeNull();
		expect(room.intervals.length).toBe(0);
	});

	it('runs a full round: broadcasts, grants the winner once, posts the feed event', () => {
		seat(room, 'a', ON);
		const b = seat(room, 'b', ON);
		const v = seat(room, 'v', OFF);
		build();
		advance(0);                                   // open
		advance(1000);                                // start
		ctl.reaction(v, { target: 'b' });
		ctl.reaction(v, { target: 'a' });             // second vote: not counted
		advance(2000);                                // tally
		advance(1000);                                // winner
		expect(states()).toEqual(['open', 'start', 'vote', 'tally', 'winner']);

		expect(room.econ.get('b').cosmetics.owned).toContain(CHAMPION_COSMETIC);
		expect(room.persisted).toEqual(['b']);
		expect(b.sent.filter((m) => m.type === 'souvenir').length).toBe(1);
		expect(b.sent.find((m) => m.type === 'dance:reward').msg.first).toBe(true);
		expect(v.sent.filter((m) => m.type === 'dance:ack').map((m) => m.msg.counted)).toEqual([true, false]);
		expect(feedEvents.length).toBe(1);
		expect(feedEvents[0].e).toMatchObject({ type: 'dance-off', actor: 'B', votes: 1, contestants: 2, coin: 'COIN' });

		advance(1000);                                // back to idle
		expect(states().at(-1)).toBe('idle');
		expect(ctl.machine.phase).toBe('idle');
	});

	it('a repeat win grants nothing new and sends no second souvenir', () => {
		seat(room, 'a', ON);
		const b = seat(room, 'b', ON);
		const v = seat(room, 'v', OFF);
		build();
		for (let round = 0; round < 2; round++) {
			ctl.machine.nextAt = 0;
			advance(0); advance(1000);
			ctl.reaction(v, { target: 'b' });
			advance(2000); advance(1000); advance(1000);
		}
		expect(ctl.machine.roundId).toBe(2);
		expect(room.econ.get('b').cosmetics.owned.filter((id) => id === CHAMPION_COSMETIC).length).toBe(1);
		expect(room.persisted).toEqual(['b']);
		expect(b.sent.filter((m) => m.type === 'souvenir').length).toBe(1);
		expect(b.sent.filter((m) => m.type === 'dance:reward').map((m) => m.msg.first)).toEqual([true, false]);
		expect(feedEvents.length).toBe(2); // each win is a feed event; the grant is what is idempotent
		expect(grantCosmetic(room.econ.get('b'), CHAMPION_COSMETIC)).toBe(false);
	});

	it('a solo dancer dissolves the round quietly and the floor returns to idle', () => {
		seat(room, 'a', ON);
		build();
		advance(0); advance(1000);
		expect(states()).toEqual(['open', 'dissolve']);
		expect(ctl.machine.phase).toBe('idle');
		expect(room.persisted).toEqual([]);
		expect(feedEvents).toEqual([]);
	});

	it('a mid-round disconnect drops the contestant and their votes; the last pair dissolves', () => {
		seat(room, 'a', ON);
		seat(room, 'b', ON);
		const c = seat(room, 'c', ON);
		const v = seat(room, 'v', OFF);
		build();
		advance(0); advance(1000);
		ctl.reaction(v, { target: 'c' });
		expect(ctl.machine.votesFor('c')).toBe(1);
		room.clients.splice(room.clients.indexOf(c), 1);
		room.state.players.delete('c');
		ctl.leave('c');
		expect(ctl.machine.contestants.has('c')).toBe(false);
		expect(ctl.machine.phase).toBe('performing'); // a and b carry on
		room.state.players.delete('b');
		ctl.leave('b');
		expect(ctl.machine.phase).toBe('idle');       // one dancer is not a contest
		expect(states().at(-1)).toBe('dissolve');
		advance(5000);                                 // and it stays quiet
		expect(ctl.machine.phase).toBe('idle');
	});

	it('a player asks for a round: needs to be on the floor, and is rate limited', () => {
		seat(room, 'a', ON);
		const b = seat(room, 'b', ON);
		const v = seat(room, 'v', OFF);
		build();
		ctl.machine.nextAt = clockNow + 1e9;
		room.handlers['dance:start'](v);
		expect(v.sent.at(-1).msg).toMatchObject({ start: false, reason: 'not-on-floor' });
		room.handlers['dance:start'](b);
		expect(ctl.machine.phase).toBe('joining');
		const before = b.sent.length;
		room.handlers['dance:start'](b);               // inside the per-player cooldown: silent
		expect(b.sent.length).toBe(before);
	});

	it('ignores reactions without a target and when not performing', () => {
		const v = seat(room, 'v', OFF);
		seat(room, 'a', ON);
		seat(room, 'b', ON);
		build();
		ctl.reaction(v, { emoji: 'x' });
		ctl.reaction(v, { target: 'a' });
		expect(v.sent).toEqual([]);
	});

	it('syncs a joiner with the current state', () => {
		const v = seat(room, 'v', OFF);
		build();
		ctl.sync(v);
		expect(v.sent[0]).toMatchObject({ type: 'dance:state', msg: { event: 'sync', phase: 'idle' } });
	});
});

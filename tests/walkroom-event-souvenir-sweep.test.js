// The event souvenir must reach everyone who is in the event world while the
// event is live, including the people who arrived before the window opened.
// Meetups open "early doors" a quarter hour ahead, so the first crowd is already
// standing in the plaza at startsAt; a grant that only runs on join would skip
// exactly the most committed attendees. The room sweeps its seated players on a
// clock, and these tests pin that sweep: it grants inside the window, never
// outside it, never in the wrong world, and announces each grant exactly once.
// The full WalkRoom needs the Colyseus runtime, so the sweep runs against a
// minimal stand-in (Object.create skips the Room constructor).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';
import { resetEventDropCache } from '../multiplayer/src/event-drop.js';
import { newProfile, ownedCosmeticSet } from '../multiplayer/src/economy.js';

const SOUVENIR_ID = 'laurel-meetup';
const EVENT_COIN = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const OTHER_COIN = 'THREEsynthetic1111111111111111111111111111';
const START = Date.parse('2026-08-09T17:00:00Z');
const END = Date.parse('2026-08-09T18:00:00Z');

const EVENT_DOC = {
	id: 'sweep-test-meetup',
	name: 'Sweep Test Meetup',
	startsAt: new Date(START).toISOString(),
	endsAt: new Date(END).toISOString(),
	link: `/play?coin=${EVENT_COIN}&name=three.ws&symbol=three`,
	souvenir: { cosmeticId: SOUVENIR_ID },
};

function makeRoom(coin) {
	const room = Object.create(WalkRoom.prototype);
	Object.defineProperty(room, 'state', { value: { coin, players: new Map() }, writable: true, configurable: true });
	Object.defineProperty(room, 'clients', { value: [], writable: true, configurable: true });
	room.econ = new Map();
	Object.defineProperty(room, 'roomId', { value: 'sweep-test', configurable: true });
	room._persistEcon = vi.fn();
	return room;
}

function seat(room, sessionId) {
	const client = { sessionId, send: vi.fn() };
	const profile = newProfile(`player-${sessionId}`);
	room.clients.push(client);
	room.state.players.set(sessionId, {});
	room.econ.set(sessionId, profile);
	return { client, profile };
}

const sent = (client, type) => client.send.mock.calls.filter(([t]) => t === type);

describe('WalkRoom event souvenir sweep', () => {
	beforeEach(() => {
		resetEventDropCache();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(EVENT_DOC), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})));
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		resetEventDropCache();
	});

	it('grants players who were already in the world when the window opened', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: START + 5_000 });
		const room = makeRoom(EVENT_COIN);
		const early = seat(room, 'early');
		const earlier = seat(room, 'earlier');

		await room._sweepEventSouvenirs();

		for (const { client, profile } of [early, earlier]) {
			expect(ownedCosmeticSet(profile).has(SOUVENIR_ID)).toBe(true);
			expect(sent(client, 'souvenir')).toHaveLength(1);
			expect(sent(client, 'souvenir')[0][1]).toMatchObject({ id: SOUVENIR_ID, eventId: 'sweep-test-meetup' });
			// Mid-session, nothing else will resend the profile, so the wardrobe
			// only learns about the new item if the sweep sends it.
			expect(sent(client, 'profile')).toHaveLength(1);
		}
		expect(room._persistEcon).toHaveBeenCalledWith('early');
		expect(room._persistEcon).toHaveBeenCalledWith('earlier');
	});

	it('announces each grant once across repeated sweeps', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: START + 5_000 });
		const room = makeRoom(EVENT_COIN);
		const { client } = seat(room, 'a');

		await room._sweepEventSouvenirs();
		await room._sweepEventSouvenirs();

		expect(sent(client, 'souvenir')).toHaveLength(1);
		expect(sent(client, 'profile')).toHaveLength(1);
	});

	it('grants nothing before the window opens or once it has closed', async () => {
		const room = makeRoom(EVENT_COIN);
		const { client, profile } = seat(room, 'a');

		vi.useFakeTimers({ toFake: ['Date'], now: START - 60_000 });
		await room._sweepEventSouvenirs();
		vi.setSystemTime(END);
		await room._sweepEventSouvenirs();

		expect(ownedCosmeticSet(profile).has(SOUVENIR_ID)).toBe(false);
		expect(client.send).not.toHaveBeenCalled();
	});

	it('grants nothing in a world other than the event world', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: START + 5_000 });
		const room = makeRoom(OTHER_COIN);
		const { client, profile } = seat(room, 'a');

		await room._sweepEventSouvenirs();

		expect(ownedCosmeticSet(profile).has(SOUVENIR_ID)).toBe(false);
		expect(client.send).not.toHaveBeenCalled();
	});

	it('skips a client whose profile has not loaded yet', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: START + 5_000 });
		const room = makeRoom(EVENT_COIN);
		const joining = { sessionId: 'joining', send: vi.fn() };
		room.clients.push(joining);

		await expect(room._sweepEventSouvenirs()).resolves.toBeUndefined();
		expect(joining.send).not.toHaveBeenCalled();
	});
});

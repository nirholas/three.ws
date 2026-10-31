// Director / projector seats: the server-side contract behind /play?director=1.
//
// A spectator joins with { spectator: true }, takes a client slot, and nothing
// else: no Player on the schema (so no peer is ever sent an avatar for it), no
// economy profile, no messages accepted, and it is left out of the lobby
// population. These tests drive the real WalkRoom hooks on a bare instance
// (Object.create skips the Colyseus constructor) plus the pure seat helpers.

import { describe, it, expect, vi } from 'vitest';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';
import {
	wantsSpectator, isSpectator, countSpectators, seatSpectator, guardSpectatorMessages,
	publishSpectatorCount, MAX_SPECTATORS_PER_ROOM,
} from '../multiplayer/src/spectator.js';

function client(id, userData = {}) {
	const c = { sessionId: id, userData, left: null, sent: [] };
	c.leave = vi.fn((code) => { c.left = code; });
	c.send = (type, msg) => c.sent.push({ type, msg });
	return c;
}

function bareRoom() {
	const room = Object.create(WalkRoom.prototype);
	Object.defineProperty(room, 'state', { value: { players: new Map() }, writable: true, configurable: true });
	room.clients = [];
	Object.defineProperty(room, 'roomId', { value: 'room-test', configurable: true });
	room.metadataSet = [];
	room.setMetadata = (m) => { room.metadataSet.push(m); return Promise.resolve(); };
	return room;
}

describe('spectator seat helpers', () => {
	it('only a literal boolean true asks for a spectator seat', () => {
		expect(wantsSpectator({ spectator: true })).toBe(true);
		for (const v of ['true', 1, 'yes', null, undefined, {}]) expect(wantsSpectator({ spectator: v })).toBe(false);
		expect(wantsSpectator(undefined)).toBe(false);
	});

	it('seats a spectator and caps the seats per room', () => {
		const clients = [];
		for (let i = 0; i < MAX_SPECTATORS_PER_ROOM; i++) {
			clients.push(client(`s${i}`, seatSpectator(clients)));
		}
		expect(countSpectators(clients)).toBe(MAX_SPECTATORS_PER_ROOM);
		expect(() => seatSpectator(clients)).toThrow('spectator_limit');
		// Players never count against the spectator cap.
		expect(() => seatSpectator([client('p1'), client('p2')])).not.toThrow();
	});

	it('a reconnecting screen retires its own ghost instead of filling the seats', () => {
		const clients = [];
		for (let i = 0; i < MAX_SPECTATORS_PER_ROOM; i++) clients.push(client(`s${i}`, seatSpectator(clients)));
		const ghost = clients[3];
		expect(() => seatSpectator(clients, MAX_SPECTATORS_PER_ROOM, 's3')).not.toThrow();
		expect(ghost.leave).toHaveBeenCalledWith(1000);
	});

	it('a prevSession naming a player is ignored, so a player cannot kick a screen or a person', () => {
		const player = client('player-1');
		const clients = [player, client('s0', { spectator: true })];
		seatSpectator(clients, MAX_SPECTATORS_PER_ROOM, 'player-1');
		expect(player.leave).not.toHaveBeenCalled();
	});
});

describe('spectator messages are dropped at the door', () => {
	it('wraps every handler registered afterwards, and lets players through', () => {
		const handlers = new Map();
		const room = { onMessage: (type, fn) => handlers.set(type, fn) };
		guardSpectatorMessages(room);
		const seen = [];
		room.onMessage('move', (c, msg) => seen.push([c.sessionId, msg]));
		room.onMessage('chat', (c, msg) => seen.push([c.sessionId, msg]));

		const spec = client('spec', { spectator: true });
		const ply = client('ply');
		handlers.get('move')(spec, { x: 1 });
		handlers.get('chat')(spec, 'hello');
		handlers.get('move')(ply, { x: 2 });
		expect(seen).toEqual([['ply', { x: 2 }]]);
	});
});

describe('WalkRoom hooks', () => {
	it('onAuth seats a spectator with a server-decided flag, never trusting the client for more', () => {
		const room = bareRoom();
		const c = client('spec');
		// Everything past the seat decision (gates, holder tiers) needs a full
		// room; the seat decision runs first and is what this test pins.
		try { room.onAuth(c, { spectator: true }); } catch { /* later gates need a real room */ }
		expect(isSpectator(c)).toBe(true);

		const p = client('ply');
		try { room.onAuth(p, { spectator: 'true' }); } catch { /* later gates need a real room */ }
		expect(isSpectator(p)).toBe(false);
	});

	it('onJoin creates no Player and no economy profile, and publishes the spectator count', async () => {
		const room = bareRoom();
		const c = client('spec', { spectator: true });
		room.clients.push(c);
		await room.onJoin(c, { spectator: true, name: 'screen' });
		expect(room.state.players.size).toBe(0);
		expect(room.metadataSet.at(-1)).toEqual({ spectators: 1 });
	});

	it('onLeave publishes the count without the leaver and touches no player state', () => {
		const room = bareRoom();
		const a = client('a', { spectator: true });
		const b = client('b', { spectator: true });
		room.clients.push(a, b);
		room.onLeave(a);
		expect(room.metadataSet.at(-1)).toEqual({ spectators: 1 });
		expect(room.state.players.size).toBe(0);
	});

	it('publishSpectatorCount survives a metadata failure and a room without setMetadata', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const room = { clients: [client('a', { spectator: true })], setMetadata: () => Promise.reject(new Error('boom')) };
		expect(() => publishSpectatorCount(room)).not.toThrow();
		await new Promise((r) => setTimeout(r, 0));
		expect(warn).toHaveBeenCalled();
		expect(() => publishSpectatorCount({ clients: [] })).not.toThrow();
		warn.mockRestore();
	});
});

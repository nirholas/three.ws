// Party service: the socket-facing half. Fake rooms and clients stand in for
// Colyseus; the store underneath is the real PartyStore on a fake clock.
import { describe, it, expect, beforeEach } from 'vitest';
import { PartyService, pickArrival, GOTO_COOLDOWN_MS } from '../multiplayer/src/party-service.js';
import { PartyStore, MemoryKV, LOC_TTL_SEC } from '../multiplayer/src/party-store.js';

function makeRoom(id, coin = 'MINT1') {
	return {
		roomId: id,
		state: { coin, tier: 'general', coinName: 'Coin', coinSymbol: 'CN', coinImage: '', players: new Map(), blocks: new Map() },
		_actionOk: () => true,
		_vehicleDrivenBy: () => null,
		broadcasts: [],
		broadcast(type, msg) { this.broadcasts.push({ type, msg }); },
	};
}

function seat(room, svc, sid, uid, name, x = 0, z = 0) {
	const client = { sessionId: sid, userData: uid ? { accountUid: uid } : { playerKey: 'g-' + sid }, log: [], send(t, m) { this.log.push({ t, m }); } };
	room.state.players.set(sid, { name, x, y: 0, z, yaw: 0, dead: false });
	svc.attach(client, room);
	return client;
}

const last = (c, type) => [...c.log].reverse().find((l) => l.m?.type === type)?.m;
const flush = () => new Promise((r) => setTimeout(r, 30));

describe('PartyService', () => {
	let clock, svc, room;
	beforeEach(() => {
		clock = { t: 5_000_000 };
		svc = new PartyService({ store: new PartyStore({ kv: new MemoryKV(() => clock.t), now: () => clock.t }), now: () => clock.t, startSweep: false });
		room = makeRoom('r1');
	});

	async function party(...names) {
		const clients = names.map((n, i) => seat(room, svc, 's' + i, 'uid' + i + '00000000', n, i * 5, 0));
		await flush();
		for (let i = 1; i < clients.length; i++) {
			await svc.handle(room, clients[0], { op: 'invite', sid: 's' + i });
			const inv = last(clients[i], 'invited');
			await svc.handle(room, clients[i], { op: 'accept', pid: inv.pid });
		}
		await flush();
		return clients;
	}

	it('invites by session, notifies the invitee, and both see each other as here after accept', async () => {
		const [a, b] = await party('Ann', 'Bo');
		const view = last(a, 'state');
		expect(view.party.members.map((m) => [m.name, m.state])).toEqual([['Ann', 'here'], ['Bo', 'here']]);
		expect(view.party.members.find((m) => m.name === 'Bo').sid).toBe('s1');
		expect(view.party.leader).toBe(view.me);
		expect(last(b, 'state').party.members).toHaveLength(2);
		expect(last(a, 'event')).toMatchObject({ ev: 'joined', name: 'Bo' });
	});

	it('tells the inviter when the target declines and clears the invite', async () => {
		const a = seat(room, svc, 's0', 'uid000000000', 'Ann');
		const b = seat(room, svc, 's1', 'uid100000000', 'Bo');
		await flush();
		await svc.handle(room, a, { op: 'invite', sid: 's1' });
		const inv = last(b, 'invited');
		expect(last(b, 'state').invites).toHaveLength(1);
		await svc.handle(room, b, { op: 'decline', pid: inv.pid });
		expect(last(a, 'event')).toMatchObject({ ev: 'declined', name: 'Bo' });
		expect(last(b, 'state').invites).toHaveLength(0);
		expect(last(a, 'state').party).toBeNull();
	});

	it('reports full, already partied and self with a reason the client can word', async () => {
		const names = Array.from({ length: 9 }, (_, i) => 'P' + i);
		const clients = names.map((n, i) => seat(room, svc, 's' + i, 'uid' + i + '00000000', n, i, 0));
		await flush();
		for (let i = 1; i < 8; i++) await svc.handle(room, clients[0], { op: 'invite', sid: 's' + i });
		await svc.handle(room, clients[0], { op: 'invite', sid: 's8' });
		expect(last(clients[0], 'result')).toMatchObject({ op: 'invite', ok: false, reason: 'full' });
		await svc.handle(room, clients[0], { op: 'invite', sid: 's0' });
		expect(last(clients[0], 'result').reason).toBe('self');
		await svc.handle(room, clients[1], { op: 'accept', pid: last(clients[1], 'invited').pid });
		await svc.handle(room, clients[2], { op: 'invite', sid: 's1' });
		expect(last(clients[2], 'result').reason).toBe('already_partied');
	});

	it('lets a guest (no account) party through the session-based invite', async () => {
		const g = seat(room, svc, 'g0', null, 'Guest A');
		const h = seat(room, svc, 'g1', null, 'Guest B');
		await flush();
		await svc.handle(room, g, { op: 'invite', sid: 'g1' });
		await svc.handle(room, h, { op: 'accept', pid: last(h, 'invited').pid });
		expect(last(g, 'state').party.members).toHaveLength(2);
	});

	it('teleports beside a party member, with a cooldown, and tells the client where', async () => {
		const [a, b] = await party('Ann', 'Bo');
		const bKey = last(a, 'state').party.members[1].key;
		await svc.handle(room, a, { op: 'goto', key: bKey });
		const warp = last(a, 'warp');
		expect(warp).toBeTruthy();
		const bo = room.state.players.get('s1');
		expect(Math.hypot(warp.x - bo.x, warp.z - bo.z)).toBeLessThan(3);
		expect(room.state.players.get('s0').x).toBe(warp.x);
		expect(room.broadcasts.at(-1).msg.type).toBe('fx');
		await svc.handle(room, a, { op: 'goto', key: bKey });
		expect(last(a, 'result')).toMatchObject({ ok: false, reason: 'cooldown' });
		clock.t += GOTO_COOLDOWN_MS + 1;
		await svc.handle(room, a, { op: 'goto', key: bKey });
		expect(last(a, 'result')).toMatchObject({ ok: true, reason: 'arrived' });
		expect(b.log.some((l) => l.m?.type === 'warp')).toBe(false);
	});

	it('refuses go-to from a downed player, to a downed player, or into a non-member', async () => {
		const [a, b, outsider] = [...(await party('Ann', 'Bo')), seat(room, svc, 's9', 'uid900000000', 'Out', 40, 40)];
		await flush();
		const bKey = last(a, 'state').party.members[1].key;
		room.state.players.get('s1').dead = true;
		await svc.handle(room, a, { op: 'goto', key: bKey });
		expect(last(a, 'result').reason).toBe('target_dead');
		room.state.players.get('s1').dead = false;
		room.state.players.get('s0').dead = true;
		await svc.handle(room, a, { op: 'goto', key: bKey });
		expect(last(a, 'result').reason).toBe('dead');
		room.state.players.get('s0').dead = false;
		await svc.handle(room, outsider, { op: 'goto', key: bKey });
		expect(last(outsider, 'result').reason).toBe('not_in_party');
		expect(room.state.players.get('s9').x).toBe(40);
	});

	it('reports other_world for a member in a different room so the client can hand off', async () => {
		const [a] = await party('Ann', 'Bo');
		const other = makeRoom('r2', 'MINT2');
		const c = seat(other, svc, 'x0', 'cafe20000000', 'Cy');
		await flush();
		await svc.store.kv.set('presence:cafe20000000', '{}', { ex: 60 });
		await svc.handle(room, a, { op: 'invite', uid: 'cafe20000000' });
		await svc.handle(other, c, { op: 'accept', pid: last(c, 'invited').pid });
		await flush();
		const view = last(a, 'state');
		const cy = view.party.members.find((m) => m.name === 'Cy');
		expect(cy.state).toBe('elsewhere');
		expect(cy.world.coin).toBe('MINT2');
		await svc.handle(room, a, { op: 'goto', key: cy.key });
		expect(last(a, 'result')).toMatchObject({ ok: false, reason: 'other_world', name: 'Cy' });
	});

	it('relays party chat to members only', async () => {
		const [a, b] = await party('Ann', 'Bo');
		const out = seat(room, svc, 's9', 'uid900000000', 'Out');
		await svc.handle(room, a, { op: 'chat', text: 'regroup at the stage' });
		expect(last(b, 'chat')).toMatchObject({ name: 'Ann', text: 'regroup at the stage' });
		expect(last(a, 'chat')).toBeTruthy();
		expect(last(out, 'chat')).toBeUndefined();
		clock.t += 10;
		await svc.handle(room, a, { op: 'chat', text: 'again' });
		expect(last(b, 'chat').text).toBe('regroup at the stage'); // 700ms cooldown on the fake clock
	});

	it('leave dissolves a two-person party and tells the other side', async () => {
		const [a, b] = await party('Ann', 'Bo');
		await svc.handle(room, b, { op: 'leave' });
		await flush();
		expect(last(a, 'state').party).toBeNull();
		expect(last(b, 'state').party).toBeNull();
		expect(last(a, 'event')).toMatchObject({ ev: 'dissolved' });
	});

	it('a hard-killed member is dropped by the sweep once the heartbeat TTL lapses', async () => {
		const [a, b] = await party('Ann', 'Bo');
		// Bo's process dies: no detach, no more heartbeats. Ann keeps heartbeating through the sweep.
		svc.entries.delete(b);
		const bKey = [...svc.byKey.keys()].find((k) => k.includes('uid1'));
		svc.byKey.delete(bKey);
		clock.t += (LOC_TTL_SEC + 5) * 1000;
		await svc.sweep();
		await svc.sweep();
		expect(await svc.store.partyOf(bKey)).toBeNull();
		expect(last(a, 'state').party).toBeNull();
	});
});

describe('pickArrival', () => {
	it('lands behind the target, facing them, and skips blocked or occupied spots', () => {
		const t = { x: 10, y: 0, z: 10, yaw: 0 };
		const spot = pickArrival(t);
		expect(Math.hypot(spot.x - t.x, spot.z - t.z)).toBeCloseTo(1.8, 1);
		expect(spot.z).toBeLessThan(t.z); // yaw 0 faces +z, so "behind" is -z
		const next = pickArrival(t, { blocked: (x, z) => Math.hypot(x - spot.x, z - spot.z) < 0.01 });
		expect(next).not.toEqual(spot);
	});
	it('returns null when the ring is boxed in or out of bounds', () => {
		expect(pickArrival({ x: 0, y: 0, z: 0, yaw: 0 }, { occupied: () => true })).toBeNull();
		expect(pickArrival({ x: 198, y: 0, z: 198, yaw: 0 }, { bound: 198 })).not.toBeNull();
		expect(pickArrival({ x: 0, y: 0, z: 0, yaw: 0 }, { bound: 0.5 })).toBeNull();
	});
});

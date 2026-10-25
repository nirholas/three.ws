// R01 — generic world-object state sync: the shared channel every later object
// feature (R02 client manager, R05 ball, R17 build-prop persistence, R18+) reuses.
// The full WalkRoom needs the Colyseus runtime, so these tests drive the pure
// object-lifecycle helpers directly against a minimal stand-in (Object.create
// avoids the Room constructor), mirroring the pattern in
// walkroom-build-perms.test.js. They lock the server-authoritative invariants a
// malicious or buggy client must not be able to break: persistence
// classification, disconnect cleanup, bounds clamping, the anti-grief prop
// guard, and the per-client op rate limiter.

import { describe, it, expect, beforeEach } from 'vitest';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';
import { WorldObject } from '../multiplayer/src/schemas.js';

function makeRoom() {
	const room = Object.create(WalkRoom.prototype);
	Object.defineProperty(room, 'state', { value: { objects: new Map() }, writable: true, configurable: true });
	room.econ = new Map();
	room._objCounters = new Map();
	return room;
}

function makeObject({ id, ownerId = 'alice', kind = '', x = 0, y = 0, z = 0 }) {
	const o = new WorldObject();
	o.id = id;
	o.ownerId = ownerId;
	o.kind = kind;
	o.x = x; o.y = y; o.z = z;
	return o;
}

describe('WalkRoom world objects (R01)', () => {
	let room;
	beforeEach(() => { room = makeRoom(); });

	describe('_objectIsPersistent', () => {
		it('treats a server-owned object as non-persistent (the R05 ball, etc.)', () => {
			const ball = makeObject({ id: 'ball_0', ownerId: 'server', kind: 'ball' });
			expect(room._objectIsPersistent(ball)).toBe(false);
		});

		it('treats every known transient kind as non-persistent regardless of owner', () => {
			for (const kind of ['ball', 'projectile', 'confetti', 'fx', 'spark', 'pickup']) {
				const o = makeObject({ id: `o_${kind}`, ownerId: 'alice', kind });
				expect(room._objectIsPersistent(o)).toBe(false);
			}
		});

		it('treats a player-owned build prop as persistent (R17 durability)', () => {
			const crate = makeObject({ id: 'crate_0', ownerId: 'alice', kind: 'prop' });
			expect(room._objectIsPersistent(crate)).toBe(true);
			// An empty kind ('') also defaults to a durable prop.
			const blank = makeObject({ id: 'blank_0', ownerId: 'alice', kind: '' });
			expect(room._objectIsPersistent(blank)).toBe(true);
		});
	});

	describe('_reapOwnerTransients (disconnect cleanup)', () => {
		it('deletes only the disconnecting owner\'s transient objects', () => {
			room.state.objects.set('ball_a', makeObject({ id: 'ball_a', ownerId: 'alice', kind: 'ball' }));
			room.state.objects.set('crate_a', makeObject({ id: 'crate_a', ownerId: 'alice', kind: 'prop' }));
			room.state.objects.set('ball_b', makeObject({ id: 'ball_b', ownerId: 'bob', kind: 'ball' }));

			room._reapOwnerTransients('alice');

			expect(room.state.objects.has('ball_a')).toBe(false);   // alice's transient — reaped
			expect(room.state.objects.has('crate_a')).toBe(true);   // alice's durable prop — survives (R17)
			expect(room.state.objects.has('ball_b')).toBe(true);    // bob's object — untouched
		});

		it('is a no-op when the owner has nothing in the room', () => {
			room.state.objects.set('crate_a', makeObject({ id: 'crate_a', ownerId: 'alice', kind: 'prop' }));
			expect(() => room._reapOwnerTransients('nobody')).not.toThrow();
			expect(room.state.objects.size).toBe(1);
		});
	});

	describe('_clampObjPos (bounds + NaN/Infinity guards)', () => {
		it('clamps an out-of-range position into the world bounds', () => {
			const o = makeObject({ id: 'o1' });
			room._clampObjPos(o, { x: 999999, y: 9999, z: -999999 });
			expect(Math.abs(o.x)).toBeLessThan(300);
			expect(Math.abs(o.z)).toBeLessThan(300);
			expect(o.y).toBeLessThanOrEqual(240);
			expect(o.y).toBeGreaterThanOrEqual(-5);
		});

		it('falls back to the current value on a non-finite payload instead of corrupting state', () => {
			const o = makeObject({ id: 'o1', x: 5, y: 1, z: 5 });
			room._clampObjPos(o, { x: NaN, y: Infinity, z: -Infinity });
			expect(o.x).toBe(5);
			expect(o.y).toBe(1);
			expect(o.z).toBe(5);
		});
	});

	describe('_propPlacementBlock (R19 anti-grief guard for obj:spawn build props)', () => {
		it('refuses a prop on the protected spawn/totem discs', () => {
			expect(room._propPlacementBlock(0, 0)).toBe('protected');   // world spawn
			expect(room._propPlacementBlock(0, -12)).toBe('protected'); // totem
			expect(room._propPlacementBlock(40, 40)).toBe(null);        // open plaza
		});

		it('caps how many durable props may sit on one density tile', () => {
			for (let i = 0; i < 4; i++) {
				room.state.objects.set(`p${i}`, makeObject({ id: `p${i}`, ownerId: 'alice', kind: 'prop', x: 40, z: 40 }));
			}
			expect(room._propPlacementBlock(40, 40)).toBe('dense');
			expect(room._propPlacementBlock(60, 60)).toBe(null); // a different tile is unaffected
		});

		it('does not count transient objects toward the density cap', () => {
			for (let i = 0; i < 6; i++) {
				room.state.objects.set(`b${i}`, makeObject({ id: `b${i}`, ownerId: 'server', kind: 'ball', x: 40, z: 40 }));
			}
			expect(room._propPlacementBlock(40, 40)).toBe(null);
		});
	});

	describe('_objOk (per-client obj:* rate limiter)', () => {
		it('allows up to OBJ_OPS_PER_SEC_LIMIT ops then rejects the rest within the window', () => {
			let allowed = 0;
			for (let i = 0; i < 40; i++) {
				if (room._objOk('s1')) allowed++;
			}
			expect(allowed).toBe(30);
		});

		it('tracks separate budgets per session', () => {
			for (let i = 0; i < 30; i++) room._objOk('s1');
			expect(room._objOk('s1')).toBe(false); // s1 exhausted
			expect(room._objOk('s2')).toBe(true);  // s2 has a fresh budget
		});
	});

	describe('_ownerKey', () => {
		it('resolves to the persisted playerId when the economy profile is loaded', () => {
			room.econ.set('sess1', { playerId: 'wallet-abc' });
			expect(room._ownerKey('sess1')).toBe('wallet-abc');
		});

		it('falls back to the raw sessionId before the profile lands', () => {
			expect(room._ownerKey('sess-unhydrated')).toBe('sess-unhydrated');
		});
	});
});

// Defence in depth for forged and uploaded props: the client holds a model to
// its device budget before it is ever placed (src/game/prop-budget.js), but the
// room is what every OTHER player trusts. So the room also refuses a prop whose
// asset is bigger than PROP_ASSET_MAX_BYTES or no longer exists, and echoes the
// client's spawn id on every refusal so the placing client can roll back the
// palette entry it armed instead of leaving a phantom button behind.
//
// probePropAsset is exercised against a real local HTTP server (no fetch stub);
// the room tests inject the probe so they stay offline and deterministic.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';
import { probePropAsset, PROP_ASSET_MAX_BYTES, MAX_OBJECTS_PER_PLAYER } from '../multiplayer/src/build-limits.js';

const GOOD_URL = 'https://pub-test.r2.dev/u/anon/forge/8f14e45f.glb';

function makeRoom(probe) {
	const room = Object.create(WalkRoom.prototype);
	Object.defineProperty(room, 'state', { value: { objects: new Map(), players: new Map(), tier: '', coin: 'THREEsynthetic1111111111111111111111111111' }, writable: true, configurable: true });
	room.econ = new Map();
	room._objCounters = new Map();
	room._objSeq = 0;
	room.coinCreator = '';
	room.blockCounts = new Map();
	room.blockOwners = new Map();
	room.columnCounts = new Map();
	room._persistObjects = () => {};
	room._assetProbe = probe;
	Object.defineProperty(room, 'roomId', { value: 'test-room' });
	return room;
}

function seat(room, sessionId) {
	room.econ.set(sessionId, { playerId: sessionId });
	room.state.players.set(sessionId, { account: '' });
	return { sessionId, sent: [], send(type, msg) { this.sent.push({ type, msg }); } };
}

describe('probePropAsset (real HTTP)', () => {
	let server;
	let base;
	beforeAll(async () => {
		server = http.createServer((req, res) => {
			if (req.url === '/big.glb') { res.writeHead(200, { 'content-length': String(PROP_ASSET_MAX_BYTES + 1) }); res.end(); return; }
			if (req.url === '/ok.glb') { res.writeHead(200, { 'content-length': String(2 * 1024 * 1024) }); res.end(); return; }
			if (req.url === '/gone.glb') { res.writeHead(404); res.end(); return; }
			res.writeHead(500); res.end();
		});
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		base = `http://127.0.0.1:${server.address().port}`;
	});
	afterAll(() => new Promise((r) => server.close(r)));

	it('refuses an asset over the per-prop byte ceiling', async () => {
		expect(await probePropAsset(`${base}/big.glb`)).toBe('asset_size');
	});

	it('passes an asset inside the ceiling', async () => {
		expect(await probePropAsset(`${base}/ok.glb`)).toBeNull();
	});

	it('refuses an asset that no longer exists', async () => {
		expect(await probePropAsset(`${base}/gone.glb`)).toBe('asset_url');
	});

	it('lets a placement through when storage cannot answer (the client already enforced the budget)', async () => {
		expect(await probePropAsset(`${base}/flaky.glb`)).toBeNull();
		expect(await probePropAsset('http://127.0.0.1:1/unreachable.glb', { timeoutMs: 500 })).toBeNull();
	});
});

describe('WalkRoom refuses oversized or unknown prop assets', () => {
	it('refuses an oversized asset and echoes the spawn id so the client can roll back', async () => {
		const room = makeRoom(async () => 'asset_size');
		const client = seat(room, 's1');
		await room._handleObjSpawn(client, { kind: 'block', type: 'u:abc', id: 'f_heavy1', x: 30, y: 0, z: 40, url: GOOD_URL });
		expect(room.state.objects.size).toBe(0);
		expect(client.sent).toEqual([{ type: 'obj:reject', msg: { reason: 'asset_size', id: 'f_heavy1' } }]);
	});

	it('refuses an off-list url with the spawn id echoed', async () => {
		const room = makeRoom(async () => null);
		const client = seat(room, 's1');
		await room._handleObjSpawn(client, { kind: 'block', type: 'u:abc', id: 'f_bad1', x: 30, y: 0, z: 40, url: 'https://evil.example.com/x.glb' });
		expect(room.state.objects.size).toBe(0);
		expect(client.sent).toEqual([{ type: 'obj:reject', msg: { reason: 'asset_url', id: 'f_bad1' } }]);
	});

	it('places an asset the probe accepts', async () => {
		const room = makeRoom(async () => null);
		const client = seat(room, 's1');
		await room._handleObjSpawn(client, { kind: 'block', type: 'u:abc', id: 'f_ok1', x: 30, y: 0, z: 40, url: GOOD_URL });
		expect(room.state.objects.get('f_ok1')?.url).toBe(GOOD_URL);
		expect(client.sent).toHaveLength(0);
	});

	it('re-checks the per-player cap after the probe, so parallel spawns cannot overshoot it', async () => {
		let release;
		const gate = new Promise((r) => { release = r; });
		const room = makeRoom(async () => { await gate; return null; });
		// Lift the per-second op limit: this test is about the cap, not the rate.
		room._objOk = () => true;
		const client = seat(room, 's1');
		const spawns = [];
		for (let i = 0; i < MAX_OBJECTS_PER_PLAYER + 3; i++) {
			spawns.push(room._handleObjSpawn(client, { kind: 'block', type: 'u:abc', id: `f_p${i}`, x: -60 - (i % 10) * 3, y: 0, z: -60 - Math.floor(i / 10) * 3, url: GOOD_URL }));
		}
		release();
		await Promise.all(spawns);
		expect(room.state.objects.size).toBe(MAX_OBJECTS_PER_PLAYER);
		expect(client.sent.map((m) => m.msg.reason)).toEqual(['player_full', 'player_full', 'player_full']);
	});
});

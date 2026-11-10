// Two real multiplayer processes against one real Redis. Proves the horizontal
// scaling claims: same-coin players land in the same room whichever instance
// they dial, and the signed /internal webhooks reach sockets/rooms hosted on a
// peer instance. Skipped (with the reason) when neither redis-server nor Docker
// is available; nothing is mocked.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Client } from 'colyseus.js';
import { startRedis, startServer, freePort } from './helpers.js';

const SECRET = 'multiplayer-test-secret';
const COIN = 'Z'.repeat(40);

let redis, redis2, a, b, c, d;
const clients = [];

const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o ?? {})).digest('base64url');
const sign = (scope, ts, payload) =>
	crypto.createHmac('sha256', SECRET).update(`${scope}:${ts}:${sha(payload)}`).digest('base64url');

async function announce(server, body) {
	const ts = Math.floor(Date.now() / 1000);
	const res = await fetch(`${server.url}/internal/announce`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-announce-signature': sign('announce', ts, body), 'x-announce-timestamp': String(ts) },
		body: JSON.stringify(body),
	});
	return res.json();
}

before(async () => {
	redis = await startRedis();
	if (!redis) return;
	const portA = await freePort();
	const portB = await freePort();
	a = await startServer({ env: { REDIS_URI: redis.uri, PORT: String(portA), PUBLIC_ADDRESS: `127.0.0.1:${portA}` } });
	b = await startServer({ env: { REDIS_URI: redis.uri, PORT: String(portB), PUBLIC_ADDRESS: `127.0.0.1:${portB}` } });
	// The Cloud Run shape: no per-instance address, so a client can be handed a
	// room owned by a peer while its socket lands on whichever instance it dialed.
	// Its own Redis so the announce test above still counts exactly two instances.
	redis2 = await startRedis();
	c = await startServer({ env: { REDIS_URI: redis2.uri, PORT: String(await freePort()) } });
	d = await startServer({ env: { REDIS_URI: redis2.uri, PORT: String(await freePort()) } });
});

after(async () => {
	for (const c of clients) { try { await c.leave(false); } catch { /* already gone */ } }
	await a?.stop();
	await b?.stop();
	await c?.stop();
	await d?.stop();
	await redis?.stop();
	await redis2?.stop();
});

test('both instances report redis presence', { skip: false }, async (t) => {
	if (!redis) return t.skip('no redis-server or docker available');
	assert.equal(a.health.presence, 'redis');
	assert.equal(b.health.presence, 'redis');
	assert.notEqual(a.health.instance, b.health.instance);
});

test('same-coin players on different instances share one room, and announce reaches both', async (t) => {
	if (!redis) return t.skip('no redis-server or docker available');
	const ca = new Client(`ws://127.0.0.1:${a.port}`);
	const cb = new Client(`ws://127.0.0.1:${b.port}`);
	const ra = await ca.joinOrCreate('walk_world', { coin: COIN, name: 'alice' });
	const rb = await cb.joinOrCreate('walk_world', { coin: COIN, name: 'bob' });
	clients.push(ra, rb);
	assert.equal(rb.roomId, ra.roomId, 'players for one coin must share a room across instances');

	const heard = [ra, rb].map((r) => new Promise((resolve) => r.onMessage('notice', resolve)));
	const body = { text: 'fanout check', coin: COIN };
	const out = await announce(a, body);
	assert.equal(out.ok, true);
	assert.equal(out.players, 2);
	const msgs = await Promise.race([Promise.all(heard), new Promise((_, rej) => setTimeout(() => rej(new Error('notice not delivered to both players')), 5000))]);
	for (const m of msgs) assert.equal(m.text, 'fanout check');
});

test('announce sent to either instance counts rooms hosted on the other', async (t) => {
	if (!redis) return t.skip('no redis-server or docker available');
	const out = await announce(b, { text: 'from b', coin: COIN });
	assert.equal(out.ok, true);
	assert.ok(out.players >= 2, `expected both players counted, got ${out.players}`);
	assert.equal(out.instances, 2);
});

test('behind one shared address, a socket landing on a peer instance still reaches its room and chat flows both ways', async (t) => {
	if (!redis) return t.skip('no redis-server or docker available');
	const coin = 'Y'.repeat(40);
	const rooms = [];
	// Alternate the dialed instance: whichever one owns the room, one of the two
	// players is guaranteed to hold a socket on a non-owner (tunnelled) instance.
	for (const [server, name] of [[c, 'carol'], [d, 'dave'], [c, 'erin'], [d, 'frank']]) {
		const client = new Client(`ws://127.0.0.1:${server.port}`);
		const room = await client.joinOrCreate('walk_world', { coin, name });
		clients.push(room);
		rooms.push(room);
	}
	assert.equal(new Set(rooms.map((r) => r.roomId)).size, 1, 'one room for the coin across both instances');
	const heard = rooms.map((r, i) => new Promise((resolve) => r.onMessage('chat', (m) => { if (m.text === 'hello fleet') resolve(i); })));
	rooms[0].send('chat', { text: 'hello fleet' });
	const got = await Promise.race([Promise.all(heard), new Promise((_, rej) => setTimeout(() => rej(new Error('chat did not reach every player')), 5000))]);
	assert.equal(got.length, 4);
});

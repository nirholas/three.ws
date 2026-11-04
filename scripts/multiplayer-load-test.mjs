#!/usr/bin/env node
// Real-WebSocket load test for the multiplayer fleet (walk_world).
//
//   node scripts/multiplayer-load-test.mjs --url wss://<service> [--clients 200] [--duration 60] [--coins 4]
//
// Opens N colyseus.js clients spread across `--coins` community worlds, each
// moving every 200 ms and sending tagged chat lines, for `--duration` seconds.
// Pass --url more than once to dial several entry points round-robin (local
// two-instance runs); against Cloud Run one URL fans out over its instances.
//
// Reports: join latency p50/p95, dropped sockets, how many distinct instances
// answered /health (the --health base, default the first --url as https), whether
// every coin collapsed into exactly ONE room id, and chat delivery: every tagged
// line should reach every client present in that room (100 percent when rooms
// are shared correctly across instances). Exit code 1 when delivery < 100 percent,
// a coin split across rooms, or any socket dropped.

import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { Client } = require('colyseus.js');

const { values } = parseArgs({
	options: {
		url: { type: 'string', multiple: true },
		health: { type: 'string' },
		clients: { type: 'string', default: '200' },
		duration: { type: 'string', default: '60' },
		coins: { type: 'string', default: '4' },
		origin: { type: 'string', default: 'https://three.ws' },
		json: { type: 'boolean', default: false },
	},
});

const urls = values.url?.length ? values.url : ['ws://127.0.0.1:2567'];
const N = Math.max(2, Number(values.clients));
const DURATION_MS = Math.max(5, Number(values.duration)) * 1000;
const COINS = Math.max(1, Math.min(N, Number(values.coins)));
const healthBase = (values.health || urls[0]).replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
const RUN = Math.random().toString(36).slice(2, 8);

// Synthetic, valid-shaped base58 mints (never a real coin): 40 chars of one letter each.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const coinFor = (i) => LETTERS[i % COINS % LETTERS.length].repeat(40);

const pct = (arr, p) => {
	if (!arr.length) return null;
	const s = [...arr].sort((a, b) => a - b);
	return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]);
};

const stats = { joinMs: [], failedJoins: 0, dropped: 0, sent: 0, expected: 0, received: 0 };
const roomsByCoin = new Map();
const live = new Map(); // coin -> Set(client state) currently joined
const states = [];

async function connect(i) {
	const coin = coinFor(i);
	const url = urls[i % urls.length];
	const client = new Client(url, { headers: { Origin: values.origin } });
	const t0 = performance.now();
	let room;
	try {
		room = await client.joinOrCreate('walk_world', { coin, name: `lt${RUN}${i}` });
	} catch (err) {
		stats.failedJoins += 1;
		console.error(`client ${i} join failed: ${err?.message || err}`);
		return null;
	}
	stats.joinMs.push(performance.now() - t0);
	if (!roomsByCoin.has(coin)) roomsByCoin.set(coin, new Set());
	roomsByCoin.get(coin).add(room.roomId);
	const st = { i, coin, room, seq: 0, open: true };
	if (!live.has(coin)) live.set(coin, new Set());
	live.get(coin).add(st);
	room.onMessage('chat', (m) => {
		if (typeof m?.text === 'string' && m.text.startsWith(`lt:${RUN}:`)) stats.received += 1;
	});
	room.onMessage('*', () => {}); // unused broadcast types (tag, notice, reaction...)
	room.onLeave((code) => {
		st.open = false;
		live.get(coin)?.delete(st);
		if (!st.finishing) stats.dropped += 1, console.error(`client ${i} dropped (code ${code})`);
	});
	room.onError((code, msg) => console.error(`client ${i} room error ${code}: ${msg}`));
	return st;
}

function drive(st) {
	let x = 0;
	const move = setInterval(() => {
		if (!st.open) return;
		x += 0.05;
		st.room.send('move', { x: Math.sin(x + st.i) * 8, y: 0, z: Math.cos(x + st.i) * 8, yaw: x % 6.28, motion: 'walk' });
	}, 200);
	const chat = setInterval(() => {
		if (!st.open) return;
		const peers = live.get(st.coin)?.size || 0;
		st.seq += 1;
		st.room.send('chat', { text: `lt:${RUN}:${st.i}:${st.seq}` });
		stats.sent += 1;
		stats.expected += peers; // the room relays to everyone present, sender included
	}, 3000 + (st.i % 10) * 100);
	st.stop = () => { clearInterval(move); clearInterval(chat); };
}

async function instancesSeen() {
	const ids = new Set();
	for (let k = 0; k < 40; k++) {
		try {
			const r = await fetch(`${healthBase}/health`);
			const j = await r.json();
			if (j.instance) ids.add(j.instance);
			if (j.presence) instancesSeen.presence = j.presence;
		} catch { /* ignore a failed probe */ }
	}
	return ids;
}

console.error(`[load] ${N} clients, ${COINS} coins, ${DURATION_MS / 1000}s, entry points: ${urls.join(', ')}`);
const joined = [];
const BATCH = 20;
for (let i = 0; i < N; i += BATCH) {
	const batch = await Promise.all(Array.from({ length: Math.min(BATCH, N - i) }, (_, k) => connect(i + k)));
	for (const st of batch) if (st) { joined.push(st); states.push(st); }
}
joined.forEach(drive);
const ids = await instancesSeen();
await new Promise((r) => setTimeout(r, DURATION_MS));
joined.forEach((st) => st.stop());
await new Promise((r) => setTimeout(r, 2500)); // let in-flight relays land
for (const st of joined) { st.finishing = true; try { await st.room.leave(true); } catch { /* already closed */ } }

const splitCoins = [...roomsByCoin.entries()].filter(([, r]) => r.size > 1).map(([c, r]) => ({ coin: c.slice(0, 4), rooms: r.size }));
const delivery = stats.expected ? (stats.received / stats.expected) * 100 : 0;
const report = {
	clients: N, joined: joined.length, failedJoins: stats.failedJoins, droppedSockets: stats.dropped,
	joinLatencyMs: { p50: pct(stats.joinMs, 50), p95: pct(stats.joinMs, 95), max: pct(stats.joinMs, 100) },
	instancesSeenOnHealth: ids.size, presence: instancesSeen.presence || 'unknown',
	roomsPerCoin: Object.fromEntries([...roomsByCoin.entries()].map(([c, r]) => [c.slice(0, 4), r.size])),
	chat: { sent: stats.sent, expectedDeliveries: stats.expected, received: stats.received, deliveryPercent: Number(delivery.toFixed(2)) },
};
console.log(values.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
const ok = delivery >= 100 && !splitCoins.length && !stats.dropped && !stats.failedJoins;
if (!ok) console.error(`[load] FAIL${splitCoins.length ? ` coins split across rooms: ${JSON.stringify(splitCoins)}` : ''}`);
process.exit(ok ? 0 : 1);

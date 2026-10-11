#!/usr/bin/env node
// Measures what one stream process pays to fan a pick out to many listeners.
// Drives the real hub (api/_lib/event-markets/hub.js) with an in-memory source
// and N fake sockets, so the number is the hub's own CPU, memory and bytes. The
// database cost is separate and does not grow with listeners: one eventsSince
// poll per tick per process, shared by every connection.
//
//   node scripts/event-markets-fanout-bench.mjs [listeners=1000] [markets=20] [rounds=20]

import { createHub } from '../api/_lib/event-markets/hub.js';
import { feedConfig } from '../api/_lib/event-markets/feed-config.js';

const [listeners = 1000, markets = 20, rounds = 20] = process.argv.slice(2).map(Number);
const log = [];
let queries = 0;
const source = {
	eventsSince: async (after, limit) => { queries++; return log.filter((r) => r.id > after).slice(0, limit); },
	latestId: async () => log.length,
	oldestId: async () => log[0]?.id ?? 0,
	snapshot: async () => ({ markets: Array.from({ length: markets }, (_, i) => ({ slug: `m${i}`, outcomes: Array.from({ length: 8 }, (_, j) => ({ id: `o${j}`, percent: 12 })) })) }),
	process: async () => {},
};
let t = Date.now();
const hub = createHub({ source, config: { ...feedConfig.stream, maxConnectionsPerIp: 1e9, maxConnectionsPerProcess: 1e9 }, now: () => t });

let frames = 0;
let bytes = 0;
const sockets = [];
for (let i = 0; i < listeners; i++) {
	const slug = i % 2 ? `m${i % markets}` : null;
	sockets.push(await hub.attach({ write: (s) => { frames++; bytes += s.length; }, end() {}, backlog: () => 0, ip: `10.0.${i >> 8}.${i & 255}`, slug }));
}
const baseFrames = frames;
const heap0 = process.memoryUsage().heapUsed;

let cpuNs = 0n;
for (let r = 0; r < rounds; r++) {
	// A burst of picks across every market, then one odds snapshot each (what processFeed writes).
	for (let m = 0; m < markets; m++) {
		log.push({ id: log.length + 1, kind: 'pick', slug: `m${m}`, outcome_id: 'o1' });
		log.push({ id: log.length + 1, kind: 'odds', slug: `m${m}`, pick_count: r, outcomes: Array.from({ length: 8 }, (_, j) => ({ id: `o${j}`, percent: 12, picks: r })) });
	}
	t += 1100;
	const s = process.hrtime.bigint();
	await hub.tick();
	cpuNs += process.hrtime.bigint() - s;
}

const sent = frames - baseFrames;
console.log(JSON.stringify({
	listeners, markets, rounds,
	source_rows_per_round: markets * 2,
	db_queries_per_round: (queries / rounds).toFixed(1),
	frames_sent: sent,
	bytes_sent: bytes,
	hub_ms_per_tick: Number(cpuNs / BigInt(rounds)) / 1e6,
	us_per_frame: (Number(cpuNs) / 1e3 / sent).toFixed(2),
	heap_mb_added: ((process.memoryUsage().heapUsed - heap0) / 1048576).toFixed(1),
}, null, 2));
hub.shutdown();

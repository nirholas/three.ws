#!/usr/bin/env node
// Event-window boundary audit for /play (docs/event-readiness/README.md).
//
// The meetup's event jobs and their payouts are gated by the multiplayer
// server's own read of the event config (multiplayer/src/event-window.js), and
// that gate must fail CLOSED. This boots the real multiplayer server once per
// window state, points its WORLD_API_BASE at a local origin serving that state's
// config, joins with the real colyseus.js client the way scripts/drive-event-e2e.mjs
// does, and checks what the SERVER says: the board's eventLive flag, whether any
// event job is offered, and whether accepting the landmark tour is allowed.
//
//   upcoming     starts in 2 h                  -> closed
//   live         started 10 min ago, ends in 2 h -> open, accept succeeds
//   ended        ended an hour ago              -> closed
//   crosses-end  ends ~25 s after the server first reads it: open, then closed,
//                and the accepted run is dropped from the log
//   unreachable  both config paths answer 503   -> closed
//   malformed    no usable startsAt             -> closed
//
// The windows are written relative to the moment of the run, so this audits the
// boundary logic, not tonight's calendar. Exit 0 only when every case holds.
//
//   node scripts/play-event-window-audit.mjs [--only live,ended] [--seed-fault]
//
// --seed-fault serves the "upcoming" config to the "live" case, so the audit must
// exit non-zero (proves it can fail).

import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'colyseus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COIN = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const TOUR = 'event-landmark-tour';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SEED_FAULT = argv.includes('--seed-fault');
const ONLY = new Set(String(opt('only', '')).split(',').filter(Boolean));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[event-window +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const children = [];

async function until(fn, ms, what) {
	const start = Date.now();
	while (!(await fn())) {
		if (Date.now() - start > ms) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
		await sleep(100);
	}
	return Date.now() - start;
}

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.once('error', reject);
		s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
	});
}

const iso = (ms) => new Date(ms).toISOString();
const doc = (startsAt, endsAt) => ({ id: 'event-window-audit', name: 'Event window audit', startsAt: iso(startsAt), endsAt: iso(endsAt) });

// A config origin for one case. `body(firstReadAt)` builds the response at
// request time; null means answer 503 (unreachable). Every other path 404s.
async function configOrigin(body) {
	const port = await freePort();
	const state = { hits: 0, firstReadAt: 0 };
	const server = http.createServer((req, res) => {
		const p = (req.url || '').split('?')[0];
		if (p !== '/api/event-config' && p !== '/event.json') { res.writeHead(404).end(); return; }
		state.hits += 1;
		state.firstReadAt ||= Date.now();
		const b = body(state.firstReadAt);
		if (b === null) { res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"down"}'); return; }
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(b));
	});
	await new Promise((r) => server.listen(port, '127.0.0.1', r));
	return { base: `http://127.0.0.1:${port}`, state, close: () => server.close() };
}

async function bootServer(apiBase) {
	const port = await freePort();
	const child = spawn(process.execPath, ['multiplayer/src/index.js'], {
		cwd: ROOT,
		env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development', WORLD_API_BASE: apiBase },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	children.push(child);
	let out = '';
	child.stdout.on('data', (d) => { out = (out + d).slice(-4000); });
	child.stderr.on('data', (d) => { out = (out + d).slice(-4000); });
	await until(() => {
		if (child.exitCode !== null) throw new Error(`multiplayer exited: ${out.slice(-400)}`);
		return /listening on ws:/.test(out);
	}, 240_000, 'the multiplayer server to listen');
	return { url: `ws://127.0.0.1:${port}`, child };
}

async function joinClient(url, name) {
	const room = await new Client(url).joinOrCreate('walk_world', {
		coin: COIN, tier: '', coinName: 'three.ws', coinSymbol: 'three', name, pid: '',
	});
	const seen = { quests: null, notices: [] };
	room.onMessage('quests', (m) => { seen.quests = m; });
	room.onMessage('notice', (m) => { if (m?.kind === 'quest') seen.notices.push(m.text || ''); });
	room.onMessage('*', () => {});
	await new Promise((r) => room.onStateChange.once(() => r()));
	room.send('ready');
	return { room, seen };
}

// Ask for the board and return the next reply.
async function board(c) {
	c.seen.quests = null;
	c.room.send('questReq');
	await until(() => !!c.seen.quests, 15_000, 'a quests reply');
	return c.seen.quests;
}

function summarize(q) {
	const eventOffers = (q?.offers || []).filter((o) => o.event).map((o) => o.id);
	const active = (q?.active || []).map((r) => r.id);
	return { live: !!q?.eventLive, eventOffers, tourActive: active.includes(TOUR) };
}

async function tryAccept(c) {
	c.seen.notices = [];
	c.room.send('questAccept', { id: TOUR });
	await sleep(1500);
	const q = summarize(await board(c));
	return { accepted: q.tourActive, notice: c.seen.notices.at(-1) || '' };
}

function expectClosed(s, a) {
	if (s.live) throw new Error('server reports eventLive: true');
	if (s.eventOffers.length) throw new Error(`event jobs offered: ${s.eventOffers.join(', ')}`);
	if (a.accepted) throw new Error('the event tour was accepted outside the window');
	if (!/only runs during the live event/.test(a.notice)) throw new Error(`refusal notice was "${a.notice}"`);
	return `closed: eventLive false, no event jobs, accept refused ("${a.notice}")`;
}

function expectOpen(s, a) {
	if (!s.live) throw new Error('server reports eventLive: false');
	if (!s.eventOffers.includes(TOUR)) throw new Error(`the tour is not offered (event jobs: ${s.eventOffers.join(', ') || 'none'})`);
	if (!a.accepted) throw new Error(`accepting the tour failed${a.notice ? ` ("${a.notice}")` : ''}`);
	return `open: eventLive true, ${s.eventOffers.length} event job(s), tour accepted`;
}

const now = Date.now();
const H = 3600_000;
const CROSS_MS = 25_000;
const CASES = [
	{ id: 'upcoming', body: () => doc(now + 2 * H, now + 3 * H), expect: 'closed' },
	{ id: 'live', body: () => (SEED_FAULT ? doc(now + 2 * H, now + 3 * H) : doc(now - 10 * 60_000, now + 2 * H)), expect: 'open' },
	{ id: 'ended', body: () => doc(now - 3 * H, now - H), expect: 'closed' },
	{ id: 'crosses-end', body: (first) => doc(now - 10 * 60_000, first + CROSS_MS), expect: 'crosses' },
	{ id: 'unreachable', body: () => null, expect: 'closed' },
	{ id: 'malformed', body: () => ({ id: 'event-window-audit', startsAt: 'soon' }), expect: 'closed' },
].filter((c) => !ONLY.size || ONLY.has(c.id));

async function runCase(cs) {
	const origin = await configOrigin(cs.body);
	try {
		const mp = await bootServer(origin.base);
		const c = await joinClient(mp.url, `Audit ${cs.id}`);
		// The room reads the config when it is created; wait for that read to land.
		await until(() => origin.state.hits > 0, 30_000, 'the server to read the config');
		await sleep(1500);
		const s = summarize(await board(c));
		const a = await tryAccept(c);
		let detail;
		if (cs.expect === 'closed') detail = expectClosed(s, a);
		else if (cs.expect === 'open') detail = expectOpen(s, a);
		else {
			const opened = expectOpen(s, a);
			const wait = origin.state.firstReadAt + CROSS_MS + 2000 - Date.now();
			if (wait > 0) await sleep(wait);
			const after = summarize(await board(c));
			if (after.live) throw new Error('still eventLive after the window ended');
			if (after.eventOffers.length) throw new Error(`event jobs still offered after the end: ${after.eventOffers.join(', ')}`);
			if (after.tourActive) throw new Error('the accepted tour run survived the end of the window');
			detail = `${opened}; after the end: closed, tour run dropped`;
		}
		await c.room.leave(true).catch(() => {});
		mp.child.kill('SIGKILL');
		return { id: cs.id, ok: true, detail };
	} catch (err) {
		return { id: cs.id, ok: false, detail: err?.message || String(err) };
	} finally {
		origin.close();
	}
}

process.on('exit', () => { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } } });
log(`${CASES.length} case(s)${SEED_FAULT ? ', seeded fault: the live case is served an upcoming window' : ''}`);
const results = await Promise.all(CASES.map(runCase));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(12)} ${r.detail}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} cases passed`);
process.exit(passed === results.length ? 0 : 1);

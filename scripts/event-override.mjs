#!/usr/bin/env node
// Change the live event's window without a deploy.
//
// Talks to /api/event-config (api/event-config.js). The API merges an operator
// override over public/event.json; the browser, the leaderboard API and the game
// server all pick it up within about a minute. Writes need OPS_SECRET (read from
// the environment or .env), sent as x-ops-secret.
//
//   npm run event:override -- --show
//   npm run event:override -- --extend 30          push the end 30 minutes later
//   npm run event:override -- --end                end the event now (cancel if not started)
//   npm run event:override -- --rename "New name"
//   npm run event:override -- --clear              the static file governs again
//   --server http://localhost:3000                 target a local API (default https://three.ws)

import fs from 'node:fs';
import { zoneLines, isoOf } from './check-event-window.mjs';

function loadDotEnv(path = '.env') {
	try {
		for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
			const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
			if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	} catch { /* no .env, rely on the environment */ }
}
loadDotEnv();

const argv = process.argv.slice(2);
const flag = (name) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? (argv[i + 1] ?? '') : null;
};
const has = (name) => argv.includes(`--${name}`);
const server = (flag('server') || 'https://three.ws').replace(/\/$/, '');
const endpoint = `${server}/api/event-config`;

function fail(msg) {
	console.error(`[event-override] ${msg}`);
	process.exit(1);
}

async function readEffective() {
	const res = await fetch(endpoint, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
	if (!res.ok) fail(`GET ${endpoint} answered HTTP ${res.status}`);
	return res.json();
}

function show(doc, label) {
	if (!doc || doc.startsAt == null) {
		console.log(`[event-override] ${label}: no event is configured`);
		return;
	}
	const s = Date.parse(doc.startsAt);
	const e = Date.parse(doc.endsAt);
	const now = Date.now();
	const state = now >= e ? 'OVER' : now >= s ? 'LIVE' : 'UPCOMING';
	console.log(`[event-override] ${label}: "${doc.name}" (${doc.id}) ${state}`);
	console.log(`[event-override]   starts ${isoOf(s)}   ends ${isoOf(e)}   (${Math.round((e - s) / 60000)} min)`);
	for (const line of zoneLines(e)) console.log(`[event-override]   ends ${line}`);
}

async function write(body) {
	const secret = process.env.OPS_SECRET;
	if (!secret) fail('OPS_SECRET is not set (export it or put it in .env). Read it with: node scripts/read-service-env.mjs');
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-ops-secret': secret },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(20000),
	});
	const payload = await res.json().catch(() => ({}));
	if (!res.ok) fail(`HTTP ${res.status}: ${payload.error_description || payload.error || 'request failed'}`);
	return payload;
}

const current = await readEffective();

if (has('show') || argv.length === 0 || (argv.length === 2 && has('server'))) {
	show(current, 'effective');
	process.exit(0);
}

let body;
if (has('clear')) body = { clear: true };
else if (has('end')) body = { end: true };
else if (flag('extend') !== null) {
	const mins = Number(flag('extend'));
	if (!Number.isFinite(mins) || mins === 0) fail('--extend needs a non-zero number of minutes');
	if (current.endsAt == null) fail('no event is configured, nothing to extend');
	body = { endsAt: isoOf(Date.parse(current.endsAt) + mins * 60000) };
} else if (flag('rename') !== null) {
	if (!flag('rename')) fail('--rename needs the new name');
	body = { name: flag('rename') };
} else fail('nothing to do. Use --show, --extend <minutes>, --end, --rename "...", or --clear');

show(current, 'before');
const result = await write(body);
show(result.effective, result.cleared ? 'after (override cleared, static file governs)' : 'after');
console.log('[event-override] readers converge within about a minute (API 15 s, game server and browser polls).');

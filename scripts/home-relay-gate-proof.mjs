#!/usr/bin/env node
/**
 * Run order 04's physical-action gate against a relayed home, from a network
 * with no route to that home, and show the audit trail it leaves.
 *
 * scripts/home-relay-e2e.mjs already drives the gate at the bridge layer, which
 * proves the transport does not swallow a refusal. This script tests the layer
 * the product actually runs: `runHomeTool`, `mintConfirmation`, the claim and
 * perform that api/home/[id]/confirm.js does, and the `home_action_log` rows
 * all of that writes. The distinction matters because the gate is enforced in
 * two places and only one of them is the bridge.
 *
 * What it asserts, in order:
 *
 *   1. three.ws holds no address and no credential for this house, so "cannot
 *      route to it" understates the position: there is nothing to route to.
 *   2. Locking up runs with no prompt. A product that nags on the safe
 *      direction is a product people turn off.
 *   3. Unlocking does NOT run. It returns a pending confirmation, and the door
 *      is still locked afterwards.
 *   4. Redeeming that confirmation really unlocks the real door, and the same
 *      confirmation cannot be redeemed twice.
 *   5. The same refusal over real HTTP, through the real
 *      `POST /api/home/:id/call` handler on a real port with a real session
 *      cookie and a real CSRF token, because the status code a client actually
 *      sees is decided there and nowhere else: an unconfirmed unlock is **409**
 *      carrying the resolved target, and the same call repeated with a person's
 *      `confirmed: true` is 200 and a door that really opens.
 *   6. Every one of those wrote a `home_action_log` row with the same columns
 *      populated as a direct connection writes, so the transport creates no
 *      audit gap.
 *
 * It is invoked by scripts/home-relay-live.mjs, which builds the unroutable rig
 * and passes the home it paired. Against a rig kept up with --keep:
 *
 *   node scripts/home-relay-gate-proof.mjs --home <uuid> --user <uuid>
 *
 * Needs DATABASE_URL, JWT_SECRET (the HTTP section mints a real session and a
 * real CSRF token) and the three HOME_RELAY_* variables in the environment.
 */

import http from 'node:http';

import { runHomeTool } from '../api/_lib/home/tools.js';
import { claimConfirmation, finalizeConfirmation } from '../api/_lib/home/confirm.js';
import { withHome, closeHome } from '../api/_lib/home/runtime.js';
import { logHomeActionNow } from '../api/_lib/home/store.js';
import { createSession } from '../api/_lib/auth.js';
import { issueCsrf } from '../api/_lib/csrf.js';
import { sql } from '../api/_lib/db.js';

const args = parseArgs(process.argv.slice(2));
const homeId = need('home');
const userId = need('user');
const ctx = { userId, source: 'api' };

const results = [];
let failures = 0;

function step(name, ok, detail) {
	results.push({ name, ok, detail });
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

// 1. The house is on a network this process cannot reach, and for a relayed
//    home there is no address stored to reach it by. Both are true; the second
//    is the stronger claim, so it is the one asserted here.
const [row] = await sql`
	select transport, relay_id, base_url, access_token_enc, token_fingerprint
	from home_connections where id = ${homeId}`;
step(
	'three.ws holds no way to dial this house directly',
	row?.transport === 'relay' && row.access_token_enc === '' && row.token_fingerprint === '' && row.base_url === `relay://${row.relay_id}`,
	`transport=${row?.transport} base_url=${row?.base_url} access_token_enc=${JSON.stringify(row?.access_token_enc)} token_fingerprint=${JSON.stringify(row?.token_fingerprint)}`,
);

// The read tool, over the relay, before anything is changed.
const status = await runHomeTool('home_status', { home_id: homeId }, ctx);
step(
	'home_status reads the house over the relay',
	status.ok === true && !status.structured?.stale,
	`rooms=${status.structured?.summary?.rooms} entities=${status.structured?.summary?.entities} locks=${status.structured?.summary?.locks} stale=${status.structured?.stale}`,
);

const lockId = await withHome(homeId, userId, (bridge) =>
	Object.keys(bridge.states).filter((id) => id.startsWith('lock.') && bridge.states[id].state !== 'unavailable').sort()[0],
);
if (!lockId) {
	step('a lock exists to gate', false, 'no lock.* entity in this house');
	await finish();
}

// 2. The safe direction, which must not prompt.
const locked = await runHomeTool('home_call', { home_id: homeId, domain: 'lock', service: 'lock', data: { entity_id: lockId } }, ctx);
step(
	'locking up runs immediately over the relay, with no prompt',
	locked.ok === true,
	`${lockId}: ok=${locked.ok} kind=${locked.kind} status=${locked.structured?.status || 'ran'}`,
);
await settleLock(lockId, 'locked');

// 3. The guarded direction, which must not run.
const refused = await runHomeTool('home_call', { home_id: homeId, domain: 'lock', service: 'unlock', data: { entity_id: lockId } }, ctx);
const pending = refused.structured?.confirmation;
step(
	'an unlock over the relay is refused and returns a pending confirmation',
	refused.ok === false && refused.kind === 'pending_confirmation' && Boolean(pending?.id),
	`ok=${refused.ok} kind=${refused.kind} status=${refused.structured?.status} risk=${pending?.risk} summary=${JSON.stringify(pending?.summary)} expires_in=${pending?.expires_in_seconds}s confirm_url=${pending?.confirm_url}`,
);
if (!pending?.id) await finish();

const heldShut = await readLock(lockId);
step(
	'the door did not move while the confirmation was pending',
	heldShut === 'locked',
	`${lockId} is ${heldShut} after the refused unlock`,
);

// 4. The redemption, performed exactly as api/home/[id]/confirm.js performs it:
//    claim the frozen action, then call with `confirmed: true` on a server that
//    is holding a redeemed claim. That flag is set in no other place.
const claim = await claimConfirmation({ id: pending.id, homeId, userId });
step('the confirmation claims once, for its owner', claim.ok === true, claim.ok ? `claimed ${pending.id}` : `${claim.reason}: ${claim.message}`);
if (!claim.ok) await finish();

const action = claim.confirmation;
let performed = null;
try {
	await withHome(homeId, userId, (bridge) => bridge.call(action.domain, action.service, action.service_data, { confirmed: true }));
	await finalizeConfirmation(action.id, 'ok');
	performed = 'ok';
} catch (err) {
	await finalizeConfirmation(action.id, 'failed');
	performed = String(err?.message || err);
}
await logHomeActionNow({
	homeId,
	userId,
	actor: 'user',
	channel: 'websocket',
	action: `${action.domain}.${action.service}`,
	entityIds: action.entity_ids,
	guarded: true,
	confirmedBy: userId,
	risk: action.risk,
	outcome: performed === 'ok' ? 'ok' : 'failed',
	detail: { confirmation_id: action.id, source: action.source },
});

const unlocked = await settleLock(lockId, 'unlocked');
step(
	'the redeemed confirmation really unlocks the real door',
	performed === 'ok' && unlocked === 'unlocked',
	`${lockId}: locked -> ${unlocked}, confirmation ${action.id} redeemed by a human's claim (${performed})`,
);

// The same confirmation must not redeem twice.
const replay = await claimConfirmation({ id: pending.id, homeId, userId });
step(
	'the same confirmation cannot be redeemed again',
	replay.ok === false,
	replay.ok ? 'a second claim on the same confirmation succeeded' : `${replay.reason}: ${replay.message}`,
);

// 5. The same gate over real HTTP.
//
// Everything above ran the tool layer in this process. The status code a client
// actually receives is decided in `api/home/[id]/call.js`, which shapes a
// NEEDS_CONFIRMATION failure into 409 through the table in
// `api/_lib/home/errors.js`, and answers a repeat carrying a person's
// `confirmed: true` by performing it. That path is transport-independent by
// construction, and the only way to show it is by driving the real handler over
// a real socket rather than reading the mapping out of the source.
//
// The section above left the door open, and a refusal proves nothing against a
// door that is already unlocked. Lock it for real rather than waiting for a
// state that would never arrive.
await runHomeTool('home_call', { home_id: homeId, domain: 'lock', service: 'lock', data: { entity_id: lockId } }, ctx);
await settleLock(lockId, 'locked');
const api = await serveHomeApi();
try {
	const cookie = `__Host-sid=${await createSession({ userId, recordActivity: false })}`;
	// A CSRF token is consumed by the request that presents it (`requireCsrf`
	// validates and deletes in one statement), so every POST below mints its own.
	// Reusing one is how this section first read a 403 and looked like a gate
	// failure when it was a spent token.
	const csrf = () => issueCsrf(userId).then((issued) => issued.token);
	const unlockBody = { domain: 'lock', service: 'unlock', data: { entity_id: lockId } };

	const refusedHttp = await api.post(`/api/home/${homeId}/call`, unlockBody, { cookie, csrf: await csrf() });
	step(
		'POST /api/home/:id/call answers an unconfirmed unlock with 409 over the relay',
		refusedHttp.status === 409 && refusedHttp.body?.error === 'needs_confirmation' && refusedHttp.body?.pending?.entityId === lockId,
		`HTTP ${refusedHttp.status} ${JSON.stringify(refusedHttp.body?.error)} pending=${JSON.stringify(refusedHttp.body?.pending)}`,
	);

	const heldByHttp = await readLock(lockId);
	step('the door did not move on the 409', heldByHttp === 'locked', `${lockId} is ${heldByHttp} after the refused HTTP unlock`);

	// The person's yes, re-POSTing the SAME call the 409 described. Same session,
	// same body, one added flag.
	const confirmedHttp = await api.post(`/api/home/${homeId}/call`, { ...unlockBody, confirmed: true }, { cookie, csrf: await csrf() });
	const openedByHttp = await settleLock(lockId, 'unlocked');
	step(
		'the same call with a human\'s confirmed:true is 200 and the real door opens',
		confirmedHttp.status === 200 && openedByHttp === 'unlocked',
		`HTTP ${confirmedHttp.status} confirmed=${confirmedHttp.body?.confirmed} risk=${confirmedHttp.body?.risk}, ${lockId}: locked -> ${openedByHttp}`,
	);
} finally {
	await api.close();
}

// Put the house back the way it was found.
await runHomeTool('home_call', { home_id: homeId, domain: 'lock', service: 'lock', data: { entity_id: lockId } }, ctx).catch(() => null);
await settleLock(lockId, 'locked');

// 6. The audit trail. Completeness is the claim, so every row is printed whole
//    rather than summarised.
const rows = await sql`
	select id, home_id, user_id, actor, channel, action, entity_ids, guarded,
	       confirmed_by, risk, outcome, detail, created_at
	from home_action_log where home_id = ${homeId} order by id asc`;
console.log(`\n---- home_action_log for the relayed home ${homeId} ----`);
for (const entry of rows) console.log(JSON.stringify(entry));
console.log('---- end action log ----\n');

// The columns a direct connection fills are the columns these must fill. The
// nullable ones (user_id, confirmed_by, risk, detail) are checked where they
// are meant to be present rather than everywhere.
const complete = (entry) =>
	Boolean(entry.home_id) && Boolean(entry.user_id) && Boolean(entry.actor) && Boolean(entry.channel) &&
	Boolean(entry.action) && Array.isArray(entry.entity_ids) && entry.entity_ids.length > 0 &&
	typeof entry.guarded === 'boolean' && Boolean(entry.outcome) && Boolean(entry.created_at);
const confirmedRow = rows.find((entry) => entry.guarded && entry.confirmed_by);
step(
	'every relayed action wrote a complete audit row',
	rows.length >= 3 && rows.every(complete) && Boolean(confirmedRow),
	`${rows.length} rows, all core columns populated: ${rows.every(complete)}. ` +
		`Refusal logged: ${rows.some((e) => e.outcome === 'refused')}. ` +
		`Confirmed row carries confirmed_by=${confirmedRow?.confirmed_by || 'none'} risk=${confirmedRow?.risk || 'none'}.`,
);

await finish();

// -------------------------------------------------------------- small parts

async function finish() {
	// closeHome is synchronous in the runtime's export surface, so it is wrapped
	// rather than awaited with a `.catch` that would not exist on its return.
	try {
		await closeHome(homeId);
	} catch {
		// The pool is being torn down anyway; a failure here would only mask the
		// result the script exists to report.
	}
	console.log(`\n${results.length - failures}/${results.length} checks passed.`);
	process.exit(failures ? 1 : 0);
}

function need(name) {
	const value = args[name];
	if (!value) {
		console.error(`Missing --${name}. See the header of this file.`);
		process.exit(2);
	}
	return value;
}

/**
 * The real `POST /api/home/:id/call` handler on a real port.
 *
 * It is a plain `(req, res)` function, which is the same shape
 * `server/index.mjs` hands it in production; the only thing missing is the
 * route table, so the path is split here the way the filesystem router splits
 * it. Nothing is stubbed: the request crosses a socket, carries a real session
 * cookie and a real CSRF header, and comes back with the status the product
 * would return.
 */
async function serveHomeApi() {
	const call = (await import('../api/home/[id]/call.js')).default;
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://127.0.0.1');
		req.query = Object.fromEntries(url.searchParams);
		req.query.id = url.pathname.split('/').filter(Boolean)[2];
		Promise.resolve(call(req, res)).catch(() => {
			if (!res.headersSent) res.writeHead(500).end('{}');
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${server.address().port}`;
	return {
		post: async (path, body, { cookie, csrf } = {}) => {
			const res = await fetch(`${base}${path}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(cookie ? { cookie } : {}),
					...(csrf ? { 'x-csrf-token': csrf } : {}),
				},
				body: JSON.stringify(body),
			});
			return { status: res.status, body: await res.json().catch(() => null) };
		},
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

async function readLock(entityId) {
	return withHome(homeId, userId, (bridge) => bridge.states[entityId]?.state);
}

/** Waits for the live state channel to report the change, not a fixed delay. */
async function settleLock(entityId, want, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	let state = await readLock(entityId);
	while (Date.now() < deadline && state !== want) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		state = await readLock(entityId);
	}
	return state;
}

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		if (!argv[i].startsWith('--')) continue;
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith('--')) {
			out[key] = next;
			i += 1;
		} else {
			out[key] = true;
		}
	}
	return out;
}

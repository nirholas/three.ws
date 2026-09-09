// The confirmation protocol over real HTTP, end to end.
//
// tests/home-tools.test.js proves the gate at the module boundary and
// tests/home-confirmation.test.js proves the record. Both call JavaScript
// functions. This file proves the same protocol the way an attacker meets it:
// over the wire, through the real MCP endpoint and the real confirm endpoint,
// with real credentials, against a real Home Assistant holding a real lock.
//
// That distinction is the reason this file exists. `claimConfirmation()` being
// correct says nothing about whether `POST /api/home/:id/confirm` refuses a
// bearer token, because the refusal lives in the handler and not in the record.
// Every assertion below reads its verdict off an HTTP status line, and every
// assertion about a door reads the door's state back out of Home Assistant.
//
// Live only, because a mocked lock cannot stay locked:
//
//   HOME_LIVE=1 HOME_ALLOW_LOCAL_INSTANCE=1 DATABASE_URL=... JWT_SECRET=... \
//     npx vitest run tests/home-confirm-endpoint.test.js
//
// `HOME_ALLOW_LOCAL_INSTANCE=1` is the seam documented in
// api/_lib/home-url-guard.js: a Home Assistant you run yourself lands on
// loopback, and the reachability guard refuses loopback in production.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import http from 'node:http';

import { acquireHomeInstance, liveHomeAvailable, pickEntity, readState, setState, waitForState } from './_helpers/home-instance.js';

const live = describe.skipIf(!liveHomeAvailable() || !process.env.DATABASE_URL || !process.env.JWT_SECRET);

/** The session cookie the platform actually sets. */
const SESSION_COOKIE = '__Host-sid';

live('the confirmation protocol over HTTP', () => {
	let sql;
	let instance;
	let confirmServer;
	let mcpServer;
	let owner;
	let stranger;
	let home;
	let otherHome;
	let lockId;
	let ownerCookie;
	let strangerCookie;
	let ownerBearer;

	beforeAll(async () => {
		instance = await acquireHomeInstance();
		({ sql } = await import('../api/_lib/db.js'));

		const { createConnection } = await import('../api/_lib/home/store.js');
		const { createSession, mintAccessToken } = await import('../api/_lib/auth.js');
		const confirmHandler = (await import('../api/home/[id]/confirm.js')).default;
		const mcpHandler = (await import('../api/mcp.js')).default;

		const stamp = Date.now();
		[owner] = await sql`insert into users (email) values (${`home-http-owner-${stamp}@qa.three.ws`}) returning id`;
		[stranger] = await sql`insert into users (email) values (${`home-http-stranger-${stamp}@qa.three.ws`}) returning id`;

		home = await createConnection({
			userId: owner.id,
			label: 'HTTP House',
			baseUrl: instance.baseUrl,
			token: instance.token,
			status: 'connected',
		});
		// A second home the same owner holds, so the cross-home replay below is
		// refused by the binding and not merely by the membership check.
		//
		// It has to reach the instance by a DIFFERENT base URL, because
		// `createConnection` upserts on `(user_id, base_url)`: connecting the same
		// address twice updates one row rather than making two, and the two ids
		// would silently be the same id. `localhost` and `127.0.0.1` are both real
		// routes to this container and the normalizer keeps them distinct.
		otherHome = await createConnection({
			userId: owner.id,
			label: 'HTTP Second House',
			baseUrl: instance.baseUrl.replace('127.0.0.1', 'localhost'),
			token: instance.token,
			status: 'connected',
		});
		expect(otherHome.id, 'the two homes must be two rows').not.toBe(home.id);

		ownerCookie = `${SESSION_COOKIE}=${await createSession({ userId: owner.id, recordActivity: false })}`;
		strangerCookie = `${SESSION_COOKIE}=${await createSession({ userId: stranger.id, recordActivity: false })}`;
		// A real OAuth access token carrying the strongest home scope there is.
		// The point of the bearer assertions below is that even THIS cannot
		// approve anything.
		ownerBearer = await mintAccessToken({
			userId: owner.id,
			clientId: 'home-confirm-endpoint-test',
			scope: 'home:read home:act',
		});

		confirmServer = await listen(confirmHandler);
		mcpServer = await listen(mcpHandler);

		lockId = await pickEntity(instance, 'lock');
		await setState(instance, 'lock', 'lock', lockId);
		await waitForState(instance, lockId, 'locked');
	}, 600_000);

	afterAll(async () => {
		if (instance && lockId) await setState(instance, 'lock', 'lock', lockId).catch(() => {});
		const { closeAll } = await import('../api/_lib/home/runtime.js');
		closeAll();
		await close(confirmServer);
		await close(mcpServer);
		if (sql && owner) await sql`delete from users where id in (${owner.id}, ${stranger.id})`;
	});

	// ── The MCP client's half ────────────────────────────────────────────────

	/**
	 * Speak real JSON-RPC to the real MCP endpoint, the way any external agent
	 * would. Nothing here is a shortcut into the handler: it is a bearer token on
	 * an HTTP request, which is exactly the principal this protocol is defending
	 * the door against.
	 */
	async function mcp(method, params, { bearer = ownerBearer } = {}) {
		const res = await fetch(`${mcpServer.url}/api/mcp`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		});
		return { status: res.status, body: await res.json().catch(() => null) };
	}

	it('publishes home_call to a real MCP client with no confirmation field in its schema', async () => {
		const listed = await mcp('tools/list', {});
		expect(listed.status).toBe(200);
		const tools = listed.body?.result?.tools || [];
		const homeCall = tools.find((t) => t.name === 'home_call');
		expect(homeCall, 'home_call must be published to an MCP client').toBeTruthy();

		// The mechanism, asserted over the wire rather than over the source: a
		// model cannot set a field that is not in the schema it was handed.
		expect(JSON.stringify(homeCall.inputSchema)).not.toMatch(/confirm/i);
		expect(homeCall.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true,
		});
	}, 60_000);

	it('answers an MCP unlock with pending_confirmation while the real lock stays locked', async () => {
		await setState(instance, 'lock', 'lock', lockId);
		await waitForState(instance, lockId, 'locked');

		const called = await mcp('tools/call', {
			name: 'home_call',
			arguments: { home_id: home.id, domain: 'lock', service: 'unlock', data: { entity_id: lockId } },
		});

		expect(called.status).toBe(200);
		const result = called.body?.result;
		// Neither an error nor a success. A model that reads this as a failure
		// goes looking for another way to open the door.
		expect(result.isError).toBeFalsy();
		expect(result.structuredContent.status).toBe('pending_confirmation');
		expect(result.structuredContent.confirmation.entity_ids).toEqual([lockId]);

		// The only assertion that means anything: the door.
		expect(await readState(instance, lockId)).toBe('locked');
	}, 60_000);

	// ── The human's half ─────────────────────────────────────────────────────

	function confirmUrl(homeId) {
		return `${confirmServer.url}/api/home/${homeId}/confirm`;
	}

	async function csrfFor(userId) {
		const { issueCsrf } = await import('../api/_lib/csrf.js');
		return (await issueCsrf(userId)).token;
	}

	/** Mint a pending confirmation the way an agent would, over MCP. */
	async function pendingUnlock({ homeId = home.id } = {}) {
		const called = await mcp('tools/call', {
			name: 'home_call',
			arguments: { home_id: homeId, domain: 'lock', service: 'unlock', data: { entity_id: lockId } },
		});
		const confirmation = called.body?.result?.structuredContent?.confirmation;
		expect(confirmation?.id, 'the agent call should have minted a confirmation').toBeTruthy();
		return confirmation;
	}

	async function post(homeId, body, { cookie = ownerCookie, csrf, bearer } = {}) {
		const res = await fetch(confirmUrl(homeId), {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(cookie ? { cookie } : {}),
				...(csrf ? { 'x-csrf-token': csrf } : {}),
				...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
			},
			body: JSON.stringify(body),
		});
		return { status: res.status, body: await res.json().catch(() => null) };
	}

	it('refuses a bearer token holding home:act, before it authenticates anything', async () => {
		const confirmation = await pendingUnlock();
		// No cookie at all: the pure machine principal.
		const res = await post(home.id, { confirmation_id: confirmation.id }, { cookie: null, bearer: ownerBearer });
		expect(res.status).toBe(403);
		expect(res.body.error).toBe('confirmation_requires_session');
		expect(await readState(instance, lockId)).toBe('locked');

		// And with a valid session ALSO present, so the refusal cannot be read as
		// "it just was not signed in". A bearer anywhere on the request is fatal.
		const both = await post(home.id, { confirmation_id: confirmation.id }, { csrf: await csrfFor(owner.id), bearer: ownerBearer });
		expect(both.status).toBe(403);
		expect(both.body.error).toBe('confirmation_requires_session');
		expect(await readState(instance, lockId)).toBe('locked');
	}, 60_000);

	it('refuses a session with no CSRF token, which is what a cross-site page can send', async () => {
		const confirmation = await pendingUnlock();
		const res = await post(home.id, { confirmation_id: confirmation.id });
		expect(res.status).toBe(403);
		expect(res.body.error).toBe('csrf_missing');
		expect(await readState(instance, lockId)).toBe('locked');
	}, 60_000);

	it('refuses a CSRF token minted for somebody else', async () => {
		const confirmation = await pendingUnlock();
		const res = await post(home.id, { confirmation_id: confirmation.id }, { csrf: await csrfFor(stranger.id) });
		expect(res.status).toBe(403);
		expect(res.body.error).toBe('csrf_invalid');
		expect(await readState(instance, lockId)).toBe('locked');
	}, 60_000);

	it('unlocks the real door for a signed-in person, and only then', async () => {
		await setState(instance, 'lock', 'lock', lockId);
		await waitForState(instance, lockId, 'locked');

		const confirmation = await pendingUnlock();
		expect(await readState(instance, lockId)).toBe('locked');

		const res = await post(home.id, { confirmation_id: confirmation.id }, { csrf: await csrfFor(owner.id) });
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.ran).toBe('lock.unlock');
		expect(res.body.entity_ids).toEqual([lockId]);

		await waitForState(instance, lockId, 'unlocked');
		expect(await readState(instance, lockId)).toBe('unlocked');

		// The row an operator reads after an incident.
		const [row] = await sql`
			select guarded, confirmed_by, outcome from home_action_log
			where home_id = ${home.id} and action = 'lock.unlock' and outcome = 'ok'
			order by created_at desc limit 1
		`;
		expect(row.guarded).toBe(true);
		expect(row.confirmed_by).toBe(owner.id);
	}, 90_000);

	it('refuses the replay of a confirmation that already ran', async () => {
		await setState(instance, 'lock', 'lock', lockId);
		await waitForState(instance, lockId, 'locked');

		const confirmation = await pendingUnlock();
		const first = await post(home.id, { confirmation_id: confirmation.id }, { csrf: await csrfFor(owner.id) });
		expect(first.status).toBe(200);
		await waitForState(instance, lockId, 'unlocked');

		// Lock it again, so a successful replay would be visible as an unlock
		// rather than hiding behind the state the first redemption left.
		await setState(instance, 'lock', 'lock', lockId);
		await waitForState(instance, lockId, 'locked');

		const replay = await post(home.id, { confirmation_id: confirmation.id }, { csrf: await csrfFor(owner.id) });
		expect(replay.status).toBe(410);
		expect(replay.body.error).toBe('confirmation_spent');
		expect(await readState(instance, lockId)).toBe('locked');
	}, 120_000);

	it('refuses a confirmation whose ninety seconds ran out', async () => {
		const confirmation = await pendingUnlock();
		// Age the row rather than waiting ninety-one seconds in a test suite. The
		// expiry is a column comparison against now(), so moving the column is the
		// same event as time passing, and it is the row the handler reads.
		await sql`update home_confirmations set expires_at = now() - interval '1 second' where id = ${confirmation.id}`;

		const res = await post(home.id, { confirmation_id: confirmation.id }, { csrf: await csrfFor(owner.id) });
		expect(res.status).toBe(410);
		expect(res.body.error).toBe('confirmation_expired');
		expect(await readState(instance, lockId)).toBe('locked');

		// An expiry is an event, not silence: somebody asked to open a door and
		// nobody answered.
		const [row] = await sql`
			select detail from home_action_log
			where home_id = ${home.id} and detail->>'confirmation_id' = ${confirmation.id}
			  and detail->>'reason' = 'confirmation_expired' limit 1
		`;
		expect(row, 'an unanswered confirmation must earn a log row').toBeTruthy();
	}, 60_000);

	it('tells a stranger nothing, and lets them redeem nothing', async () => {
		const confirmation = await pendingUnlock();
		const res = await post(home.id, { confirmation_id: confirmation.id }, { cookie: strangerCookie, csrf: await csrfFor(stranger.id) });
		// 404, not 403: a stranger must not learn that a home id is real.
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('not_found');
		expect(await readState(instance, lockId)).toBe('locked');
	}, 60_000);

	it('refuses a confirmation redeemed against a different home the same owner holds', async () => {
		const confirmation = await pendingUnlock();
		const res = await post(otherHome.id, { confirmation_id: confirmation.id }, { csrf: await csrfFor(owner.id) });
		expect(res.status).toBe(404);
		expect(res.body.error).toBe('confirmation_not_found');
		expect(await readState(instance, lockId)).toBe('locked');
	}, 60_000);

	it('ignores everything in the body except the id, so nothing can be steered', async () => {
		await setState(instance, 'lock', 'lock', lockId);
		await waitForState(instance, lockId, 'locked');

		// A caller re-sending the action alongside the ticket, aimed at a different
		// lock and a different service. The handler reads none of it.
		const otherLock = (await locksOtherThan(instance, lockId))[0];
		expect(otherLock, 'the seeded house should carry more than one lock').toBeTruthy();
		// Lock it first: the demo integration does not start every lock locked, and
		// an assertion that a door "stayed" locked proves nothing if it was open
		// the whole time.
		await setState(instance, 'lock', 'lock', otherLock);
		await waitForState(instance, otherLock, 'locked');

		const confirmation = await pendingUnlock();
		const res = await post(
			home.id,
			{
				confirmation_id: confirmation.id,
				domain: 'lock',
				service: 'unlock',
				entity_id: otherLock,
				data: { entity_id: otherLock },
				confirmed: true,
			},
			{ csrf: await csrfFor(owner.id) },
		);

		expect(res.status).toBe(200);
		// What ran is what was frozen at mint time, not what the body asked for.
		expect(res.body.entity_ids).toEqual([lockId]);
		await waitForState(instance, lockId, 'unlocked');
		expect(await readState(instance, otherLock)).toBe('locked');
	}, 120_000);

	it('refuses an unauthenticated caller outright', async () => {
		const res = await post(home.id, { confirmation_id: crypto.randomUUID() }, { cookie: null });
		expect(res.status).toBe(401);
		expect(res.body.error).toBe('unauthorized');
	}, 60_000);

	it('lists what is waiting so a chat card that lost its state can recover it', async () => {
		const confirmation = await pendingUnlock();
		const res = await fetch(confirmUrl(home.id), { headers: { cookie: ownerCookie } });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.pending.map((p) => p.id)).toContain(confirmation.id);
		// A summary a person can act on, naming the entity rather than the call.
		expect(body.pending.find((p) => p.id === confirmation.id).summary).toMatch(/unlock/i);
	}, 60_000);
});

// ── Harness ──────────────────────────────────────────────────────────────────

/**
 * Bind one API handler to a real port. The handlers are plain
 * `(req, res)` functions, so this is the same shape `server/index.mjs` gives
 * them in production, minus the route table.
 */
async function listen(handler) {
	const server = http.createServer((req, res) => {
		// `wrap` reads `req.query` the way the filesystem router populates it.
		const url = new URL(req.url, 'http://127.0.0.1');
		req.query = Object.fromEntries(url.searchParams);
		const parts = url.pathname.split('/').filter(Boolean);
		if (parts[0] === 'api' && parts[1] === 'home' && parts[3] === 'confirm') req.query.id = parts[2];
		Promise.resolve(handler(req, res)).catch(() => {
			if (!res.headersSent) res.writeHead(500).end('{}');
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function close(handle) {
	if (!handle) return Promise.resolve();
	return new Promise((resolve) => handle.server.close(resolve));
}

/** Every lock in the seeded house that is not the one under test. */
async function locksOtherThan(instance, lockId) {
	const res = await fetch(`${instance.baseUrl}/api/states`, {
		headers: { authorization: `Bearer ${instance.token}` },
	});
	const states = await res.json();
	return states.map((s) => s.entity_id).filter((id) => id.startsWith('lock.') && id !== lockId);
}

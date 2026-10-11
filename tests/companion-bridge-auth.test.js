// The companion bridge token is the credential a device holds. The desktop app,
// the CLI (`companion login`, `list`, `check`, `doctor`), the MCP server's
// `list_deliveries` tool and the stage all hand @three-ws/companion nothing but
// that token, so every route the SDK calls has to accept it, and each one must
// resolve it to exactly its owner: never to another account's feed, contacts,
// or messages. The routes that change what the companion is (contact edits,
// settings, sources) refuse it with a 403 that says so.
//
// The store is replaced by an in-memory one with the same user-scoped contract
// as api/_lib/companion/store.js (every lookup takes the caller's user id and
// misses on a row another account owns), so these tests exercise the real
// handlers, the real caller resolver, and the real SDK client end to end.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const ALICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const BOB = 'bbbbbbbb-0000-4000-8000-000000000002';
const ALICE_TOKEN = 'cmp_alice_bridge_token_0123456789abcdef';
const BOB_TOKEN = 'cmp_bob_bridge_token_0123456789abcdefgh';
const ALICE_EVENT = 'a1a1a1a1-1111-4111-8111-111111111111';
const BOB_EVENT = 'b2b2b2b2-2222-4222-8222-222222222222';

const state = {
	session: null,
	csrfCalls: [],
	rateKeys: [],
	marked: [],
	replies: [],
	polled: [],
	upserts: [],
};

function freshDb() {
	return {
		settings: {
			[ALICE]: { user_id: ALICE, ingest_token: ALICE_TOKEN, threshold: 60, enabled: true },
			[BOB]: { user_id: BOB, ingest_token: BOB_TOKEN, threshold: 40, enabled: true },
		},
		events: [
			{ id: ALICE_EVENT, user_id: ALICE, source_kind: 'telegram', title: 'Sarah: at the door', importance: 88, reply_to: { chat_id: 1, message_id: 7 } },
			{ id: BOB_EVENT, user_id: BOB, source_kind: 'telegram', title: 'Bob private message', importance: 91, reply_to: { chat_id: 2, message_id: 9 } },
		],
		contacts: [
			{ id: 'c-alice', user_id: ALICE, identifier: 'sarah', display_name: 'Sarah' },
			{ id: 'c-bob', user_id: BOB, identifier: 'carol', display_name: 'Carol' },
		],
	};
}
let db = freshDb();

// What the real queries select: the owner id and the reply routing stay server side.
function strip(row) {
	const out = { ...row };
	delete out.user_id;
	delete out.reply_to;
	return out;
}

vi.mock('../api/_lib/auth.js', () => ({
	extractBearer(req) {
		const h = req.headers.authorization || '';
		if (!h.toLowerCase().startsWith('bearer ')) return null;
		return h.slice(7).trim();
	},
	getRequestUser: vi.fn(async () => state.session),
	requestUserHasScope(user, required) {
		if (!user) return false;
		if (user.source !== 'bearer') return true;
		return String(user.scope || '').split(/\s+/).includes(required);
	},
}));

vi.mock('../api/_lib/companion/store.js', () => ({
	userForIngestToken: vi.fn(async (token) => {
		const row = Object.values(db.settings).find((s) => s.ingest_token === token);
		return row ? { ...row } : null;
	}),
	getSettings: vi.fn(async (userId) => db.settings[userId]),
	updateSettings: vi.fn(),
	rotateIngestToken: vi.fn(),
	listEvents: vi.fn(async (userId) => db.events.filter((e) => e.user_id === userId).map(strip)),
	markEvent: vi.fn(async (userId, id, flags) => {
		const row = db.events.find((e) => e.id === id && e.user_id === userId);
		if (!row) return null;
		state.marked.push({ userId, id, flags });
		return { id, delivered_at: flags.delivered ? '2026-10-09T00:00:00.000Z' : null, dismissed_at: null };
	}),
	getReplyTarget: vi.fn(async (userId, id) => {
		const row = db.events.find((e) => e.id === id && e.user_id === userId);
		if (!row) return null;
		return { ...row, source_kind_actual: 'telegram', config: { bot_token: `bot-of-${userId}` }, sender: 'Sarah' };
	}),
	recordReply: vi.fn(async (userId, id, text) => ({ id, replied_at: '2026-10-09T00:00:00.000Z', reply_text: text })),
	listContacts: vi.fn(async (userId) => db.contacts.filter((c) => c.user_id === userId).map(strip)),
	upsertContact: vi.fn(async (userId, contact) => {
		state.upserts.push({ userId, contact });
		return { id: 'c-new', ...contact };
	}),
}));

vi.mock('../api/_lib/companion/poll.js', () => ({
	pollUser: vi.fn(async (userId) => {
		state.polled.push(userId);
		return { sources: [{ kind: 'telegram', label: `bot of ${userId}`, ok: true, ingested: 0 }] };
	}),
	laneFor: () => ({
		reply: async (config, replyTo, text) => {
			state.replies.push({ config, replyTo, text });
			return { chat: 'Sarah' };
		},
	}),
}));

vi.mock('../api/_lib/csrf.js', () => ({
	requireCsrf: vi.fn(async (_req, _res, userId) => {
		state.csrfCalls.push(userId);
		return true;
	}),
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, {
		get: (_target, bucket) => async (key) => {
			state.rateKeys.push({ bucket, key });
			return { success: true };
		},
	}),
}));

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));

vi.mock('../api/_lib/llm.js', () => ({
	llmConfigured: () => false,
	llmComplete: vi.fn(),
}));

const { default: eventsHandler } = await import('../api/companion/events/index.js');
const { default: eventHandler } = await import('../api/companion/events/[id].js');
const { default: replyHandler } = await import('../api/companion/events/[id]/reply.js');
const { default: contactsHandler } = await import('../api/companion/contacts/index.js');
const { default: pollHandler } = await import('../api/companion/poll.js');
const { default: settingsHandler } = await import('../api/companion/settings.js');
const { default: checkoutHandler } = await import('../api/companion/checkout.js');
const { createCompanionClient, CompanionError } = await import('../packages/companion-sdk/src/client.js');

function makeReq({ method = 'GET', url, token = null, headers = {}, body = null, query = {} }) {
	const req = body ? Readable.from([Buffer.from(JSON.stringify(body))]) : Readable.from([]);
	req.method = method;
	req.url = url;
	req.query = query;
	req.headers = {
		host: 'three.ws',
		...(body ? { 'content-type': 'application/json' } : {}),
		...(token ? { authorization: `Bearer ${token}` } : {}),
		...headers,
	};
	return req;
}

function makeRes() {
	const headers = {};
	return {
		statusCode: 200,
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) {
			headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return headers[k.toLowerCase()];
		},
		end(chunk) {
			if (chunk !== undefined) this.body += chunk;
			this.writableEnded = true;
		},
	};
}

async function invoke(handler, opts) {
	const res = makeRes();
	await handler(makeReq(opts), res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

// Routes the SDK's fetch straight into the handlers, so the client is tested
// against the real server code rather than a canned response.
const ROUTES = [
	[/^\/api\/companion\/events$/, eventsHandler],
	[/^\/api\/companion\/events\/([^/]+)\/reply$/, replyHandler],
	[/^\/api\/companion\/events\/([^/]+)$/, eventHandler],
	[/^\/api\/companion\/contacts$/, contactsHandler],
	[/^\/api\/companion\/poll$/, pollHandler],
];

async function inProcessFetch(href, init = {}) {
	const url = new URL(href);
	const match = ROUTES.map(([re, handler]) => [url.pathname.match(re), handler]).find(([m]) => m);
	if (!match) throw new Error(`no route for ${url.pathname}`);
	const [m, handler] = match;
	const res = makeRes();
	const req = makeReq({
		method: init.method || 'GET',
		url: `${url.pathname}${url.search}`,
		headers: init.headers || {},
		body: init.body ? JSON.parse(init.body) : null,
		query: m[1] ? { id: decodeURIComponent(m[1]) } : {},
	});
	await handler(req, res);
	return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => res.body };
}

beforeEach(() => {
	db = freshDb();
	state.session = null;
	state.csrfCalls = [];
	state.rateKeys = [];
	state.marked = [];
	state.replies = [];
	state.polled = [];
	state.upserts = [];
});

describe('GET /api/companion/events with the bridge token', () => {
	it('lists only the token owner\'s deliveries', async () => {
		const { status, body } = await invoke(eventsHandler, { url: '/api/companion/events?limit=10', token: ALICE_TOKEN });
		expect(status).toBe(200);
		expect(body.events.map((e) => e.id)).toEqual([ALICE_EVENT]);
		expect(body.threshold).toBe(60);
		expect(state.rateKeys).toContainEqual({ bucket: 'companionRead', key: ALICE });
	});

	it('gives another account\'s token that account\'s feed, never alice\'s', async () => {
		const { body } = await invoke(eventsHandler, { url: '/api/companion/events', token: BOB_TOKEN });
		expect(body.events.map((e) => e.id)).toEqual([BOB_EVENT]);
	});

	it('refuses an unknown bridge token with 401, even next to a live session', async () => {
		state.session = { id: ALICE };
		const { status, body } = await invoke(eventsHandler, { url: '/api/companion/events', token: 'cmp_revoked_token_value' });
		expect(status).toBe(401);
		expect(body.error).toBe('unauthorized');
	});
});

describe('PATCH /api/companion/events/:id with the bridge token', () => {
	it('marks the owner\'s delivery spoken without a CSRF token', async () => {
		const { status, body } = await invoke(eventHandler, {
			method: 'PATCH',
			url: `/api/companion/events/${ALICE_EVENT}`,
			query: { id: ALICE_EVENT },
			token: ALICE_TOKEN,
			body: { delivered: true },
		});
		expect(status).toBe(200);
		expect(body.event.id).toBe(ALICE_EVENT);
		expect(state.marked).toEqual([{ userId: ALICE, id: ALICE_EVENT, flags: { delivered: true, dismissed: false } }]);
		expect(state.csrfCalls).toEqual([]);
	});

	it('cannot touch another account\'s delivery', async () => {
		const { status } = await invoke(eventHandler, {
			method: 'PATCH',
			url: `/api/companion/events/${BOB_EVENT}`,
			query: { id: BOB_EVENT },
			token: ALICE_TOKEN,
			body: { dismissed: true },
		});
		expect(status).toBe(404);
		expect(state.marked).toEqual([]);
	});
});

describe('POST /api/companion/events/:id/reply with the bridge token', () => {
	it('answers the owner\'s message through the owner\'s own lane', async () => {
		const { status, body } = await invoke(replyHandler, {
			method: 'POST',
			url: `/api/companion/events/${ALICE_EVENT}/reply`,
			query: { id: ALICE_EVENT },
			token: ALICE_TOKEN,
			body: { text: 'on my way down' },
		});
		expect(status).toBe(200);
		expect(body.sent).toBe(true);
		expect(state.replies).toEqual([{ config: { bot_token: `bot-of-${ALICE}` }, replyTo: { chat_id: 1, message_id: 7 }, text: 'on my way down' }]);
		expect(state.csrfCalls).toEqual([]);
	});

	it('cannot answer another account\'s message', async () => {
		const { status } = await invoke(replyHandler, {
			method: 'POST',
			url: `/api/companion/events/${BOB_EVENT}/reply`,
			query: { id: BOB_EVENT },
			token: ALICE_TOKEN,
			body: { text: 'hijack' },
		});
		expect(status).toBe(404);
		expect(state.replies).toEqual([]);
	});
});

describe('/api/companion/contacts with the bridge token', () => {
	it('reads only the owner\'s contacts', async () => {
		const { status, body } = await invoke(contactsHandler, { url: '/api/companion/contacts', token: ALICE_TOKEN });
		expect(status).toBe(200);
		expect(body.contacts.map((c) => c.display_name)).toEqual(['Sarah']);
	});

	it('cannot edit contacts', async () => {
		const { status, body } = await invoke(contactsHandler, {
			method: 'POST',
			url: '/api/companion/contacts',
			token: ALICE_TOKEN,
			body: { identifier: 'mallory', display_name: 'Mallory' },
		});
		expect(status).toBe(403);
		expect(body.error).toBe('bridge_token_not_accepted');
		expect(state.upserts).toEqual([]);
	});
});

describe('POST /api/companion/poll with the bridge token', () => {
	it('checks only the owner\'s sources, without a CSRF token', async () => {
		const { status, body } = await invoke(pollHandler, { method: 'POST', url: '/api/companion/poll', token: BOB_TOKEN });
		expect(status).toBe(200);
		expect(state.polled).toEqual([BOB]);
		expect(body.sources[0].label).toBe(`bot of ${BOB}`);
		expect(state.csrfCalls).toEqual([]);
	});
});

describe('routes the bridge token does not reach', () => {
	it('settings answers 403 bridge_token_not_accepted, so the token cannot read or rotate itself', async () => {
		const { status, body } = await invoke(settingsHandler, { url: '/api/companion/settings', token: ALICE_TOKEN });
		expect(status).toBe(403);
		expect(body.error).toBe('bridge_token_not_accepted');
	});
});

describe('session and API-key callers keep their rules', () => {
	it('a session still reads its own feed and still passes CSRF on a write', async () => {
		state.session = { id: ALICE };
		const list = await invoke(eventsHandler, { url: '/api/companion/events' });
		expect(list.body.events.map((e) => e.id)).toEqual([ALICE_EVENT]);

		await invoke(eventHandler, {
			method: 'PATCH',
			url: `/api/companion/events/${ALICE_EVENT}`,
			query: { id: ALICE_EVENT },
			body: { delivered: true },
		});
		expect(state.csrfCalls).toEqual([ALICE]);
	});

	it('an API key without the profile scope is refused with 403 insufficient_scope', async () => {
		state.session = { id: ALICE, source: 'bearer', scope: 'inference' };
		const { status, body } = await invoke(eventsHandler, { url: '/api/companion/events', token: 'sk_live_narrow' });
		expect(status).toBe(403);
		expect(body.error).toBe('insufficient_scope');
	});

	it('no credential at all is a 401', async () => {
		const { status } = await invoke(pollHandler, { method: 'POST', url: '/api/companion/poll' });
		expect(status).toBe(401);
	});
});

describe('POST /api/companion/checkout with the bridge token', () => {
	it('keys the rate limit and the model-key lookup on the owner\'s user id', async () => {
		const { status } = await invoke(checkoutHandler, {
			method: 'POST',
			url: '/api/companion/checkout',
			token: ALICE_TOKEN,
			body: { url: 'https://shop.example/checkout', text: 'Total $49.99', amounts: [{ value: 4999, role: 'total' }] },
		});
		expect(status).toBe(200);
		expect(state.rateKeys).toContainEqual({ bucket: 'companionCheckout', key: ALICE });
	});
});

describe('@three-ws/companion given only a bridge token', () => {
	const client = (token) => createCompanionClient({ token, apiBase: 'https://three.ws', fetch: inProcessFetch });

	it('list, markDelivered, reply, contacts and checkNow all succeed for the owner', async () => {
		const companion = client(ALICE_TOKEN);
		const feed = await companion.list({ limit: 1 });
		expect(feed.events.map((e) => e.id)).toEqual([ALICE_EVENT]);
		await expect(companion.markDelivered(ALICE_EVENT)).resolves.toMatchObject({ event: { id: ALICE_EVENT } });
		await expect(companion.reply(ALICE_EVENT, 'on my way')).resolves.toMatchObject({ sent: true });
		await expect(companion.contacts()).resolves.toMatchObject({ contacts: [{ display_name: 'Sarah' }] });
		await expect(companion.checkNow()).resolves.toMatchObject({ sources: [{ ok: true }] });
		expect(state.polled).toEqual([ALICE]);
	});

	it('cannot reach another account\'s delivery through the SDK either', async () => {
		const err = await client(ALICE_TOKEN).reply(BOB_EVENT, 'hijack').catch((e) => e);
		expect(err).toBeInstanceOf(CompanionError);
		expect(err.status).toBe(404);
		expect(state.replies).toEqual([]);
	});

	it('a rotated token fails with a message that says where to get the new one', async () => {
		const err = await client('cmp_rotated_away_token').list().catch((e) => e);
		expect(err.status).toBe(401);
		expect(err.message).toMatch(/three\.ws\/companion/);
	});
});

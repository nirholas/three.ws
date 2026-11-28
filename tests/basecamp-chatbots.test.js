// Basecamp chatbot command URLs on an in-process Postgres (PGlite) carrying
// the full production schema: the store (api/_lib/basecamp-chatbots.js), the
// signed-in management API (api/basecamp/chatbots.js) and the command URL
// Basecamp POSTs to (api/basecamp/command.js). Stubbed: the rate limiter, the
// CSRF check, the session lookup (the signed-in user is set per test), and the
// dispatch of a started job to its run request (a network hop, recorded here).

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';
import { invoke } from './_helpers/scim-harness.js';

const holder = vi.hoisted(() => ({ db: null, user: null, dispatched: [], limited: false }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const answer = () => ({ success: !holder.limited, limit: 10, remaining: holder.limited ? 0 : 9, reset: Date.now() + 60_000 });
	return { ...actual, clientIp: () => '203.0.113.9', limits: new Proxy({}, { get: () => async () => answer() }) };
});
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/auth.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, getRequestUser: async () => holder.user };
});
vi.mock('../api/_lib/basecamp-forge.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, dispatchRun: async (key, base) => { holder.dispatched.push({ key, base }); return 'remote'; } };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const CALLBACK = 'https://3.basecampapi.com/195539477/integrations/2uH9aHLEVhhaXKPaqrj8yw/buckets/2085958496/chats/9007199254741775/lines';
const SGID = 'BAh7CEkiCGdpZAY6BkVUSSIrZ2lkOi8vYmMzL1BlcnNvbi8xMDQ5NzE1OTEzP2V4cGlyZXNfaW4GOwBUSSIMcHVycG9zZQY7AFRJIg9hdHRhY2hhYmxlBjsAVEkiD2V4cGlyZXNfYXQGOwBUMA==--919d2c8b11ff403eefcab9db42dd26846d0c3102';

let fullPg;
let store;
let forge;
let manage;
let command;
let userId;
let otherId;

const asUser = (id) => { holder.user = id ? { id } : null; };
const api = (method, { body, query = {} } = {}) =>
	invoke(manage, { method, url: '/api/basecamp/chatbots', query, headers: { 'content-type': 'application/json', host: 'three.ws' }, body });
const send = (token, body, method = 'POST') =>
	invoke(command, { method, url: `/api/basecamp/command/${token}`, query: { token }, headers: { 'content-type': 'application/json', host: 'three.ws' }, body });
const payload = (cmd, over = {}) => ({ command: cmd, creator: { id: 1049715913, name: 'Victor Cooper', attachable_sgid: SGID }, callback_url: CALLBACK, ...over });

beforeAll(async () => {
	({ pg: fullPg } = await createFullSchemaDb());
	holder.db = createPgliteSql({ pg: fullPg });
	store = await import('../api/_lib/basecamp-chatbots.js');
	forge = await import('../api/_lib/basecamp-forge.js');
	manage = (await import('../api/basecamp/chatbots.js')).default;
	command = (await import('../api/basecamp/command.js')).default;
}, 300_000);

beforeEach(async () => {
	holder.db = createPgliteSql({ pg: fullPg });
	holder.dispatched = [];
	holder.limited = false;
	const { sql } = holder.db;
	await sql`delete from basecamp_chatbots`;
	await sql`delete from users where email like '%@basecamp.test'`;
	[{ id: userId }] = await sql`insert into users (email, display_name) values ('ada@basecamp.test', 'Ada') returning id`;
	[{ id: otherId }] = await sql`insert into users (email, display_name) values ('bo@basecamp.test', 'Bo') returning id`;
	asUser(userId);
});

describe('the command URL store', () => {
	it('stores only the hash and a four-character hint of the token', async () => {
		const { chatbot, token } = await store.createChatbot(userId, { label: '  Design   team ' });
		expect(store.isChatbotToken(token)).toBe(true);
		expect(chatbot).toMatchObject({ label: 'Design team', token_hint: token.slice(-4), command_count: 0, revoked_at: null });
		const [row] = await holder.db.sql`select * from basecamp_chatbots where id = ${chatbot.id}`;
		expect(JSON.stringify(row)).not.toContain(token);
	});

	it('resolves a token to its owner, says when it is revoked, and ignores unknown ones', async () => {
		const { chatbot, token } = await store.createChatbot(userId);
		expect(await store.resolveToken(token)).toEqual({ id: chatbot.id, userId, label: 'Basecamp', revoked: false });
		expect(await store.revokeChatbot(otherId, chatbot.id)).toBe(false);
		expect(await store.revokeChatbot(userId, chatbot.id)).toBe(true);
		expect(await store.revokeChatbot(userId, chatbot.id)).toBe(false);
		expect((await store.resolveToken(token)).revoked).toBe(true);
		expect(await store.resolveToken(store.mintToken())).toBeNull();
		expect(await store.resolveToken('bc_short')).toBeNull();
	});

	it('stops resolving the tokens of a deleted account', async () => {
		const { token } = await store.createChatbot(userId);
		await holder.db.sql`update users set deleted_at = now() where id = ${userId}`;
		expect(await store.resolveToken(token)).toBeNull();
	});

	it('limits an account to ten active URLs; revoking one frees a slot', async () => {
		const made = [];
		for (let i = 0; i < store.MAX_ACTIVE_PER_USER; i++) made.push(await store.createChatbot(userId));
		await expect(store.createChatbot(userId)).rejects.toBeInstanceOf(store.ChatbotLimitError);
		await store.revokeChatbot(userId, made[0].chatbot.id);
		await expect(store.createChatbot(userId)).resolves.toBeTruthy();
		expect(await store.listChatbots(userId)).toHaveLength(store.MAX_ACTIVE_PER_USER + 1);
	});

	it('counts commands and keeps the last Basecamp account seen', async () => {
		const { chatbot } = await store.createChatbot(userId);
		await store.recordCommand(chatbot.id, { basecampAccount: '195539477' });
		await store.recordCommand(chatbot.id);
		const [row] = await store.listChatbots(userId);
		expect(row.command_count).toBe(2);
		expect(row.last_basecamp_account).toBe('195539477');
		expect(row.last_command_at).toBeTruthy();
	});
});

describe('GET/POST/DELETE /api/basecamp/chatbots', () => {
	it('requires a signed-in account', async () => {
		asUser(null);
		expect((await api('GET')).status).toBe(401);
	});

	it('creates a URL, shows it once, and lists it without the token', async () => {
		const created = await api('POST', { body: { label: 'Design team' } });
		expect(created.status).toBe(201);
		const { command_url: url, chatbot } = JSON.parse(created.body);
		expect(url).toMatch(/^https?:\/\/[^/]+\/api\/basecamp\/command\/bc_[A-Za-z0-9_-]{43}$/);
		const listed = await api('GET');
		expect(listed.status).toBe(200);
		expect(listed.body).not.toContain(url.split('/').pop());
		expect(JSON.parse(listed.body).chatbots).toEqual([chatbot]);
	});

	it('revokes only the caller\'s own URL', async () => {
		const { chatbot } = await store.createChatbot(otherId);
		expect((await api('DELETE', { query: { id: chatbot.id } })).status).toBe(404);
		expect((await api('DELETE', { query: { id: 'nope' } })).status).toBe(400);
		const mine = await store.createChatbot(userId);
		const res = await api('DELETE', { query: { id: mine.chatbot.id } });
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body).chatbots[0].revoked_at).toBeTruthy();
	});

	it('answers 409 at the limit', async () => {
		for (let i = 0; i < store.MAX_ACTIVE_PER_USER; i++) await store.createChatbot(userId);
		const res = await api('POST', { body: {} });
		expect(res.status).toBe(409);
		expect(JSON.parse(res.body).error).toBe('limit_reached');
	});
});

describe('POST /api/basecamp/command/<token>', () => {
	it('answers every case with a 200 line for the room', async () => {
		const { token, chatbot } = await store.createChatbot(userId);
		const html = (r) => { expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/^text\/html/); return r.body; };

		expect(html(await send(store.mintToken(), payload('a chair')))).toBe(forge.unknownTokenHtml());
		expect(html(await send(token, payload('help')))).toBe(forge.helpHtml());
		expect(html(await send(token, payload('')))).toBe(forge.helpHtml());
		expect(html(await send(token, payload('hi')))).toBe(forge.tooShortHtml());
		expect(html(await send(token, payload('a chair', { callback_url: 'https://evil.example/hook' })))).toBe(forge.noCallbackHtml());
		expect(holder.dispatched).toHaveLength(0);

		await store.revokeChatbot(userId, chatbot.id);
		expect(html(await send(token, payload('a chair')))).toBe(forge.revokedHtml());
	});

	it('starts a model once, records the command, and recognises a repeat', async () => {
		const { token, chatbot } = await store.createChatbot(userId);
		const first = await send(token, payload('a brass desk lamp --draft'));
		expect(first.body).toContain('Making a 3D model (draft quality):');
		expect(first.body).toContain('a brass desk lamp');
		expect(holder.dispatched).toHaveLength(1);

		const job = await forge.loadJob(holder.dispatched[0].key);
		expect(job).toMatchObject({ prompt: 'a brass desk lamp', tier: 'draft', connectionId: chatbot.id, userId, callbackUrl: CALLBACK, state: 'starting' });
		expect(job.by).toEqual({ id: '1049715913', name: 'Victor Cooper', sgid: SGID });

		const again = await send(token, payload('a brass desk lamp --draft'));
		expect(again.body).toMatch(/^Already making that one/);
		expect(holder.dispatched).toHaveLength(1);

		const [row] = await store.listChatbots(userId);
		expect(row.command_count).toBe(1);
		expect(row.last_basecamp_account).toBe('195539477');
	});

	it('tells the room when the account is over its rate', async () => {
		const { token } = await store.createChatbot(userId);
		holder.limited = true;
		expect((await send(token, payload('a chair'))).body).toBe(forge.rateLimitedHtml());
		expect(holder.dispatched).toHaveLength(0);
	});

	it('serves a short noindex page to a browser', async () => {
		const { token } = await store.createChatbot(userId);
		const res = await send(token, undefined, 'GET');
		expect(res.status).toBe(200);
		expect(res.headers['x-robots-tag']).toBe('noindex');
		expect(res.body).toContain('This command URL is active.');
		expect((await send(store.mintToken(), undefined, 'GET')).body).toContain('This command URL is not active.');
	});
});

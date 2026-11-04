// QA, audit and e2e accounts stay off the public boards.
//
// Regression: our own sweeps sign up real production accounts and publish real
// agents and creations with them, so /characters listed "QA devnet squad Trader"
// and "Test Agent" beside real creators and /rankings ranked the QA account.
// Migration 20261105000000_users_is_test.sql adds users.is_test (backfill plus a
// BEFORE INSERT trigger); GET /api/characters, GET /api/leaderboard/unified and
// GET /api/agents/public (the /pocket roster, /agents and the live wall) filter
// on it. The handlers and the migration run for real here, against an
// in-process Postgres (PGlite).

import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => null,
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const ok = async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 });
	return { ...actual, limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});
vi.mock('../api/_lib/r2.js', () => ({ thumbnailUrl: () => null, publicUrlOrNull: () => null }));
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261105000000_users_is_test.sql', import.meta.url), 'utf8');

const REAL = '11111111-1111-4111-8111-111111111111';
const QA = '22222222-2222-4222-8222-222222222222';
const E2E = '33333333-3333-4333-8333-333333333333';
const LATE_QA = '44444444-4444-4444-8444-444444444444';

const DDL = `
	create table users (id uuid primary key, email text, username text, display_name text,
		avatar_url text, service_account boolean default false, deleted_at timestamptz);
	create table avatars (id uuid primary key default gen_random_uuid(), owner_id uuid, thumbnail_key text,
		storage_key text, visibility text default 'public', created_at timestamptz default now(),
		deleted_at timestamptz);
	create table agent_identities (
		id uuid primary key default gen_random_uuid(), user_id uuid, name text, description text,
		meta jsonb default '{}'::jsonb, avatar_id uuid, is_published boolean default true,
		is_public boolean default true, skills text[] default '{}', home_url text,
		erc8004_agent_id bigint, chain_id int,
		created_at timestamptz default now(), deleted_at timestamptz
	);
	create table agent_actions (id bigserial primary key, agent_id uuid, created_at timestamptz default now());
	create table usage_events (id bigserial primary key, agent_id uuid, kind text);
	create table forge_creations (id uuid primary key default gen_random_uuid(), user_id uuid,
		status text, glb_url text, parent_creation_id uuid);
	create table dioramas (id uuid primary key default gen_random_uuid(), user_id uuid);
`;

function mockReqRes(url) {
	const req = Object.assign(new Readable({ read() {} }), {
		method: 'GET',
		url,
		headers: {},
		query: {},
		connection: { remoteAddress: '127.0.0.1' },
		socket: { remoteAddress: '127.0.0.1' },
	});
	req.push(null);
	const chunks = [];
	const headers = {};
	const res = {
		statusCode: 200,
		writableEnded: false,
		headersSent: false,
		setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
		getHeader: (k) => headers[k.toLowerCase()],
		writeHead(code, h) { res.statusCode = code; Object.assign(headers, h || {}); },
		write: (c) => chunks.push(c),
		end(b) { if (b !== undefined) chunks.push(b); res.writableEnded = true; },
		get json() { return JSON.parse(chunks.join('') || 'null'); },
	};
	return { req, res };
}

async function call(handler, url) {
	const { req, res } = mockReqRes(url);
	await handler(req, res);
	return { status: res.statusCode, body: res.json };
}

let characters;
let unified;
let publicAgents;
let accounts;

beforeAll(async () => {
	accounts = await import('../api/_lib/test-accounts.js');
	({ default: characters } = await import('../api/characters.js'));
	({ default: unified } = await import('../api/leaderboard/unified.js'));
	({ default: publicAgents } = await import('../api/agents/public.js'));
});

beforeEach(async () => {
	accounts._resetTestUserIdsCache();
	holder.db = createPgliteSql();
	await holder.db.exec(DDL);
	await holder.db.query(
		`insert into users (id, email, username) values
		 ($1, 'maker@gmail.com', 'maker'),
		 ($2, 'qa-audit-ba37726d@users.three.ws.local', null),
		 ($3, 'home-e2e-owner-mttntnlp@qa.three.ws', null)`,
		[REAL, QA, E2E],
	);
	await holder.db.exec(MIGRATION);
});

describe('isTestAccountEmail', () => {
	it('matches the addresses our sweeps generate', () => {
		for (const email of [
			'qa-audit-ba37726d@users.three.ws.local',
			'threews-qa-audit@users.three.ws.local',
			'qa-agent-audit-1786379079@users.three.ws.local',
			'qa_alerts2_1786379249@three.ws',
			'qa.autopilot.1786379313@qa.three.ws',
			'api-audit-avatars01-1786379372@three.ws',
			'apiaudit+1786378788@three.ws',
			'labor-audit-1786582859@three.ws',
			'companion-e2e-1786379000@example.test',
			'dn-tour-mpksc2bba1ng@three.test',
		]) expect(accounts.isTestAccountEmail(email), email).toBe(true);
	});

	it('never matches a real person whose address merely contains a test-like word', () => {
		for (const email of [
			'maker@gmail.com',
			'test@gmail.com',
			'quality@three.ws',
			'aqa-dev@company.io',
			'contest.winner@mail.com',
			'qadir@outlook.com',
			'',
			null,
		]) expect(accounts.isTestAccountEmail(email), String(email)).toBe(false);
	});
});

describe('migration 20261105000000_users_is_test', () => {
	it('backfills existing QA and e2e accounts and leaves real ones alone', async () => {
		const rows = await holder.db.query('select id, is_test from users order by id');
		expect(Object.fromEntries(rows.map((r) => [r.id, r.is_test]))).toEqual({ [REAL]: false, [QA]: true, [E2E]: true });
	});

	it('marks a QA account the moment a sweep provisions it', async () => {
		await holder.db.query(`insert into users (id, email) values ($1, 'qa-audit-0d8b3833@users.three.ws.local')`, [LATE_QA]);
		const [row] = await holder.db.query('select is_test from users where id = $1', [LATE_QA]);
		expect(row.is_test).toBe(true);
	});

	it('agrees with the JS rule on every address', async () => {
		const sample = [
			'qa-audit-x@users.three.ws.local', 'apiaudit07b1786379150@three.ws', 'home-e2e-guest-mtu8gpqa@qa.three.ws',
			'x@example.test', 'maker@gmail.com', 'test@gmail.com', 'contest.winner@mail.com', 'qadir@outlook.com',
		];
		for (const email of sample) {
			const [row] = await holder.db.query('select users_is_test_email($1) as t', [email]);
			expect(row.t, email).toBe(accounts.isTestAccountEmail(email));
		}
	});

	it('is safe to re-run', async () => {
		await holder.db.exec(MIGRATION);
		const rows = await holder.db.query('select count(*)::int as n from users where is_test');
		expect(rows[0].n).toBe(2);
	});
});

describe('GET /api/characters', () => {
	it('lists real creators only', async () => {
		await holder.db.query(
			`insert into agent_identities (user_id, name, description) values
			 ($1, 'Sherlox', 'A detective'), ($2, 'QA devnet squad Trader', 'audit'),
			 ($3, 'Test Agent', 'e2e'), (null, 'Ownerless', 'seeded')`,
			[REAL, QA, E2E],
		);
		const { status, body } = await call(characters, '/api/characters?limit=10');
		expect(status).toBe(200);
		expect(body.characters.map((c) => c.name).sort()).toEqual(['Ownerless', 'Sherlox']);
	});

	it('keeps test agents out of a search and of the chats sort', async () => {
		await holder.db.query(
			`insert into agent_identities (user_id, name, description) values ($1, 'Squad One', 'x'), ($2, 'Squad Two', 'x')`,
			[REAL, QA],
		);
		await holder.db.query(`insert into usage_events (agent_id, kind) select id, 'llm' from agent_identities where user_id = $1`, [QA]);
		const search = await call(characters, '/api/characters?q=squad');
		expect(search.body.characters.map((c) => c.name)).toEqual(['Squad One']);
		const top = await call(characters, '/api/characters?sort=chats');
		expect(top.body.characters.map((c) => c.name)).toEqual(['Squad One']);
	});
});

describe('GET /api/leaderboard/unified', () => {
	it('ranks real creators contiguously with test accounts removed', async () => {
		await holder.db.query(
			`insert into forge_creations (user_id, status, glb_url) values
			 ($1, 'done', 'a.glb'), ($1, 'done', 'b.glb'), ($1, 'done', 'c.glb'),
			 ($2, 'done', 'd.glb'),
			 ($3, 'done', 'e.glb'), ($3, 'done', 'f.glb'), ($3, 'done', 'g.glb'), ($3, 'done', 'h.glb')`,
			[QA, REAL, E2E],
		);
		const { status, body } = await call(unified, '/api/leaderboard/unified?metric=creations');
		expect(status).toBe(200);
		expect(body.total).toBe(1);
		expect(body.rows).toEqual([expect.objectContaining({ userId: REAL, rank: 1, value: 1 })]);
	});
});

describe('GET /api/agents/public', () => {
	beforeEach(async () => {
		await holder.db.query(
			`insert into agent_identities (user_id, name, description) values
			 ($1, 'Sherlox', 'A detective'), ($2, 'QA devnet squad Trader', 'audit'),
			 ($3, 'E2E paper squad Trader', 'e2e')`,
			[REAL, QA, E2E],
		);
		await holder.db.query(`insert into agent_actions (agent_id) select id from agent_identities`);
	});

	for (const sort of ['popular', 'newest', 'name', 'live']) {
		it(`lists real creators' agents only (sort=${sort})`, async () => {
			const { status, body } = await call(publicAgents, `/api/agents/public?sort=${sort}&limit=24`);
			expect(status).toBe(200);
			expect(body.agents.map((a) => a.name)).toEqual(['Sherlox']);
		});
	}

	it('counts only real agents in the live wall header', async () => {
		const { body } = await call(publicAgents, '/api/agents/public?sort=live');
		expect(body.total).toBe(1);
		expect(body.active_total).toBe(1);
	});
});

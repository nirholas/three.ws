// The `launches` metric of GET /api/leaderboard/unified, driven through the real
// handler against an in-process Postgres (PGlite), so the count runs as real SQL.
//
// Regression: the board used to count agent_identities.meta.token.mint, which a
// launch signed by an agent's custodial wallet never writes, so those builders
// ranked with zero launches. The count now comes from the platform's launch
// records (pump_agent_mints, fixed_supply_launches) via api/_lib/launch-counts.js,
// which the daily badge sweep shares.

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
	return { ...actual, limits: new Proxy({}, { get: () => ok }) };
});
vi.mock('../api/_lib/r2.js', () => ({ thumbnailUrl: () => null }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const AGENT_WALLET_BUILDER = '11111111-1111-4111-8111-111111111111';
const STUDIO_BUILDER = '22222222-2222-4222-8222-222222222222';
const HIDDEN_BUILDER = '33333333-3333-4333-8333-333333333333';
// Synthetic, keyless mint-shaped strings; not anyone's coin.
const MINT = (n) => `THREEsynthetic${String(n).padStart(30, '1')}`;

const DDL = `
	create table users (id uuid primary key, username text, display_name text, deleted_at timestamptz);
	create table avatars (id uuid primary key default gen_random_uuid(), owner_id uuid, thumbnail_key text,
		created_at timestamptz default now(), deleted_at timestamptz);
	create table agent_identities (
		id uuid primary key default gen_random_uuid(), user_id uuid, name text,
		meta jsonb default '{}'::jsonb, is_public boolean default true, deleted_at timestamptz
	);
	create table pump_agent_mints (
		id uuid primary key default gen_random_uuid(), agent_id uuid, user_id uuid, network text, mint text
	);
	create table fixed_supply_launches (
		id uuid primary key default gen_random_uuid(), agent_id uuid, user_id uuid not null,
		network text not null default 'mainnet', mint text not null
	);
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

let handler;
async function launchesBoard() {
	const { req, res } = mockReqRes('/api/leaderboard/unified?metric=launches');
	await handler(req, res);
	return { status: res.statusCode, body: res.json };
}

async function agent(userId, { meta = {}, isPublic = true } = {}) {
	const [row] = await holder.db.query(
		`insert into agent_identities (user_id, name, meta, is_public) values ($1, 'Agent', $2, $3) returning id`,
		[userId, JSON.stringify(meta), isPublic],
	);
	return row.id;
}

beforeAll(async () => {
	({ default: handler } = await import('../api/leaderboard/unified.js'));
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(DDL);
	await holder.db.query(
		`insert into users (id, username) values ($1, 'agentwallet'), ($2, 'studio'), ($3, 'hidden')`,
		[AGENT_WALLET_BUILDER, STUDIO_BUILDER, HIDDEN_BUILDER],
	);
});

describe('launches metric', () => {
	it('counts a launch signed by an agent wallet, which leaves meta.token empty', async () => {
		const a = await agent(AGENT_WALLET_BUILDER);
		await holder.db.query(
			`insert into pump_agent_mints (agent_id, user_id, network, mint) values ($1, $2, 'mainnet', $3), ($1, $2, 'mainnet', $4)`,
			[a, AGENT_WALLET_BUILDER, MINT(1), MINT(2)],
		);
		const { status, body } = await launchesBoard();
		expect(status).toBe(200);
		expect(body.rows).toEqual([expect.objectContaining({ userId: AGENT_WALLET_BUILDER, value: 2, rank: 1 })]);
	});

	it('adds fixed-supply launches and counts a mint once', async () => {
		const a = await agent(STUDIO_BUILDER, { meta: { token: { mint: MINT(3) } } });
		await holder.db.query(
			`insert into pump_agent_mints (agent_id, user_id, network, mint) values ($1, $2, 'mainnet', $3)`,
			[a, STUDIO_BUILDER, MINT(3)],
		);
		await holder.db.query(
			`insert into fixed_supply_launches (agent_id, user_id, network, mint)
			 values (null, $1, 'mainnet', $2), ($3, $1, 'mainnet', $4)`,
			[STUDIO_BUILDER, MINT(4), a, MINT(3)],
		);
		const { body } = await launchesBoard();
		expect(body.rows).toEqual([expect.objectContaining({ userId: STUDIO_BUILDER, value: 2 })]);
	});

	it('leaves out devnet coins and coins of private or deleted agents', async () => {
		const priv = await agent(HIDDEN_BUILDER, { isPublic: false });
		const gone = await agent(HIDDEN_BUILDER);
		await holder.db.query(`update agent_identities set deleted_at = now() where id = $1`, [gone]);
		const live = await agent(HIDDEN_BUILDER);
		await holder.db.query(
			`insert into pump_agent_mints (agent_id, user_id, network, mint)
			 values ($1, $4, 'mainnet', $5), ($2, $4, 'mainnet', $6), ($3, $4, 'devnet', $7)`,
			[priv, gone, live, HIDDEN_BUILDER, MINT(5), MINT(6), MINT(7)],
		);
		const { body } = await launchesBoard();
		expect(body.total).toBe(0);
		expect(body.rows).toEqual([]);
	});
});

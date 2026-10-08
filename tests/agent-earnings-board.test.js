// GET /api/leaderboard/earnings against GET /api/agents/:id/earnings, both
// driven through their real handlers over an in-process Postgres (PGlite).
//
// The board and each agent's Earned card share one read model, and the promise
// is that a row and the agent's page never disagree. These tests seed creator
// fees (lifetime totals and fee buckets), skill sales and hires across every
// window, then hold each board row to the agent's own figures, its rank, and
// the attribution rules (custodial wallet only, public agents only, devnet out).
// scripts/check-earnings-board.mjs runs the same comparison on live data.

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
vi.mock('../api/_lib/sol-price.js', () => ({ solPriceUsd: async () => 100 }));
vi.mock('../api/_lib/r2.js', () => ({ publicUrl: (k) => `https://three.ws/cdn/${k}` }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Synthetic, keyless base58-shaped strings; not anyone's wallet or coin.
const WALLET = (n) => `THREEsyntheticWa11et${String(n).padStart(24, '1')}`;
const MINT = (n) => `THREEsyntheticMint${String(n).padStart(26, '1')}`;
const DAY = 86_400_000;

const DDL = `
	create table avatars (id uuid primary key default gen_random_uuid(), thumbnail_key text, visibility text,
		deleted_at timestamptz);
	create table agent_identities (
		id uuid primary key default gen_random_uuid(), user_id uuid, name text, avatar_id uuid,
		meta jsonb default '{}'::jsonb, is_public boolean default true, deleted_at timestamptz
	);
	create table pump_agent_mints (
		id uuid primary key default gen_random_uuid(), agent_id uuid, network text, mint text,
		name text, symbol text, created_at timestamptz default now()
	);
	create table agent_coin_earnings (
		mint text, network text, agent_id uuid, creator text, earned_lamports numeric,
		claimed_lamports numeric, unclaimed_lamports numeric, wallet_coin_count int, wallet_agent_count int,
		source text, error text, refreshed_at timestamptz default now(), attempted_at timestamptz default now(),
		primary key (mint, network)
	);
	create table creator_fee_buckets (creator text, bucket_interval text, bucket_start timestamptz, fee_lamports numeric);
	create table agent_revenue_events (
		id uuid primary key default gen_random_uuid(), agent_id uuid, net_amount numeric, currency_mint text,
		created_at timestamptz
	);
	create table agent_hires (
		id uuid primary key default gen_random_uuid(), provider_agent_id uuid, usd numeric, status text,
		created_at timestamptz, completed_at timestamptz
	);
	create table launcher_claims (agent_id uuid, network text, claim_sig text, claimed_lamports numeric, mint text,
		created_at timestamptz default now());
	create table agent_actions (agent_id uuid, type text, payload jsonb, created_at timestamptz default now());
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
	return { req, res, headers };
}

let boardHandler;
let agentHandler;
async function call(handler, url) {
	const { req, res, headers } = mockReqRes(url);
	await handler(req, res);
	return { status: res.statusCode, body: res.json, headers };
}
const board = (qs) => call(boardHandler, `/api/leaderboard/earnings?${qs}`);
const mine = (id, window) => call(agentHandler, `/api/agents/${id}/earnings?id=${id}&window=${window}`);

async function agent(name, n, { isPublic = true } = {}) {
	const [row] = await holder.db.query(
		`insert into agent_identities (name, meta, is_public) values ($1, $2, $3) returning id`,
		[name, JSON.stringify({ solana_address: WALLET(n) }), isPublic],
	);
	return row.id;
}

/** A mainnet coin whose fees go to `creator`, with lifetime totals and buckets. */
async function coin(agentId, n, creator, { lifetime, buckets = [], network = 'mainnet', walletAgents = 1 }) {
	await holder.db.query(
		`insert into pump_agent_mints (agent_id, network, mint, name, symbol) values ($1, $2, $3, $4, $5)`,
		[agentId, network, MINT(n), `Coin ${n}`, `C${n}`],
	);
	await holder.db.query(
		`insert into agent_coin_earnings (mint, network, agent_id, creator, earned_lamports, claimed_lamports,
		   unclaimed_lamports, wallet_coin_count, wallet_agent_count, source)
		 values ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'pumpfun_creator_fees')`,
		[MINT(n), network, agentId, creator, lifetime, Math.floor(lifetime / 2), lifetime - Math.floor(lifetime / 2), walletAgents],
	);
	for (const [interval, agoMs, lamports] of buckets) {
		const start = interval === '1d' ? Math.floor((Date.now() - agoMs) / DAY) * DAY : Date.now() - agoMs;
		await holder.db.query(
			`insert into creator_fee_buckets (creator, bucket_interval, bucket_start, fee_lamports) values ($1, $2, $3, $4)`,
			[creator, interval, new Date(start).toISOString(), lamports],
		);
	}
}

const ago = (ms) => new Date(Date.now() - ms).toISOString();

let ids;
beforeAll(async () => {
	({ default: boardHandler } = await import('../api/leaderboard/earnings.js'));
	({ default: agentHandler } = await import('../api/agents/[id]/earnings.js'));
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(DDL);
	const fees = await agent('Fees', 1);
	const seller = await agent('Seller', 2);
	const mixed = await agent('Mixed', 3);
	const hidden = await agent('Hidden', 4, { isPublic: false });
	const sponsored = await agent('Sponsored', 5);
	ids = { fees, seller, mixed, hidden, sponsored };

	// Fees: 3 SOL lifetime, 0.4 SOL in the last 24h, 1 SOL three days ago, 0.5 SOL twenty days ago.
	await coin(fees, 1, WALLET(1), {
		lifetime: 3_000_000_000,
		buckets: [
			['30m', 3_600_000, 400_000_000],
			['1d', 0, 400_000_000],
			['1d', 3 * DAY, 1_000_000_000],
			['1d', 20 * DAY, 500_000_000],
			['1d', 9 * DAY, 2_000_000_000],
		],
	});
	// A devnet coin on the same agent never counts.
	await coin(fees, 2, WALLET(1), { lifetime: 9_000_000_000, network: 'devnet' });

	// Seller: $50 of skill sales yesterday-ish and a $30 hire ten days ago.
	await holder.db.query(
		`insert into agent_revenue_events (agent_id, net_amount, currency_mint, created_at)
		 values ($1, 20000000, $2, $3), ($1, 30000000, $2, $4)`,
		[seller, USDC, ago(2 * 3_600_000), ago(2 * DAY)],
	);
	await holder.db.query(
		`insert into agent_hires (provider_agent_id, usd, status, created_at, completed_at)
		 values ($1, 30, 'completed', $2, $2), ($1, 999, 'failed', $3, null)`,
		[seller, ago(10 * DAY), ago(DAY / 2)],
	);

	// Mixed: 1 SOL lifetime in fees (0.2 SOL today) plus one $40 sale this week.
	await coin(mixed, 3, WALLET(3), {
		lifetime: 1_000_000_000,
		buckets: [['30m', 1_800_000, 200_000_000], ['1d', 0, 200_000_000]],
	});
	await holder.db.query(
		`insert into agent_revenue_events (agent_id, net_amount, currency_mint, created_at) values ($1, 40000000, $2, $3)`,
		[mixed, USDC, ago(4 * DAY)],
	);

	// Hidden: a private agent with a large income never appears on the board.
	await coin(hidden, 4, WALLET(4), { lifetime: 50_000_000_000, buckets: [['30m', 600_000, 5_000_000_000]] });

	// Sponsored: its coin pays someone else's wallet, so it is listed on its page but not counted.
	await coin(sponsored, 5, WALLET(99), { lifetime: 7_000_000_000, buckets: [['30m', 600_000, 1_000_000_000]] });
});

describe('GET /api/leaderboard/earnings', () => {
	it('ranks public agents by creator fees plus service income, newest-window first by default', async () => {
		const { status, body, headers } = await board('');
		expect(status).toBe(200);
		expect(body.window).toBe('7d');
		expect(headers['cache-control']).toMatch(/public/);
		expect(typeof body.method).toBe('string');
		// 7d: Fees 1.4 SOL; Mixed 0.2 SOL + $40 (0.4 SOL) = 0.6; Seller $50 = 0.5.
		expect(body.rows.map((r) => [r.agent.name, r.total.sol])).toEqual([
			['Fees', 1.4],
			['Mixed', 0.6],
			['Seller', 0.5],
		]);
		expect(body.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
		expect(body.rows[1]).toMatchObject({
			creator_fees: { sol: 0.2, usd: 20 },
			service_income: { skill_sales_usd: 40, skill_sales_count: 1, hires_usd: 0, usd: 40, sol: 0.4 },
			coin: { symbol: 'C3', url: `/launches/${MINT(3)}` },
		});
	});

	it('leaves out private agents, devnet coins and fees paid to another wallet', async () => {
		for (const window of ['24h', '7d', '30d', 'all']) {
			const { body } = await board(`window=${window}`);
			const names = body.rows.map((r) => r.agent.name);
			expect(names).not.toContain('Hidden');
			expect(names).not.toContain('Sponsored');
		}
		const { body } = await board('window=all');
		expect(body.rows.find((r) => r.agent.name === 'Fees').creator_fees.sol).toBe(3);
	});

	it('reports movement against the previous window', async () => {
		const { body } = await board('window=7d');
		const byName = Object.fromEntries(body.rows.map((r) => [r.agent.name, r]));
		// The 7 days before this week: Fees earned 2 SOL, Seller a $30 hire, Mixed nothing.
		expect(byName.Fees).toMatchObject({ previous_rank: 1, movement: 0 });
		expect(byName.Seller).toMatchObject({ previous_rank: 2, movement: -1 });
		expect(byName.Mixed).toMatchObject({ previous_rank: null, movement: 'new' });
		const all = await board('window=all');
		expect(all.body.rows.every((r) => r.movement === null)).toBe(true);
	});

	it('paginates without changing anyone\'s rank', async () => {
		const full = await board('window=30d');
		const first = await board('window=30d&limit=2&offset=0');
		const second = await board('window=30d&limit=2&offset=2');
		expect(first.body.total).toBe(full.body.total);
		expect([...first.body.rows, ...second.body.rows].map((r) => [r.rank, r.agent.id])).toEqual(
			full.body.rows.map((r) => [r.rank, r.agent.id]),
		);
	});

	it('shows an empty board as an empty list, not an error', async () => {
		await holder.db.exec(`delete from agent_coin_earnings; delete from agent_revenue_events; delete from agent_hires;`);
		const { status, body } = await board('window=24h');
		expect(status).toBe(200);
		expect(body).toMatchObject({ total: 0, rows: [] });
	});
});

describe('the board agrees with every agent\'s own earnings', () => {
	it.each(['24h', '7d', '30d', 'all'])('window %s', async (window) => {
		const { body } = await board(`window=${window}&limit=100`);
		expect(body.rows.length).toBeGreaterThan(0);
		let boardSol = 0;
		let pageSol = 0;
		for (const row of body.rows) {
			const { status, body: own } = await mine(row.agent.id, window);
			expect(status).toBe(200);
			expect(own.creator_fees).toEqual(row.creator_fees);
			expect(own.service_income).toEqual(row.service_income);
			expect(own.total).toEqual(row.total);
			if (window !== 'all') expect(own.rank).toMatchObject({ window, position: row.rank, of: body.total });
			boardSol += row.total.sol;
			pageSol += own.total.sol;
		}
		expect(boardSol).toBeCloseTo(pageSol, 9);
	});

	it('an agent outside the board answers zero, and its rank is null', async () => {
		const { body } = await mine(ids.sponsored, '7d');
		expect(body.total.sol).toBe(0);
		expect(body.rank).toBeNull();
		expect(body.coins[0]).toMatchObject({ status: 'other_wallet', earned_sol: 7 });
	});
});

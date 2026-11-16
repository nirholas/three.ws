// Spotlight verified results, story consent, /stories and moderation.
//
// Drives the real /api/spotlight/[action] handler against an in-process
// Postgres (PGlite) built from the real agent_showcase migrations, so every
// WHERE clause that decides who appears where (consent, owner match, hidden
// status) runs as real SQL. The only mocked seams are the session, CSRF, rate
// limits, the audit sink, and the agent earnings read model (order 015), whose
// own suite covers it.

import { readFileSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));
const authState = vi.hoisted(() => ({ session: null }));
const audits = vi.hoisted(() => []);

// Admin sessions here have passed two-step verification; that rule has its own
// suite (tests/admin-mfa.test.js).
vi.mock('../api/_lib/admin-mfa.js', async (importActual) => ({ ...(await importActual()), sessionPassedMfa: async () => true }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => authState.session,
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/audit.js', () => ({
	logAudit: (entry) => audits.push(entry),
	logAuditNow: async (entry) => (audits.push(entry), true),
}));
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const ok = async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 });
	return { ...actual, limits: new Proxy({}, { get: () => ok }) };
});

// Creator fees come from order 015's read model. Stub it when it is present so
// this suite pins the spotlight side only; when it is absent the metrics layer
// must report creator fees as unavailable, which the last test covers.
const EARNINGS_PATH = new URL('../api/_lib/agent-earnings.js', import.meta.url);
const HAS_EARNINGS = existsSync(EARNINGS_PATH);
if (HAS_EARNINGS) {
	vi.doMock('../api/_lib/agent-earnings.js', () => ({
		getAgentEarnings: async (agent) => ({
			lifetime_creator_fees: { earned_sol: agent.name === 'Coin Agent' ? 1.25 : 0, earned_usd: null },
			refreshed_at: null,
		}),
	}));
}

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const COIN_AGENT = '22222222-2222-4222-8222-222222222201';
const QUIET_AGENT = '22222222-2222-4222-8222-222222222202';
const CURATED_AGENT = '22222222-2222-4222-8222-222222222203';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Synthetic, keyless mint-shaped strings; not anyone's coin.
const SYNTH_MINT_A = 'THREEsynthetic1111111111111111111111111111';

const MIG = (f) => readFileSync(new URL(`../api/_lib/migrations/${f}`, import.meta.url), 'utf8');

const BASE_DDL = `
	create table users (
		id uuid primary key, display_name text, username text, wallet_address text,
		is_admin boolean default false, deleted_at timestamptz
	);
	create table user_wallets (user_id uuid, address text);
	create table avatars (
		id uuid primary key, thumbnail_key text, storage_key text, visibility text, deleted_at timestamptz
	);
	create table agent_identities (
		id uuid primary key, user_id uuid, name text, description text, skills text[],
		meta jsonb default '{}'::jsonb, erc8004_agent_id text, avatar_id uuid,
		is_public boolean default true, created_at timestamptz default now(), deleted_at timestamptz
	);
	create table usage_events (agent_id uuid, kind text);
	create table agent_actions (agent_id uuid);
	create table pump_agent_mints (
		id uuid primary key default gen_random_uuid(), agent_id uuid, user_id uuid, network text,
		mint text, name text, symbol text, created_at timestamptz default now()
	);
	create table agent_revenue_events (
		id uuid primary key default gen_random_uuid(), agent_id uuid, net_amount bigint,
		currency_mint text, created_at timestamptz default now()
	);
	create table agent_hires (
		id uuid primary key default gen_random_uuid(), provider_agent_id uuid, usd double precision,
		status text, created_at timestamptz default now()
	);
	create or replace function set_updated_at() returns trigger language plpgsql as $$
	begin new.updated_at = now(); return new; end $$;
`;

function mockReqRes({ method = 'GET', url, body } = {}) {
	const req = Object.assign(new Readable({ read() {} }), {
		method,
		url,
		headers: { 'content-type': 'application/json' },
		query: {},
		connection: { remoteAddress: '127.0.0.1' },
		socket: { remoteAddress: '127.0.0.1' },
	});
	if (body !== undefined) req.push(Buffer.from(JSON.stringify(body)));
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
async function call(method, action, { query = '', body } = {}) {
	const { req, res } = mockReqRes({ method, url: `/api/spotlight/${action}${query}`, body });
	await handler(req, res);
	return { status: res.statusCode, body: res.json };
}

async function seedEntry(agentId, { source = 'community', submittedBy = OWNER, category = 'trading' } = {}) {
	const [row] = await holder.db.query(
		`insert into agent_showcase (agent_id, submitted_by, source, title, tagline, category)
		 values ($1, $2, $3, 'A useful agent', 'It does a real job for real people', $4) returning id`,
		[agentId, submittedBy, source, category],
	);
	return row.id;
}

beforeAll(async () => {
	({ default: handler } = await import('../api/spotlight/[action].js'));
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	audits.length = 0;
	authState.session = null;
	await holder.db.exec(BASE_DDL);
	await holder.db.exec(MIG('20260901160000_agent_showcase.sql'));
	await holder.db.exec(MIG('20260930171500_agent_showcase_story_consent.sql'));
	await holder.db.query(
		`insert into users (id, display_name, username, is_admin) values
			($1, 'Owner', 'owner', false), ($2, 'Stranger', 'stranger', false), ($3, 'Admin', 'admin', true)`,
		[OWNER, STRANGER, ADMIN],
	);
	await holder.db.query(
		`insert into agent_identities (id, user_id, name) values
			($1, $4, 'Coin Agent'), ($2, $4, 'Quiet Agent'), ($3, $4, 'Curated Agent')`,
		[COIN_AGENT, QUIET_AGENT, CURATED_AGENT, OWNER],
	);
	await holder.db.query(
		`insert into pump_agent_mints (agent_id, user_id, network, mint, name, symbol) values
			($1, $2, 'mainnet', $3, 'Synthetic', 'SYN'), ($1, $2, 'devnet', 'devnetMintNotCounted', 'Dev', 'DEV')`,
		[COIN_AGENT, OWNER, SYNTH_MINT_A],
	);
	await holder.db.query(
		`insert into agent_revenue_events (agent_id, net_amount, currency_mint) values ($1, 2500000, $2), ($1, 999, 'someOtherMint')`,
		[COIN_AGENT, USDC],
	);
	await holder.db.query(
		`insert into agent_hires (provider_agent_id, usd, status) values ($1, 4.5, 'completed'), ($1, 100, 'failed')`,
		[COIN_AGENT],
	);
});

describe('verified results on the entry API', () => {
	it('carries coins and service income from real tables for an agent with a coin', async () => {
		const id = await seedEntry(COIN_AGENT);
		const { status, body } = await call('GET', 'get', { query: `?id=${id}` });
		expect(status).toBe(200);
		const v = body.entry.verified;
		expect(v.coins.count).toBe(1);
		expect(v.coins.items[0]).toMatchObject({
			mint: SYNTH_MINT_A,
			solscan_url: `https://solscan.io/token/${SYNTH_MINT_A}`,
			launch_url: `/launches/${SYNTH_MINT_A}`,
		});
		expect(v.service_income).toMatchObject({
			skill_sales_usd: 2.5,
			skill_sales_count: 1,
			hires_usd: 4.5,
			hires_count: 1,
			usd: 7,
		});
		expect(v.qualifies).toBe(true);
		expect(v.live).toEqual(expect.arrayContaining(['coins', 'service_income']));
	});

	it('reports zeros, not invented figures, for an agent without a coin', async () => {
		const id = await seedEntry(QUIET_AGENT);
		const { body } = await call('GET', 'get', { query: `?id=${id}` });
		const v = body.entry.verified;
		expect(v.coins).toMatchObject({ count: 0, items: [] });
		expect(v.service_income.usd).toBe(0);
		expect(v.qualifies).toBe(false);
	});
});

describe('story consent and /stories', () => {
	it('never lists a curated entry whose owner has not consented', async () => {
		await seedEntry(CURATED_AGENT, { source: 'curated', submittedBy: null });
		await holder.db.query(
			`insert into pump_agent_mints (agent_id, user_id, network, mint) values ($1, $2, 'mainnet', 'THREEsynthetic2222222222222222222222222222')`,
			[CURATED_AGENT, OWNER],
		);
		const { status, body } = await call('GET', 'stories');
		expect(status).toBe(200);
		expect(body.total).toBe(0);
		expect(body.consented).toBe(0);
		expect(body.groups).toEqual([]);
	});

	it('lists an entry once its owner accepts the feature, grouped by category', async () => {
		const id = await seedEntry(CURATED_AGENT, { source: 'curated', submittedBy: null, category: 'creative' });
		await holder.db.query(
			`insert into pump_agent_mints (agent_id, user_id, network, mint) values ($1, $2, 'mainnet', 'THREEsynthetic2222222222222222222222222222')`,
			[CURATED_AGENT, OWNER],
		);
		authState.session = { id: STRANGER };
		const denied = await call('POST', 'consent', { body: { id, consent: true } });
		expect(denied.status).toBe(403);

		authState.session = { id: OWNER };
		const ok = await call('POST', 'consent', { body: { id, consent: true } });
		expect(ok.status).toBe(200);
		expect(ok.body.story_consent).toBe(true);
		expect(audits.at(-1)).toMatchObject({ action: 'spotlight_story_consent', resourceId: id });

		authState.session = null;
		const { body } = await call('GET', 'stories');
		expect(body.total).toBe(1);
		expect(body.groups.map((g) => g.slug)).toEqual(['creative']);
		expect(body.groups[0].entries[0]).toMatchObject({ id, story_consent: true });

		authState.session = { id: OWNER };
		await call('POST', 'consent', { body: { id, consent: false } });
		authState.session = null;
		expect((await call('GET', 'stories')).body.total).toBe(0);
	});

	it('keeps a consented entry off /stories until it has a verified result', async () => {
		authState.session = { id: OWNER };
		const submitted = await call('POST', 'submit', {
			body: {
				agentId: QUIET_AGENT,
				title: 'Quiet but consenting',
				tagline: 'Opted in before it has results to show',
				category: 'research',
				featureStory: true,
			},
		});
		expect(submitted.status).toBe(200);
		expect(submitted.body.entry.story_consent).toBe(true);
		authState.session = null;
		const { body } = await call('GET', 'stories');
		expect(body.consented).toBe(1);
		expect(body.total).toBe(0);
	});

	it('leaves consent off when the submit form checkbox is not ticked', async () => {
		authState.session = { id: OWNER };
		const submitted = await call('POST', 'submit', {
			body: { agentId: COIN_AGENT, title: 'No consent', tagline: 'Submitted without ticking the box', category: 'trading' },
		});
		expect(submitted.body.entry.story_consent).toBe(false);
		authState.session = null;
		expect((await call('GET', 'stories')).body.total).toBe(0);
	});
});

describe('admin moderation', () => {
	it('hides and restores an entry, and a hidden entry leaves /spotlight and /stories', async () => {
		const id = await seedEntry(COIN_AGENT);
		authState.session = { id: OWNER };
		await call('POST', 'consent', { body: { id, consent: true } });
		authState.session = null;
		expect((await call('GET', 'stories')).body.total).toBe(1);
		expect((await call('GET', 'list')).body.total).toBe(1);

		authState.session = { id: OWNER };
		const notAdmin = await call('POST', 'moderate', { body: { id, action: 'hide' } });
		expect(notAdmin.status).toBe(403);

		authState.session = { id: ADMIN, is_admin: true };
		const hid = await call('POST', 'moderate', { body: { id, action: 'hide', reason: 'spam report' } });
		expect(hid.status).toBe(200);
		expect(hid.body).toMatchObject({ id, status: 'hidden', hidden_reason: 'spam report' });
		expect(audits.at(-1)).toMatchObject({ userId: ADMIN, action: 'spotlight_hide', resourceId: id });

		authState.session = null;
		expect((await call('GET', 'list')).body.total).toBe(0);
		expect((await call('GET', 'stories')).body.total).toBe(0);
		expect((await call('GET', 'get', { query: `?id=${id}` })).status).toBe(404);

		authState.session = { id: ADMIN, is_admin: true };
		const shown = await call('POST', 'moderate', { body: { id, action: 'unhide' } });
		expect(shown.body).toMatchObject({ status: 'published', hidden_reason: null });
		expect(audits.at(-1)).toMatchObject({ action: 'spotlight_unhide' });

		authState.session = null;
		expect((await call('GET', 'list')).body.total).toBe(1);
		expect((await call('GET', 'stories')).body.total).toBe(1);
	});

	it('rejects a signed-out caller and an unknown action', async () => {
		const id = await seedEntry(COIN_AGENT);
		expect((await call('POST', 'moderate', { body: { id, action: 'hide' } })).status).toBe(401);
		authState.session = { id: ADMIN, is_admin: true };
		expect((await call('POST', 'moderate', { body: { id, action: 'delete' } })).status).toBe(400);
	});
});

describe('creator fees', () => {
	it(HAS_EARNINGS ? 'reads creator fees from the earnings read model' : 'reports creator fees unavailable without the earnings read model', async () => {
		const id = await seedEntry(COIN_AGENT);
		const { body } = await call('GET', 'get', { query: `?id=${id}` });
		const fees = body.entry.verified.creator_fees;
		if (HAS_EARNINGS) {
			expect(fees).toMatchObject({ available: true, sol: 1.25 });
			expect(body.entry.verified.live).toContain('creator_fees');
		} else {
			expect(fees).toMatchObject({ available: false, sol: null });
			expect(body.entry.verified.live).not.toContain('creator_fees');
		}
	});
});

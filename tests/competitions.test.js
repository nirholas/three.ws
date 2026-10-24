// Builder competitions against the REAL competition_entries and
// agent_coin_earnings migrations (PGlite), the real config validator and the
// real HTTP handler. Only auth/CSRF/rate-limit edges are replaced.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };
const authState = { user: null };

vi.mock('../api/_lib/db.js', () => {
	// A tagged template that is also a fragment: nested sql`` values are inlined
	// when the outer query is awaited, as the real driver does.
	const build = (strings, values) => {
		let text = '';
		const params = [];
		strings.forEach((part, i) => {
			text += part;
			if (i >= values.length) return;
			const v = values[i];
			if (v && v.__frag) {
				const inner = build(v.strings, v.values);
				const shifted = inner.text.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + params.length}`);
				text += shifted;
				params.push(...inner.params);
			} else {
				params.push(v);
				text += `$${params.length}`;
			}
		});
		return { text, params };
	};
	const sql = (strings, ...values) => {
		const frag = {
			__frag: true,
			strings,
			values,
			then(res, rej) {
				const { text, params } = build(strings, values);
				return dbState.pg.query(text, params).then((r) => r.rows).then(res, rej);
			},
		};
		return frag;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/_lib/auth.js', () => ({
	getRequestUser: async () => authState.user,
	getSessionUser: async () => authState.user,
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));

const lib = await import('../api/_lib/competitions.js');
const handler = (await import('../api/competitions.js')).default;

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const read = (f) => readFileSync(new URL(f, MIG), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const A1 = 'a1111111-1111-4111-8111-111111111111';
const A2 = 'a2222222-2222-4222-8222-222222222222';
const A3 = 'a3333333-3333-4333-8333-333333333333';
const A_PRIVATE = 'a4444444-4444-4444-8444-444444444444';
const A_OTHER = 'a5555555-5555-4555-8555-555555555555';

const NOW = Date.now();
const iso = (offsetDays) => new Date(NOW + offsetDays * 86_400_000).toISOString();
const comp = (over = {}) => ({
	slug: 'spring-build',
	title: 'Spring Build',
	starts_at: iso(-10),
	register_by: iso(10),
	tokenize_by: iso(20),
	ends_at: iso(30),
	tracks: [{ name: 'Trading', description: 'Agents that trade.' }],
	prizes: [{ place: '1st', amount: 1000, asset: 'USDC', vesting: 'Paid at the end.' }],
	judges: [{ name: 'A Judge' }],
	rules: ['Launch your coin through three.ws.'],
	...over,
});

let dir;
function useConfig(list) {
	const file = join(dir, `c-${Math.random().toString(36).slice(2)}.json`);
	writeFileSync(file, JSON.stringify(list));
	process.env.COMPETITIONS_FILE = file;
}

function call(method, { url, body } = {}) {
	return new Promise((resolve) => {
		const headers = {};
		const res = {
			statusCode: 200,
			setHeader: (k, v) => (headers[k.toLowerCase()] = v),
			getHeader: (k) => headers[k.toLowerCase()],
			writeHead(s) {
				this.statusCode = s;
			},
			end(data) {
				resolve({ status: this.statusCode, body: data ? JSON.parse(data) : null, headers });
			},
		};
		const raw = body ? Buffer.from(JSON.stringify(body)) : null;
		const req = Object.assign(Readable.from(raw ? [raw] : []), {
			method,
			url,
			headers: { host: 'x', origin: 'https://three.ws', 'content-type': 'application/json' },
			socket: { remoteAddress: '127.0.0.1' },
		});
		handler(req, res);
	});
}

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'comp-'));
});

beforeEach(async () => {
	authState.user = null;
	const pg = new PGlite();
	dbState.pg = pg;
	await pg.exec(`
		create table users (id uuid primary key);
		create table agent_identities (
			id uuid primary key, user_id uuid not null references users(id), name text,
			is_public boolean not null default true, deleted_at timestamptz, meta jsonb not null default '{}'::jsonb);
		create table pump_agent_mints (
			id uuid primary key default gen_random_uuid(), agent_id uuid not null references agent_identities(id),
			user_id uuid not null references users(id), network text not null, mint text not null, name text, symbol text,
			created_at timestamptz not null default now());
	`);
	await pg.exec(read('20260930121000_agent_coin_earnings.sql'));
	await pg.exec(read('20261023200000_competition_entries.sql'));
	await pg.exec(`
		insert into users values ('${USER}'), ('${OTHER}');
		insert into agent_identities (id, user_id, name, is_public, meta) values
			('${A1}', '${USER}', 'Alpha', true, '{"solana_address":"W1"}'),
			('${A2}', '${USER}', 'Beta', true, '{"solana_address":"W2"}'),
			('${A3}', '${USER}', 'Gamma', true, '{"solana_address":"W3"}'),
			('${A_PRIVATE}', '${USER}', 'Hidden', false, '{}'),
			('${A_OTHER}', '${OTHER}', 'Theirs', true, '{}');
	`);
});

afterEach(() => {
	delete process.env.COMPETITIONS_FILE;
});

describe('config', () => {
	it('the committed file is valid and ships empty', () => {
		const committed = JSON.parse(readFileSync(new URL('../data/competitions.json', import.meta.url), 'utf8'));
		expect(committed).toEqual([]);
		expect(lib.parseCompetitions(committed)).toEqual([]);
	});

	it('rejects out-of-order dates, duplicate slugs and unknown keys with a named reason', () => {
		expect(() => lib.parseCompetitions([comp({ register_by: iso(-20) })])).toThrow(/register_by: must be after starts_at/);
		expect(() => lib.parseCompetitions([comp(), comp()])).toThrow(/duplicate slug/);
		expect(() => lib.parseCompetitions([{ ...comp(), prize_pool: 5 }])).toThrow(/competitions\[0\]/);
		expect(() => lib.parseCompetitions({})).toThrow(/JSON array/);
	});

	it('works out the phase and next deadline from the clock', () => {
		const c = lib.parseCompetitions([comp()])[0];
		expect(lib.competitionPhase(c, NOW).phase).toBe('open');
		expect(lib.competitionPhase(c, NOW).next_deadline.key).toBe('register_by');
		expect(lib.competitionPhase(c, NOW - 20 * 86_400_000).phase).toBe('upcoming');
		expect(lib.competitionPhase(c, NOW + 15 * 86_400_000)).toMatchObject({ phase: 'building', registration_open: false, tokenizing: true });
		expect(lib.competitionPhase(c, NOW + 40 * 86_400_000)).toMatchObject({ phase: 'ended', next_deadline: null });
	});
});

describe('empty config', () => {
	it('lists nothing and 404s an unknown slug', async () => {
		useConfig([]);
		const list = await call('GET', { url: '/api/competitions' });
		expect(list.status).toBe(200);
		expect(list.body).toEqual({ competitions: [] });
		expect((await call('GET', { url: '/api/competitions.js?slug=nope' })).status).toBe(404);
	});
});

describe('registration', () => {
	const post = (body, slug = 'spring-build') =>
		call('POST', { url: `/api/competitions.js?slug=${slug}&part=entries`, body });

	it('requires sign in', async () => {
		useConfig([comp()]);
		expect((await post({ agent_id: A1, track: 'Trading' })).status).toBe(401);
	});

	it('enters the caller\'s own public agent once', async () => {
		useConfig([comp()]);
		authState.user = { id: USER };
		const ok = await post({ agent_id: A1, track: 'Trading', team_name: 'Team A', x_handle: '@alpha' });
		expect(ok.status).toBe(201);
		const again = await post({ agent_id: A1, track: 'Trading' });
		expect(again.status).toBe(409);
		expect(again.body.error).toBe('already_registered');
		const [row] = (await dbState.pg.query('select x_handle, team_name from competition_entries')).rows;
		expect(row).toEqual({ x_handle: 'alpha', team_name: 'Team A' });
	});

	it('refuses another user\'s agent, a private agent and an unknown track', async () => {
		useConfig([comp()]);
		authState.user = { id: USER };
		expect((await post({ agent_id: A_OTHER, track: 'Trading' })).body.error).toBe('forbidden');
		expect((await post({ agent_id: A_PRIVATE, track: 'Trading' })).body.error).toBe('agent_not_public');
		expect((await post({ agent_id: A1, track: 'Nope' })).status).toBe(400);
		expect((await post({ agent_id: A1 })).status).toBe(400);
		expect((await dbState.pg.query('select 1 from competition_entries')).rows).toHaveLength(0);
	});

	it('enforces the window on both sides', async () => {
		authState.user = { id: USER };
		useConfig([comp({ starts_at: iso(1), register_by: iso(5), tokenize_by: iso(9), ends_at: iso(10) })]);
		expect((await post({ agent_id: A1, track: 'Trading' })).body.error).toBe('registration_not_open');
		useConfig([comp({ starts_at: iso(-9), register_by: iso(-1), tokenize_by: iso(9), ends_at: iso(10) })]);
		expect((await post({ agent_id: A1, track: 'Trading' })).body.error).toBe('registration_closed');
	});
});

describe('leaderboard', () => {
	it('ranks tokenized entries by creator fees from the earnings snapshot, in-window launches only', async () => {
		useConfig([comp()]);
		const pg = dbState.pg;
		for (const [agent, team] of [[A1, 'one'], [A2, 'two'], [A3, 'three']]) {
			await pg.query(`insert into competition_entries (competition, user_id, agent_id, team_name, track) values ('spring-build', $1, $2, $3, 'Trading')`, [USER, agent, team]);
		}
		await pg.query(
			`insert into pump_agent_mints (agent_id, user_id, network, mint, symbol, created_at) values
			 ($1, $4, 'mainnet', 'MINT1', 'ONE', $5),
			 ($2, $4, 'mainnet', 'MINT2', 'TWO', $5),
			 ($3, $4, 'mainnet', 'MINT3', 'OLD', $6)`,
			[A1, A2, A3, USER, iso(-5), iso(-60)],
		);
		await pg.query(
			`insert into agent_coin_earnings (mint, agent_id, creator, earned_lamports, source, refreshed_at) values
			 ('MINT1', $1, 'W1', 1000000000, 'pumpfun_creator_fees', now()),
			 ('MINT2', $2, 'W2', 3000000000, 'pumpfun_creator_fees', now()),
			 ('MINT3', $3, 'W3', 9000000000, 'pumpfun_creator_fees', now())`,
			[A1, A2, A3],
		);
		const res = await call('GET', { url: '/api/competitions.js?slug=spring-build' });
		expect(res.status).toBe(200);
		const rows = res.body.entries.map((e) => [e.agent.name, e.rank, e.tokenized, e.fees_sol]);
		expect(rows).toEqual([
			['Beta', 1, true, 3],
			['Alpha', 2, true, 1],
			['Gamma', null, false, null],
		]);
		expect(res.body.entries[0].coin.mint).toBe('MINT2');
		expect(res.body.method).toMatch(/creator fees/);
		expect(res.body.viewer).toEqual({ signed_in: false, entered_agent_ids: [] });
	});

	it('is empty, not an error, with no entries', async () => {
		useConfig([comp()]);
		const res = await call('GET', { url: '/api/competitions.js?slug=spring-build&part=entries' });
		expect(res.body.entries).toEqual([]);
	});
});

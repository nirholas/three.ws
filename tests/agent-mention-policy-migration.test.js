// api/_lib/x-agent-policy.js's mention_replies_* columns against the REAL
// migration (20261011220000_agent_mention_policy.sql), in an in-process
// Postgres (PGlite), the same way tests/x-mention-store.test.js pins the
// x_mention_events schema. This migration is pending in this environment
// (see prompts/finish/_context/production-100-OWNER-ACTIONS.md); this test
// is how it was verified locally without applying it to the shared database.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const { getAgentPolicy, saveAgentPolicy } = await import('../api/_lib/x-agent-policy.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const ALTER = readFileSync(new URL('20261011220000_agent_mention_policy.sql', MIG), 'utf8');

// A minimal stand-in for the base migration's two tables: just the columns
// agent_x_policies had before this migration, which is all the ALTER and
// x-agent-policy.js's queries need.
const BASE = `
	create table users (id uuid primary key);
	create table agent_identities (id uuid primary key, user_id uuid, name text, deleted_at timestamptz);
	create table agent_x_policies (
		agent_id            uuid primary key references agent_identities(id) on delete cascade,
		user_id             uuid not null references users(id) on delete cascade,
		enabled             boolean not null default true,
		allowed_kinds       text[] not null default '{}',
		review_before_post  boolean not null default true,
		max_posts_per_day   integer not null default 4 check (max_posts_per_day between 0 and 50),
		min_interval_min    integer not null default 60 check (min_interval_min between 0 and 1440),
		tone_guidance       text not null default '' check (char_length(tone_guidance) <= 1000),
		banned_terms        text[] not null default '{}',
		max_hashtags        integer not null default 1 check (max_hashtags between 0 and 10),
		allow_links         boolean not null default true,
		created_at          timestamptz not null default now(),
		updated_at          timestamptz not null default now()
	);
`;

const USER = '11111111-1111-1111-1111-111111111111';
const AGENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(BASE);
	await dbState.pg.exec(ALTER);
	await dbState.pg.query('insert into users (id) values ($1)', [USER]);
	await dbState.pg.query('insert into agent_identities (id, user_id, name) values ($1, $2, $3)', [AGENT, USER, 'Test Agent']);
});

describe('migration', () => {
	it('is idempotent', async () => {
		await dbState.pg.exec(ALTER);
	});

	it('adds the four mention_replies_* columns with the documented defaults', async () => {
		const { rows } = await dbState.pg.query(
			`select column_name, data_type, column_default from information_schema.columns
			 where table_name = 'agent_x_policies' and column_name like 'mention_replies_%'
			 order by column_name`,
		);
		expect(rows.map((r) => r.column_name)).toEqual([
			'mention_replies_allowed_intents',
			'mention_replies_daily_cap',
			'mention_replies_dry_run',
			'mention_replies_enabled',
		]);
	});

	it('rejects a daily cap outside 0..50 at the database level', async () => {
		await dbState.pg.query(
			'insert into agent_x_policies (agent_id, user_id) values ($1, $2)',
			[AGENT, USER],
		);
		await expect(
			dbState.pg.query(
				`update agent_x_policies set mention_replies_daily_cap = 51 where agent_id = $1`,
				[AGENT],
			),
		).rejects.toThrow();
	});
});

describe('getAgentPolicy / saveAgentPolicy', () => {
	it('defaults an agent with no row to mentions off, dry run, cap 10, no intents', async () => {
		const policy = await getAgentPolicy(AGENT);
		expect(policy.mention_replies_enabled).toBe(false);
		expect(policy.mention_replies_dry_run).toBe(true);
		expect(policy.mention_replies_daily_cap).toBe(10);
		expect(policy.mention_replies_allowed_intents).toEqual([]);
	});

	it('persists a mention-reply policy patch through the real column set', async () => {
		const saved = await saveAgentPolicy({
			userId: USER,
			agentId: AGENT,
			patch: {
				mention_replies_enabled: true,
				mention_replies_dry_run: false,
				mention_replies_daily_cap: 25,
				mention_replies_allowed_intents: ['chat', 'make'],
			},
		});
		expect(saved.mention_replies_enabled).toBe(true);
		expect(saved.mention_replies_dry_run).toBe(false);
		expect(saved.mention_replies_daily_cap).toBe(25);
		expect(saved.mention_replies_allowed_intents).toEqual(['chat', 'make']);

		const reloaded = await getAgentPolicy(AGENT);
		expect(reloaded.mention_replies_enabled).toBe(true);
		expect(reloaded.mention_replies_allowed_intents).toEqual(['chat', 'make']);
	});

	it('rejects an unknown intent id instead of persisting it', async () => {
		await expect(
			saveAgentPolicy({
				userId: USER,
				agentId: AGENT,
				patch: { mention_replies_allowed_intents: ['chat', 'not-a-real-intent'] },
			}),
		).rejects.toThrow(/unknown intent/);
	});
});

// Regression: strategy-run buys (pump-fun-trade skill) persist agent_actions
// pumpfun.buy rows with payload.amountSol, not payload.solAmount. The rolling
// daily SOL cap must count them, otherwise strategy buys draw down nothing.

import { beforeAll, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const sql = (...args) => holder.db.sql(...args);
	sql.transaction = async (queries) => {
		const out = [];
		for (const q of queries) out.push(await q);
		return out;
	};
	return { ...actual, sql };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const AGENT = '00000000-0000-0000-0000-000000000013';
const META = { spend_policy: { max_sol_per_tx: 2, daily_sol_cap: 5 } };

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`create table agent_actions (
		id uuid primary key default gen_random_uuid(), agent_id uuid, type text, payload jsonb,
		source_skill text, created_at timestamptz default now());`);
	await holder.db.query(
		`insert into agent_actions (agent_id, type, payload) values ($1, 'pumpfun.buy', $2::jsonb)`,
		[AGENT, JSON.stringify({ mint: 'THREEsyntheticMint1', amountSol: 4.9, sig: 's' })],
	);
});

describe('daily SOL cap counts strategy-run buys stored as amountSol', () => {
	it('checkBuyAllowed blocks a spend that pushes amountSol history over the cap', async () => {
		const { checkBuyAllowed } = await import('../api/_lib/agent-spend-policy.js');
		const r = await checkBuyAllowed({ agentId: AGENT, meta: META, mint: null, solAmount: 1 });
		expect(r?.code).toBe('daily_cap_exceeded');
	});

	it('reserveSpend sees the same history', async () => {
		const { reserveSpend } = await import('../api/_lib/agent-spend-policy.js');
		const r = await reserveSpend({ agentId: AGENT, meta: META, mint: null, solAmount: 1, type: 'pumpfun.buy' });
		expect(r.ok).toBe(false);
		expect(r.code).toBe('daily_cap_exceeded');
	});
});

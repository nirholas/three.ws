// Regression: strategy-run live buys must reserve against the daily SOL cap
// atomically. The old read-only checkBuyAllowed gate let two concurrent runs
// both read the same 24h total and both pass. No funds move here: PGlite only.

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

const AGENT = '00000000-0000-0000-0000-000000000031';
const META = { spend_policy: { max_sol_per_tx: 4, daily_sol_cap: 5 } };

async function rows() {
	return holder.db.query(
		`select type, payload from agent_actions where agent_id = $1 order by created_at`,
		[AGENT],
	);
}

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`create table agent_actions (
		id uuid primary key default gen_random_uuid(), agent_id uuid, type text, payload jsonb,
		source_skill text, signature text, signer_address text, created_at timestamptz default now());`);
});

describe('strategy spend guard reserves atomically', () => {
	it('lets only one of two concurrent 3 SOL buys through a 5 SOL daily cap', async () => {
		const { createStrategySpendGuard } = await import('../api/_lib/agent-spend-policy.js');
		const a = createStrategySpendGuard({ agentId: AGENT, meta: META });
		const b = createStrategySpendGuard({ agentId: AGENT, meta: META });
		const [ra, rb] = await Promise.all([
			a.guard({ mint: 'THREEsyntheticMintA', amountSol: 3 }),
			b.guard({ mint: 'THREEsyntheticMintB', amountSol: 3 }),
		]);
		const blocked = [ra, rb].filter(Boolean);
		expect(blocked).toHaveLength(1);
		expect(blocked[0].code).toBe('daily_cap_exceeded');
		expect((await rows()).length).toBe(1);
	});

	it('finalizes the reservation on success and releases it on failure', async () => {
		const { createStrategySpendGuard } = await import('../api/_lib/agent-spend-policy.js');
		await holder.db.query(`delete from agent_actions`);
		const g = createStrategySpendGuard({ agentId: AGENT, meta: META });
		expect(await g.guard({ mint: 'THREEsyntheticMintC', amountSol: 2 })).toBeNull();
		expect(await g.guard({ mint: 'THREEsyntheticMintD', amountSol: 2 })).toBeNull();
		await g.settle({ mint: 'THREEsyntheticMintC', ok: true, sig: 'sigC' });
		await g.settle({ mint: 'THREEsyntheticMintD', ok: false });
		const r = await rows();
		expect(r).toHaveLength(1);
		expect(r[0].type).toBe('pumpfun.buy');
		expect(r[0].payload.status).toBe('confirmed');
		expect(r[0].payload.sig).toBe('sigC');
	});
});

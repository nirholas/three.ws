// confirmRule is the owner's yes that lets a reinvest rule move money every
// period. It must refuse a rule whose confirmation table has a destination that
// is not available (no deposit wallet configured, no own coin on the network),
// exactly as the confirm screen says, instead of trusting the button state.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rule: null, updates: 0, deposit: null, coin: null }));

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings) => {
		const text = strings.join('?');
		const run = () => {
			if (/from revenue_reinvest_rules where id/.test(text)) return state.rule ? [state.rule] : [];
			if (/update revenue_reinvest_rules set confirmed_hash/.test(text)) {
				state.updates++;
				return [{ ...state.rule, status: 'active', confirmed_hash: 'set' }];
			}
			if (/from revenue_ledger_entries/.test(text)) return [];
			if (/from revenue_reinvest_legs/.test(text)) return [{ usd: 0 }];
			if (/from pump_agent_mints/.test(text)) return state.coin ? [state.coin] : [];
			return [];
		};
		return { text, then: (ok, bad) => Promise.resolve().then(run).then(ok, bad) };
	};
	return { sql };
});
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));
vi.mock('../api/_lib/trader-stats.js', () => ({ cachedSolUsd: vi.fn(async () => 100) }));
vi.mock('../api/_lib/credit-deposit.js', () => ({ depositWallet: () => state.deposit }));

const { confirmRule, ruleView } = await import('../api/_lib/revenue-reinvest.js');

const RULE = {
	id: '11111111-1111-4111-8111-111111111111',
	user_id: 'u1',
	agent_id: '22222222-2222-4222-8222-222222222222',
	name: 'Weekly reinvest',
	status: 'draft',
	network: 'devnet',
	period: 'weekly',
	basis: 'revenue',
	legs: [{ kind: 'model_credits', pct: 20 }],
	per_run_cap_usd: '25',
	lifetime_cap_usd: '250',
	min_run_usd: '1',
	confirmed_hash: null,
};

beforeEach(() => {
	state.rule = { ...RULE };
	state.updates = 0;
	state.deposit = null;
	state.coin = null;
});

describe('confirmRule', () => {
	it('refuses when a destination in the confirmation table is not available', async () => {
		const hash = ruleView(state.rule).hash;
		await expect(confirmRule({ ruleId: RULE.id, userId: 'u1', hash })).rejects.toMatchObject({
			status: 409,
			code: 'destination_unavailable',
		});
		expect(state.updates).toBe(0);
	});

	it('refuses a coin leg when the agent has no coin on the rule network', async () => {
		state.deposit = 'THREEsynthetic1111111111111111111111111111';
		state.rule = { ...RULE, legs: [{ kind: 'model_credits', pct: 20 }, { kind: 'dca_own_coin', pct: 10 }] };
		const hash = ruleView(state.rule).hash;
		await expect(confirmRule({ ruleId: RULE.id, userId: 'u1', hash })).rejects.toMatchObject({ code: 'destination_unavailable' });
		expect(state.updates).toBe(0);
	});

	it('activates when every destination is available and the hash matches', async () => {
		state.deposit = 'THREEsynthetic1111111111111111111111111111';
		const hash = ruleView(state.rule).hash;
		const out = await confirmRule({ ruleId: RULE.id, userId: 'u1', hash });
		expect(out.status).toBe('active');
		expect(state.updates).toBe(1);
	});

	it('still refuses a stale hash before anything else', async () => {
		state.deposit = 'THREEsynthetic1111111111111111111111111111';
		await expect(confirmRule({ ruleId: RULE.id, userId: 'u1', hash: 'stale' })).rejects.toMatchObject({ code: 'rule_changed' });
		expect(state.updates).toBe(0);
	});
});

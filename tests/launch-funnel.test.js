// Launch funnel recording and reporting (api/_lib/launch-funnel.js).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const sqlCalls = [];
const sqlQueue = [];

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlCalls.push({ text: strings.join('?'), values });
		const next = sqlQueue.shift();
		if (next instanceof Error) throw next;
		return next ?? [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const { recordFunnelStep, gatherLaunchFunnel, FUNNEL_STEPS, CLIENT_FUNNEL_STEPS } = await import(
	'../api/_lib/launch-funnel.js'
);

const AGENT_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
	sqlCalls.length = 0;
	sqlQueue.length = 0;
});

describe('recordFunnelStep', () => {
	it('writes one row for a known step', async () => {
		expect(await recordFunnelStep({ agentId: AGENT_ID, step: 'plan_viewed' })).toBe(true);
		expect(sqlCalls).toHaveLength(1);
		expect(sqlCalls[0].values).toEqual([AGENT_ID, null, 'plan_viewed', 'mainnet']);
	});

	it('refuses an unknown step and a missing agent without touching the database', async () => {
		expect(await recordFunnelStep({ agentId: AGENT_ID, step: 'made_up' })).toBe(false);
		expect(await recordFunnelStep({ agentId: '', step: 'plan_viewed' })).toBe(false);
		expect(sqlCalls).toHaveLength(0);
	});

	it('never throws: a funnel row must not be able to fail a launch', async () => {
		sqlQueue.push(new Error('db down'));
		expect(await recordFunnelStep({ agentId: AGENT_ID, step: 'launch_succeeded' })).toBe(false);
	});

	it('only lets the browser report steps it alone can see', () => {
		expect(CLIENT_FUNNEL_STEPS).toEqual(['plan_viewed', 'wallet_funded', 'launch_confirm_opened']);
		for (const s of CLIENT_FUNNEL_STEPS) expect(FUNNEL_STEPS).toContain(s);
		expect(CLIENT_FUNNEL_STEPS).not.toContain('launch_succeeded');
	});
});

describe('gatherLaunchFunnel', () => {
	it('reports every step in order, zero-filled, for the agents created in the window', async () => {
		sqlQueue.push([{ agents_created: 788, with_solana_wallet: 208 }]);
		sqlQueue.push([{ plans_saved: 0 }]);
		sqlQueue.push([{ agents_launched: 2 }]);
		sqlQueue.push([
			{ step: 'plan_viewed', agents: 40 },
			{ step: 'plan_drafted', agents: 700 },
		]);
		const r = await gatherLaunchFunnel({ from: '2026-08-31T00:00:00Z', to: '2026-09-30T00:00:00Z' });
		expect(r.agents_created).toBe(788);
		expect(r.agents_launched).toBe(2);
		expect(r.steps.map((s) => s.step)).toEqual([...FUNNEL_STEPS]);
		expect(r.steps.find((s) => s.step === 'plan_drafted').agents).toBe(700);
		expect(r.steps.find((s) => s.step === 'plan_edited').agents).toBe(0);
	});
});

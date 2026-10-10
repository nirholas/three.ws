// The squad coordinator's escalation flow (api/_lib/team-chat/runner.js): a
// step that signs, launches, transfers or exceeds the cap pauses at
// needs_approval with the exact payload and its hash, and the run resumes only
// when the owner decides. The real runner and the real planner run against the
// in-memory store; only the specialists (which quote and trade against live
// venues) are replaced, and spied so a test proves what did and did not execute.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRunner, summarizeRun } from '../api/_lib/team-chat/runner.js';
import { createMemoryStore } from '../api/_lib/team-chat/store.js';
import { subscribe } from '../api/_lib/team-chat/bus.js';
import { sha256Hex } from '../api/_lib/team-chat/untrusted.js';

const USER = '00000000-0000-4000-8000-0000000000aa';
const AGENT = '00000000-0000-4000-8000-0000000000bb';
const WALLET = 'THREEsyntheticWa11et111111111111111111111';
const SYNTH = 'THREEsynthetic1111111111111111111111111111';

function makeSquad(overrides = {}) {
	const member = (role) => ({ role, agent_id: AGENT, name: `${role} agent`, avatar_id: null, wallet: WALLET });
	return {
		kind: 'team',
		id: '00000000-0000-4000-8000-0000000000cc',
		name: 'Test Squad',
		network: 'mainnet',
		status: 'active',
		policy_agent_id: AGENT,
		policy: { per_trade_sol: 0.1, daily_budget_sol: 0.5, allow_caution: false },
		members: ['researcher', 'entry', 'trader', 'launcher'].map(member),
		...overrides,
	};
}

function makeSpecialists({ verdict = 'pass', entry = 'met', riskNote = null } = {}) {
	return {
		loadPolicyAgent: vi.fn(async () => ({ id: AGENT, meta: { solana_address: WALLET } })),
		tradeCapSol: vi.fn((squad) => squad.policy.per_trade_sol),
		research: vi.fn(async ({ step }) => ({ verdict, summary: `Research verdict: ${verdict}.`, evidence: { mint: step.params.mint, verdict, risk_note: riskNote } })),
		entryCheck: vi.fn(async ({ step }) => ({ verdict: step.params.condition ? entry : 'snapshot', summary: `Entry ${entry}.`, evidence: { mint: step.params.mint } })),
		quoteTrade: vi.fn(async ({ step, amount }) => ({
			agent: { id: AGENT, meta: { solana_address: WALLET } },
			amount,
			slippage_bps: step.params.slippage_bps,
			quote: { allowed: true, venue: 'bonding curve', price_impact_pct: 1.25, expected_tokens_out: 120000, usd_value: 7.5, wallet_address: WALLET },
			note: null,
		})),
		executeTrade: vi.fn(async ({ payload }) => ({ receipt: { simulated: payload.mode !== 'live', signature: payload.mode === 'live' ? 'THREEsyntheticSig' : null, venue: 'bonding curve' } })),
		placeConditionalOrder: vi.fn(async () => ({ receipt: { order_id: 'order-1', status: 'active', orders_url: `/agent/${AGENT}/wallet#orders` } })),
		prepareLaunch: vi.fn(async ({ step }) => ({
			verdict: 'ready',
			summary: 'Launch plan ready.',
			evidence: { plan: { name: step.params.name, symbol: step.params.symbol, initial_buy_sol: step.params.initial_buy_sol }, blockers: [], launch_url: '/three-launchpad?name=Moon+Cat#tl-launch' },
		})),
		prepareTransfer: vi.fn(async ({ step }) => ({ verdict: 'ready', summary: 'Transfer prepared.', evidence: { ...step.params, from: WALLET, handoff_url: `/agent/${AGENT}/wallet#withdraw` } })),
		draftStrategy: vi.fn(async () => ({ verdict: 'drafted', summary: 'Strategy drafted.', evidence: {} })),
		remember: vi.fn(async ({ step }) => ({ verdict: 'saved', summary: `Remembered ${step.params.key}.`, evidence: { memory: { key: step.params.key, value: step.params.value } } })),
	};
}

function setup({ squad = makeSquad(), specialists = makeSpecialists(), bridge = null, prefs = {} } = {}) {
	const store = createMemoryStore();
	const runner = createRunner({
		store,
		specialists,
		bridge,
		resolveSquad: async () => squad,
		loadPrefs: async () => ({ values: prefs, entries: Object.entries(prefs).map(([key, value]) => ({ key, value })) }),
		userId: USER,
		useModel: false,
	});
	return { store, runner, squad, specialists };
}

const stepOf = async (store, runId, kind) => (await store.getSteps(runId)).find((s) => s.kind === kind);

describe('pause and resume', () => {
	let ctx;
	beforeEach(() => { ctx = setup(); });

	it('plans, runs the specialists, and pauses the trade with a full confirmation table', async () => {
		const seen = [];
		const { run } = await ctx.runner.start({
			squad: ctx.squad,
			utterance: 'Research $THREE and buy 0.05 SOL if market cap is under $5M',
			onCreated: (r) => { subscribe(r.id, (ev) => seen.push(ev.kind)); },
		});
		expect(run.status).toBe('awaiting_approval');
		const steps = await ctx.store.getSteps(run.id);
		expect(steps.map((s) => [s.kind, s.status])).toEqual([
			['research', 'done'],
			['entry_check', 'done'],
			['trade', 'needs_approval'],
		]);
		const trade = steps[2];
		expect(ctx.specialists.executeTrade).not.toHaveBeenCalled();
		expect(trade.approval.payload).toMatchObject({ action: 'trade', side: 'buy', amount: 0.05, mode: 'paper', step_id: trade.id, run_id: run.id });
		expect(trade.approval.payload_hash).toBe(sha256Hex(trade.approval.payload));
		const labels = trade.approval.table.map((r) => r.label);
		for (const l of ['Action', 'Amount', 'Token', 'Tokens go to', 'Chain', 'Mode']) expect(labels).toContain(l);
		expect(trade.approval.gate_reasons).toContain('signs');
		expect(seen).toEqual(expect.arrayContaining(['run', 'memory', 'plan', 'step', 'approval', 'summary']));
		expect(seen.indexOf('plan')).toBeLessThan(seen.indexOf('approval'));
	});

	it('executes exactly the approved payload once, then finishes with a per-specialist summary', async () => {
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL if market cap is under $5M' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		const out = await ctx.runner.decide({ stepId: trade.id, decision: 'approve', payloadHash: trade.approval.payload_hash });
		expect(out.step.status).toBe('done');
		expect(out.step.result.receipt.simulated).toBe(true);
		expect(ctx.specialists.executeTrade).toHaveBeenCalledTimes(1);
		expect(ctx.specialists.executeTrade.mock.calls[0][0].payload).toEqual(trade.approval.payload);

		const after = await ctx.store.getRunById(run.id);
		expect(after.status).toBe('done');
		expect(after.summary.lines.map((l) => l.role)).toEqual(['researcher', 'entry', 'trader']);
		expect(after.summary.lines[2].receipt.simulated).toBe(true);

		const again = await ctx.runner.decide({ stepId: trade.id, decision: 'approve', payloadHash: trade.approval.payload_hash });
		expect(again.idempotent).toBe(true);
		expect(ctx.specialists.executeTrade).toHaveBeenCalledTimes(1);
	});

	it('refuses an approval whose hash differs from the action on file', async () => {
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		await expect(ctx.runner.decide({ stepId: trade.id, decision: 'approve', payloadHash: 'f'.repeat(64) }))
			.rejects.toMatchObject({ status: 409, code: 'payload_mismatch' });
		expect(ctx.specialists.executeTrade).not.toHaveBeenCalled();
		expect((await ctx.store.getStep(trade.id)).status).toBe('needs_approval');
	});

	it('declining settles the step without signing and closes the run', async () => {
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		const out = await ctx.runner.decide({ stepId: trade.id, decision: 'deny' });
		expect(out.step.status).toBe('denied');
		expect(ctx.specialists.executeTrade).not.toHaveBeenCalled();
		expect((await ctx.store.getRunById(run.id)).status).toBe('done');
	});

	it('refuses to execute when the frozen plan was altered after approval was shown', async () => {
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		ctx.store.runs.get(run.id).plan.steps[2].params.amount = 5;
		await ctx.runner.decide({ stepId: trade.id, decision: 'approve', payloadHash: trade.approval.payload_hash });
		expect(ctx.specialists.executeTrade).not.toHaveBeenCalled();
		const settled = await ctx.store.getStep(trade.id);
		expect(settled.status).toBe('failed');
		expect(settled.error).toMatch(/no longer matches/);
	});

	it('expires an approval nobody answered in time', async () => {
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		ctx.store.steps.get(trade.id).approval.expires_at = new Date(Date.now() - 1000).toISOString();
		await ctx.runner.refresh(run.id);
		expect((await ctx.store.getStep(trade.id)).status).toBe('expired');
		expect(ctx.specialists.executeTrade).not.toHaveBeenCalled();
	});
});

describe('trader gates', () => {
	it('clamps a buy above the cap and says why', async () => {
		const ctx = setup();
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.5 SOL' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		expect(trade.approval.payload.amount).toBe(0.1);
		expect(trade.approval.gate_reasons).toContain('exceeds_cap');
		expect(trade.approval.risk_notes[0]).toMatch(/per-trade cap/);
	});

	it('will not buy a coin research says to avoid', async () => {
		const ctx = setup({ specialists: makeSpecialists({ verdict: 'avoid' }) });
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		expect(trade.status).toBe('skipped');
		expect(trade.approval).toBeNull();
		expect(ctx.specialists.quoteTrade).not.toHaveBeenCalled();
	});

	it('follows the team policy on caution', async () => {
		const blocked = setup({ specialists: makeSpecialists({ verdict: 'caution' }) });
		const r1 = await blocked.runner.start({ squad: blocked.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		expect((await stepOf(blocked.store, r1.run.id, 'trade')).status).toBe('skipped');

		const allowed = setup({ squad: makeSquad({ policy: { per_trade_sol: 0.1, daily_budget_sol: 0.5, allow_caution: true } }), specialists: makeSpecialists({ verdict: 'caution' }) });
		const r2 = await allowed.runner.start({ squad: allowed.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		const trade = await stepOf(allowed.store, r2.run.id, 'trade');
		expect(trade.status).toBe('needs_approval');
		expect(trade.approval.risk_notes.join(' ')).toMatch(/caution/);
	});

	it('skips in paper mode when the entry condition is not met', async () => {
		const ctx = setup({ specialists: makeSpecialists({ entry: 'not_met' }) });
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL if market cap is under $5M' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		expect(trade.status).toBe('skipped');
		expect(trade.error).toMatch(/standing order/);
	});

	it('proposes a standing order in live mode and places it on approval', async () => {
		const ctx = setup({ specialists: makeSpecialists({ entry: 'not_met' }) });
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL if market cap is under $5M', mode: 'live' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		expect(trade.status).toBe('needs_approval');
		expect(trade.approval.payload).toMatchObject({ action: 'order', mode: 'live', condition: { all: [{ signal: 'mcap_usd', op: 'lt', value: 5_000_000 }] } });
		await ctx.runner.decide({ stepId: trade.id, decision: 'approve', payloadHash: trade.approval.payload_hash });
		expect(ctx.specialists.placeConditionalOrder).toHaveBeenCalledTimes(1);
		expect(ctx.specialists.executeTrade).not.toHaveBeenCalled();
		expect((await ctx.store.getStep(trade.id)).result.receipt.order_id).toBe('order-1');
	});

	it('stops a trade the spend guard would block before it reaches the owner', async () => {
		const specialists = makeSpecialists();
		specialists.quoteTrade.mockResolvedValueOnce({ agent: {}, amount: 0.05, slippage_bps: 500, quote: { allowed: false, blocked_reason: { message: 'daily budget reached' } }, note: null });
		const ctx = setup({ specialists });
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		expect(trade.status).toBe('failed');
		expect(trade.error).toMatch(/daily budget reached/);
		expect((await ctx.store.getRunById(run.id)).status).toBe('done');
	});
});

describe('launches and transfers hand off, never sign', () => {
	it('pauses a launch and approving opens the launchpad', async () => {
		const ctx = setup();
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'launch a coin called Moon Cat ($MCAT) about a cat on the moon' });
		const launch = await stepOf(ctx.store, run.id, 'launch');
		expect(launch.status).toBe('needs_approval');
		expect(launch.approval.gate_reasons).toEqual(['launches']);
		expect(launch.approval.table.find((r) => r.label === 'Signer').value).toMatch(/You/);
		const out = await ctx.runner.decide({ stepId: launch.id, decision: 'approve', payloadHash: launch.approval.payload_hash });
		expect(out.step.status).toBe('done');
		expect(out.step.result.receipt.handoff_url).toContain('/three-launchpad');
		expect(ctx.specialists.executeTrade).not.toHaveBeenCalled();
	});

	it('pauses a transfer with recipient, amount, asset and chain', async () => {
		const ctx = setup();
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: `send 1 SOL to ${SYNTH}` });
		const transfer = await stepOf(ctx.store, run.id, 'transfer');
		expect(transfer.status).toBe('needs_approval');
		const labels = transfer.approval.table.map((r) => r.label);
		expect(labels).toEqual(expect.arrayContaining(['Recipient', 'Amount', 'Asset', 'Chain']));
		expect(transfer.approval.table.find((r) => r.label === 'Recipient').full).toBe(SYNTH);
	});
});

describe('the approval inbox', () => {
	it('mirrors a live trade and resumes the run when the inbox approves it', async () => {
		const box = { rows: new Map() };
		let runnerRef;
		const bridge = {
			shouldMirror: vi.fn(async (approval, run) => run.mode === 'live'),
			mirror: vi.fn(async ({ step, approval }) => {
				const request = { id: '00000000-0000-4000-8000-0000000000dd', user_id: USER, source_ref: step.id, payload: approval.payload, payload_hash: approval.payload_hash };
				box.rows.set(request.id, request);
				return { request, autoApproved: false };
			}),
			link: vi.fn(async (request) => `/approvals/${request.id}`),
			statuses: vi.fn(async () => new Map()),
			runAuto: vi.fn(),
			decide: vi.fn(async ({ approvalRequestId, decision }) => {
				if (decision === 'approve') return runnerRef.executeApprovedStep(box.rows.get(approvalRequestId).source_ref, { inboxRow: box.rows.get(approvalRequestId) });
				return null;
			}),
		};
		const ctx = setup({ bridge });
		runnerRef = ctx.runner;
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL', mode: 'live' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		expect(bridge.mirror).toHaveBeenCalledTimes(1);
		expect(trade.approval_request_id).toBe('00000000-0000-4000-8000-0000000000dd');
		expect(trade.approval.inbox_url).toBe('/approvals/00000000-0000-4000-8000-0000000000dd');

		await ctx.runner.decide({ stepId: trade.id, decision: 'approve', payloadHash: trade.approval.payload_hash });
		expect(bridge.decide).toHaveBeenCalledTimes(1);
		expect(ctx.specialists.executeTrade).toHaveBeenCalledTimes(1);
		const done = await ctx.store.getStep(trade.id);
		expect(done.status).toBe('done');
		expect(done.result.receipt.signature).toBe('THREEsyntheticSig');
		expect((await ctx.store.getRunById(run.id)).status).toBe('done');
	});

	it('refuses an inbox row whose hash differs from the step', async () => {
		const ctx = setup();
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL', mode: 'live' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		const out = await ctx.runner.executeApprovedStep(trade.id, { inboxRow: { user_id: USER, payload_hash: '0'.repeat(64) } });
		expect(out.status).toBe('error');
		expect(ctx.specialists.executeTrade).not.toHaveBeenCalled();
	});

	it('picks up a denial taken in the inbox', async () => {
		let deniedElsewhere = false;
		const bridge = {
			shouldMirror: async () => true,
			mirror: async ({ step, approval }) => ({ request: { id: '00000000-0000-4000-8000-0000000000ee', source_ref: step.id, payload_hash: approval.payload_hash }, autoApproved: false }),
			link: async () => '/approvals/x',
			statuses: async (ids) => new Map(ids.map((id) => [id, deniedElsewhere ? 'denied' : 'pending'])),
			runAuto: vi.fn(),
			decide: vi.fn(),
		};
		const ctx = setup({ bridge });
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL', mode: 'live' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		expect(trade.status).toBe('needs_approval');
		deniedElsewhere = true;
		await ctx.runner.refresh(run.id);
		expect((await ctx.store.getStep(trade.id)).status).toBe('denied');
		expect((await ctx.store.getRunById(run.id)).status).toBe('done');
	});
});

describe('memory', () => {
	it('saves preferences and reports what it remembered', async () => {
		const ctx = setup();
		const events = [];
		const { run } = await ctx.runner.start({
			squad: ctx.squad,
			utterance: 'Remember my default trade size is 0.1 SOL and keep risk low',
			onCreated: (r) => { subscribe(r.id, (ev) => events.push(ev)); },
		});
		expect(ctx.specialists.remember).toHaveBeenCalledTimes(2);
		expect(events.filter((e) => e.kind === 'memory').map((e) => e.payload.saved).filter(Boolean)).toEqual(['default_trade_sol', 'risk']);
		expect(run.status).toBe('done');
	});

	it('a low remembered risk keeps a solo agent out of caution coins', async () => {
		const ctx = setup({ squad: makeSquad({ kind: 'agent', policy: { per_trade_sol: null, daily_budget_sol: null, allow_caution: null } }), specialists: makeSpecialists({ verdict: 'caution' }), prefs: { risk: 'low' } });
		const { run } = await ctx.runner.start({ squad: ctx.squad, utterance: 'Research $THREE and buy 0.05 SOL' });
		const trade = await stepOf(ctx.store, run.id, 'trade');
		expect(trade.status).toBe('skipped');
		expect(trade.error).toMatch(/risk preference is low/);
	});
});

describe('summary', () => {
	it('counts each outcome in the headline', () => {
		const s = summarizeRun([
			{ id: 'a', step_key: 's1', role: 'researcher', title: 'Research', status: 'done', evidence: { summary: 'Pass.' } },
			{ id: 'b', step_key: 's2', role: 'trader', title: 'Buy', status: 'denied' },
		]);
		expect(s.headline).toBe('2 steps: 1 done, 1 declined.');
		expect(s.lines[1].text).toMatch(/declined/);
	});
});

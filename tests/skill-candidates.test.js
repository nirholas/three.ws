// Skills from experience (api/_lib/skill-candidates.js, skill-candidate-bundle.js).
// The pure half runs without a database; the stored half runs against an
// in-process Postgres (PGlite) with the real migration, so check constraints,
// ON CONFLICT and the jsonb operators are the production ones.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	// Modules build sql fragments at import time, before beforeEach runs.
	holder.db = createPgliteSql();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/agent-learning/settings.js', () => ({
	getMemorySettings: async () => ({ enabled: true, skill_drafts_enabled: true }),
}));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));
vi.mock('../api/_lib/agent-tools.js', () => {
	const tool = (name) => ({ description: name, parameters: { type: 'object', properties: {} }, handler: async (args) => ({ tool: name, args }) });
	return { AGENT_TOOLS: { token_info: tool('token_info'), token_holders: tool('token_holders'), token_safety: tool('token_safety') } };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const USER = '00000000-0000-4000-8000-000000000001';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const migration = readFileSync('api/_lib/migrations/20261023130000_agent_skill_candidates.sql', 'utf8');

// Values that must never reach a stored draft.
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const WALLET_LABEL = 'treasury-wallet-prod-7';
const AMOUNT = 48213.77;

const RUN = [
	{ tool: 'token_info', args: { mint: MINT, network: 'solana' } },
	{ tool: 'token_holders', args: { mint: MINT, limit: 20, label: WALLET_LABEL } },
	{ tool: 'token_safety', args: { mint: MINT, probe_sol: AMOUNT } },
];

const PLAN = {
	name: 'Vet a token before buying',
	description: 'Look up a token, check who holds it, then run the safety check before any trade.',
	when_to_use: 'Use before buying a token the user has not traded before.',
	step_notes: ['Read the basic token facts.', 'See how concentrated the holders are.', 'Simulate a round trip to catch honeypots.'],
	param_descriptions: { mint: 'The token mint to vet.', network: 'Which network the mint is on.', limit: 'How many holders to list.', label: 'A label for the report.', probe_sol: 'Probe size in SOL.' },
};

const completeWith = (plan) => async () => ({ text: JSON.stringify(plan), provider: 'test', model: 'test-model' });

let bundleLib;
let cand;

beforeAll(async () => {
	bundleLib = await import('../api/_lib/skill-candidate-bundle.js');
	cand = await import('../api/_lib/skill-candidates.js');
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`
		create table users (id uuid primary key);
		create table agent_identities (id uuid primary key, user_id uuid not null, name text, deleted_at timestamptz, skills text[] not null default '{}'::text[]);
		create table marketplace_skills (
			id uuid primary key default gen_random_uuid(), author_id uuid, name text, slug text unique, description text, category text,
			tags text[], schema_json jsonb, content text, is_public boolean, price_per_call_usd numeric
		);
		insert into users values ('${USER}');
		insert into agent_identities (id, user_id, name) values ('${AGENT}', '${USER}', 'Scout');
	`);
	await holder.db.exec(migration);
});

const rows = () => holder.db.query('select * from agent_skill_candidates');

describe('evidence: the detector fires only on verified success', () => {
	const ok = { signal: 'multi_tool_turn', calls: RUN, finalAnswer: 'done' };

	it('accepts a clean multi-tool turn', () => {
		expect(bundleLib.assessEvidence(ok)).toEqual({ ok: true });
	});

	it('rejects a turn with a tool error or a blocked call', () => {
		expect(bundleLib.assessEvidence({ ...ok, calls: [...RUN.slice(0, 2), { ...RUN[2], error: 'rpc down' }] })).toEqual({ ok: false, reason: 'tool_error_in_run' });
		expect(bundleLib.assessEvidence({ ...ok, calls: [...RUN.slice(0, 2), { ...RUN[2], blocked: true }] })).toEqual({ ok: false, reason: 'tool_error_in_run' });
	});

	it('rejects a run that is a lookup rather than a procedure', () => {
		expect(bundleLib.assessEvidence({ ...ok, calls: RUN.slice(0, 2) }).reason).toBe('too_few_steps');
		expect(bundleLib.assessEvidence({ ...ok, calls: [RUN[0], RUN[0], RUN[0]] }).reason).toBe('not_enough_distinct_tools');
	});

	it('rejects a turn that never produced an answer', () => {
		expect(bundleLib.assessEvidence({ ...ok, finalAnswer: '  ' }).reason).toBe('no_answer');
	});

	it('labor needs a passing verdict', () => {
		expect(bundleLib.assessEvidence({ signal: 'labor_escrow_passed', calls: RUN, verdict: { pass: false } }).reason).toBe('verdict_not_pass');
		expect(bundleLib.assessEvidence({ signal: 'labor_escrow_passed', calls: RUN, verdict: null }).reason).toBe('verdict_not_pass');
		expect(bundleLib.assessEvidence({ signal: 'labor_escrow_passed', calls: RUN, verdict: { pass: true } }).ok).toBe(true);
	});

	it('a trade needs positive realized PnL', () => {
		for (const pnlLamports of [0, -5, null, 'NaN']) {
			expect(bundleLib.assessEvidence({ signal: 'profitable_trade', calls: RUN, pnlLamports }).reason).toBe('trade_not_profitable');
		}
		expect(bundleLib.assessEvidence({ signal: 'profitable_trade', calls: RUN, pnlLamports: '120000' }).ok).toBe(true);
	});

	it('rejects an unknown signal', () => {
		expect(bundleLib.assessEvidence({ ...ok, signal: 'vibes' }).reason).toBe('unknown_signal');
	});

	it('records nothing for an unverified run', async () => {
		const failed = [...RUN.slice(0, 2), { ...RUN[2], error: 'rpc down' }];
		const out = await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:1', goal: 'vet it', calls: failed, finalAnswer: 'x', complete: completeWith(PLAN),
		});
		expect(out).toEqual({ status: 'skipped', reason: 'tool_error_in_run' });
		expect(await rows()).toHaveLength(0);
	});
});

describe('redaction: no literal survives', () => {
	it('reduces arguments to shapes', () => {
		expect(bundleLib.redactShape({ mint: MINT, limit: 20, ratio: 0.5, live: true, ids: ['a', 'b'], nested: { who: WALLET_LABEL } })).toEqual({
			mint: 'string', limit: 'integer', ratio: 'number', live: 'boolean', ids: ['string'], nested: { who: 'string' },
		});
	});

	it('does not keep data-like object keys', () => {
		const shape = bundleLib.redactShape({ [MINT]: 5, label: 'x' });
		expect(JSON.stringify(shape)).not.toContain(MINT);
		expect(shape).toEqual({ '<key>': 'integer', label: 'string' });
	});

	it('scrubs the goal sentence', () => {
		const literals = [...bundleLib.collectLiterals(RUN.map((c) => c.args))];
		const goal = `Vet ${MINT} for ${WALLET_LABEL}, probe 48213.77 SOL, see https://example.com/report?id=9 or mail ops@example.com`;
		const scrubbed = bundleLib.scrubGoal(goal, literals);
		for (const bad of [MINT, WALLET_LABEL, '48213.77', 'https://', 'ops@example.com']) expect(scrubbed).not.toContain(bad);
		expect(scrubbed).toContain('Vet');
	});

	it('stores no argument value from the evidence run, anywhere in the row', async () => {
		const out = await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:redact', calls: RUN, finalAnswer: 'Looks safe.',
			goal: `Vet ${MINT} (${WALLET_LABEL}) with a ${AMOUNT} SOL probe`, complete: completeWith(PLAN),
		});
		expect(out.status).toBe('drafted');
		const [row] = await rows();
		const everything = JSON.stringify(row);
		for (const value of [MINT, WALLET_LABEL, String(AMOUNT), '48213', 'solana']) expect(everything).not.toContain(value);
		expect(row.steps).toEqual([
			{ tool: 'token_info', args: { mint: 'string', network: 'string' } },
			{ tool: 'token_holders', args: { mint: 'string', limit: 'integer', label: 'string' } },
			{ tool: 'token_safety', args: { mint: 'string', probe_sol: 'number' } },
		]);
	});

	it('the model prompt carries shapes and a scrubbed goal, never values', async () => {
		const seen = [];
		await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:prompt', calls: RUN, finalAnswer: 'ok',
			goal: `Vet ${MINT}`, complete: async (messages) => { seen.push(JSON.stringify(messages)); return completeWith(PLAN)(); },
		});
		expect(seen).toHaveLength(1);
		for (const value of [MINT, WALLET_LABEL, String(AMOUNT)]) expect(seen[0]).not.toContain(value);
	});
});

describe('the drafted bundle', () => {
	it('is a valid four-file bundle that calls only the recorded tools, in order', async () => {
		const out = await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:bundle', calls: RUN, finalAnswer: 'ok', goal: 'vet a token', complete: completeWith(PLAN),
		});
		const { bundle } = out.candidate;
		expect(out.candidate.status).toBe('draft');
		expect(cand.validateCandidateBundle(bundle)).toEqual([]);
		expect(bundle.manifest.requires.tools).toEqual(['token_info', 'token_holders', 'token_safety']);
		expect(bundle.manifest.provides.tools).toEqual([bundle.tools.tools[0].name]);
		expect(bundle.handlers_src).toContain(`export async function ${bundle.tools.tools[0].name}`);
		expect(bundle.tools.tools[0].input_schema.required).toEqual(['mint', 'network', 'limit', 'label', 'probe_sol']);
	});

	it('keeps a draft that fails validation with its errors, and it is never installable or publishable', async () => {
		const leaky = { ...PLAN, step_notes: [`Look up ${WALLET_LABEL}.`, PLAN.step_notes[1], PLAN.step_notes[2]] };
		const out = await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:leaky', calls: RUN, finalAnswer: 'ok', goal: 'vet a token', complete: completeWith(leaky),
		});
		expect(out.status).toBe('invalid');
		const [row] = await rows();
		expect(row.status).toBe('invalid');
		expect(row.validation_errors[0]).toContain('value from the evidence run');
		expect(row.bundle).not.toBeNull();

		await expect(cand.acceptCandidate({ agentId: AGENT, userId: USER, id: row.id })).rejects.toMatchObject({ code: 'not_installable' });
		await expect(cand.publishCandidate({ agentId: AGENT, userId: USER, id: row.id })).rejects.toMatchObject({ code: 'not_publishable' });
		expect((await holder.db.query('select skills from agent_identities'))[0].skills).toEqual([]);
		expect(await holder.db.query('select id from marketplace_skills')).toHaveLength(0);
	});

	it('refuses to install a stored draft whose bundle was tampered into invalidity', async () => {
		const out = await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:tamper', calls: RUN, finalAnswer: 'ok', goal: 'vet a token', complete: completeWith(PLAN),
		});
		await holder.db.query(`update agent_skill_candidates set bundle = jsonb_set(bundle, '{handlers_src}', '"this is not javascript ((("') where id = $1`, [out.candidate.id]);
		await expect(cand.acceptCandidate({ agentId: AGENT, userId: USER, id: out.candidate.id })).rejects.toMatchObject({ code: 'invalid_bundle', status: 422 });
		expect((await rows())[0].status).toBe('invalid');
	});

	it('keeps a draft the model could not write, with the reason', async () => {
		const out = await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:nomodel', calls: RUN, finalAnswer: 'ok', goal: 'vet a token', complete: async () => null,
		});
		expect(out.status).toBe('invalid');
		expect(out.candidate.bundle).toBeNull();
		expect(out.candidate.validation_errors[0]).toContain('no model');
	});

	it('records one candidate per run', async () => {
		const args = { agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:once', calls: RUN, finalAnswer: 'ok', goal: 'vet', complete: completeWith(PLAN) };
		await cand.recordSkillCandidate(args);
		expect(await cand.recordSkillCandidate(args)).toEqual({ status: 'skipped', reason: 'already_recorded' });
		expect(await rows()).toHaveLength(1);
	});
});

describe('owner approval', () => {
	async function draft(sourceRef = 'run:own') {
		const out = await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef, calls: RUN, finalAnswer: 'ok', goal: 'vet a token', complete: completeWith(PLAN),
		});
		return out.candidate;
	}

	it('nothing is installed or published until the owner acts', async () => {
		const c = await draft();
		expect(c.status).toBe('draft');
		expect((await holder.db.query('select skills from agent_identities'))[0].skills).toEqual([]);
		expect(await holder.db.query('select id from marketplace_skills')).toHaveLength(0);
		expect(await cand.getInstalledBundleFile(AGENT, c.id, 'manifest.json')).toBeNull();
	});

	it('accepting installs on this agent only and serves the bundle', async () => {
		const c = await draft();
		const installed = await cand.acceptCandidate({ agentId: AGENT, userId: USER, id: c.id });
		expect(installed.status).toBe('installed');
		const uri = `/api/agents/${AGENT}/skill-candidates/${c.id}/bundle/`;
		expect(installed.bundle_uri).toBe(uri);
		expect((await holder.db.query('select skills from agent_identities'))[0].skills).toEqual([uri]);
		expect((await cand.getInstalledBundleFile(AGENT, c.id, 'manifest.json')).body.name).toBe('vet-a-token-before-buying');
		expect((await cand.getInstalledBundleFile(AGENT, c.id, 'handlers')).type).toBe('javascript');
		expect(await cand.getInstalledBundleFile(AGENT, c.id, 'secrets.json')).toBeNull();
	});

	it('dismissing leaves no install, and uninstalling removes it', async () => {
		const c = await draft('run:dismiss');
		const dismissed = await cand.dismissCandidate({ agentId: AGENT, userId: USER, id: c.id });
		expect(dismissed.status).toBe('dismissed');
		expect((await holder.db.query('select skills from agent_identities'))[0].skills).toEqual([]);
		await expect(cand.acceptCandidate({ agentId: AGENT, userId: USER, id: c.id })).rejects.toMatchObject({ code: 'not_installable' });

		const d = await draft('run:uninstall');
		await cand.acceptCandidate({ agentId: AGENT, userId: USER, id: d.id });
		await cand.dismissCandidate({ agentId: AGENT, userId: USER, id: d.id });
		expect((await holder.db.query('select skills from agent_identities'))[0].skills).toEqual([]);
		expect(await cand.getInstalledBundleFile(AGENT, d.id, 'manifest.json')).toBeNull();
	});

	it('only the owner can read or act', async () => {
		const c = await draft();
		const stranger = '00000000-0000-4000-8000-0000000000ff';
		await expect(cand.listCandidates({ agentId: AGENT, userId: stranger })).rejects.toMatchObject({ status: 403 });
		await expect(cand.acceptCandidate({ agentId: AGENT, userId: stranger, id: c.id })).rejects.toMatchObject({ status: 403 });
	});

	it('publishing goes through the marketplace table with a tool schema', async () => {
		const c = await draft();
		const { skill } = await cand.publishCandidate({ agentId: AGENT, userId: USER, id: c.id });
		const [pub] = await holder.db.query('select * from marketplace_skills where id = $1', [skill.id]);
		expect(pub.author_id).toBe(USER);
		expect(pub.schema_json[0].function.name).toBe(c.bundle.tools.tools[0].name);
		expect(pub.content).toBe(c.bundle.skill_md);
		await expect(cand.publishCandidate({ agentId: AGENT, userId: USER, id: c.id })).rejects.toMatchObject({ code: 'already_published' });
	});
});

describe('installed skills in the next run', () => {
	it('exposes an installed skill as a callable tool that replays its steps', async () => {
		const c = (await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:next', calls: RUN, finalAnswer: 'ok', goal: 'vet a token', complete: completeWith(PLAN),
		})).candidate;
		expect((await cand.installedCandidateTools(AGENT)).schemas).toEqual([]);
		await cand.acceptCandidate({ agentId: AGENT, userId: USER, id: c.id });

		const tools = await cand.installedCandidateTools(AGENT);
		const name = c.bundle.tools.tools[0].name;
		expect(tools.schemas.map((s) => s.function.name)).toEqual([name]);
		const out = await tools.handlers[name]({ mint: 'M', network: 'solana', limit: 5, label: 'L', probe_sol: 0.1 });
		expect(out.ok).toBe(true);
		expect(out.data.steps.map((s) => s.tool)).toEqual(['token_info', 'token_holders', 'token_safety']);
		expect(out.data.steps[1].result.args).toEqual({ mint: 'M', limit: 5, label: 'L' });
		expect(await tools.handlers[name]({ mint: 'M' })).toMatchObject({ ok: false });
	});

	it('proposes a revision when a later run deviates and succeeds, and leaves the installed skill alone', async () => {
		const c = (await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:rev0', calls: RUN, finalAnswer: 'ok', goal: 'vet a token', complete: completeWith(PLAN),
		})).candidate;
		await cand.acceptCandidate({ agentId: AGENT, userId: USER, id: c.id });
		const name = c.bundle.tools.tools[0].name;

		const extendedPlan = { ...PLAN, step_notes: [...PLAN.step_notes, 'Pull the pump.fun curve state.'], param_descriptions: { ...PLAN.param_descriptions, slippage: 'Max slippage.' } };
		const out = await cand.learnFromRun({
			agentId: AGENT, userId: USER, runRef: 'rev1', goal: 'vet a token',
			calls: [{ tool: name, args: {}, result: { ok: true } }, { tool: 'pump_curve', args: { mint: MINT, slippage: 100 } }],
			finalAnswer: 'ok', complete: completeWith(extendedPlan),
		});
		expect(out.status).toBe('proposed');
		const [row] = await rows();
		expect(row.bundle.manifest.version).toBe('0.1.0');
		expect(row.revisions).toHaveLength(1);
		expect(row.revisions[0]).toMatchObject({ kind: 'extend', status: 'pending', from_version: '0.1.0', to_version: '0.1.1' });
		expect(row.revisions[0].diff).toContain('pump_curve');
		expect(JSON.stringify(row)).not.toContain(MINT);

		const accepted = await cand.acceptRevision({ agentId: AGENT, userId: USER, id: c.id, revisionId: row.revisions[0].id });
		expect(accepted.bundle.manifest.version).toBe('0.1.1');
		expect(accepted.steps.map((s) => s.tool)).toEqual(['token_info', 'token_holders', 'token_safety', 'pump_curve']);
		expect(accepted.revisions[0].status).toBe('accepted');
		await expect(cand.acceptRevision({ agentId: AGENT, userId: USER, id: c.id, revisionId: row.revisions[0].id })).rejects.toMatchObject({ code: 'wrong_state' });
	});

	it('proposes nothing when the run followed the skill', async () => {
		const c = (await cand.recordSkillCandidate({
			agentId: AGENT, userId: USER, signal: 'multi_tool_turn', sourceRef: 'run:same', calls: RUN, finalAnswer: 'ok', goal: 'vet a token', complete: completeWith(PLAN),
		})).candidate;
		await cand.acceptCandidate({ agentId: AGENT, userId: USER, id: c.id });
		const name = c.bundle.tools.tools[0].name;
		const out = await cand.learnFromRun({
			agentId: AGENT, userId: USER, runRef: 'same1', goal: 'vet', finalAnswer: 'ok', complete: completeWith(PLAN),
			calls: [{ tool: name, args: {}, result: { ok: true } }, { tool: 'token_info', args: {} }],
		});
		expect(out.status).toBe('skipped');
		expect((await rows())[0].revisions).toEqual([]);
	});
});

describe('revision planning', () => {
	const current = [{ tool: 'a', args: {} }, { tool: 'b', args: {} }, { tool: 'c', args: {} }];

	it('extends with tools the skill did not have', () => {
		const plan = bundleLib.planRevisionSteps({ currentSteps: current, observed: [{ tool: 'd', args: {} }], skillCallOk: true });
		expect(plan.kind).toBe('extend');
		expect(plan.steps.map((s) => s.tool)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('repairs from the run that succeeded after the skill failed', () => {
		const observed = [{ tool: 'a', args: {} }, { tool: 'x', args: {} }, { tool: 'c', args: {} }];
		expect(bundleLib.planRevisionSteps({ currentSteps: current, observed, skillCallOk: false })).toMatchObject({ kind: 'repair' });
	});

	it('does nothing without a deviation', () => {
		expect(bundleLib.planRevisionSteps({ currentSteps: current, observed: [{ tool: 'a', args: {} }], skillCallOk: true })).toBeNull();
		expect(bundleLib.planRevisionSteps({ currentSteps: current, observed: current, skillCallOk: false })).toBeNull();
		expect(bundleLib.planRevisionSteps({ currentSteps: current, observed: [], skillCallOk: true })).toBeNull();
	});
});

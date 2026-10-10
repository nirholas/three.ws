// The squad coordinator's planner (api/_lib/team-chat/plan.js): plain language
// in, role-tagged steps out. The rules planner is pinned directly; the model
// planner's output is pinned through validatePlan, the gate every model plan
// passes before it can run: only coins, amounts and recipients the owner
// actually wrote survive it.

import { describe, it, expect } from 'vitest';
import {
	parsePlanRules, validatePlan, buildPlan, parseQuantity, parsePreferences, extractJson, mintLabel, KIND_ROLE, MAX_STEPS,
} from '../api/_lib/team-chat/plan.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SYNTH = 'THREEsynthetic1111111111111111111111111111';
const RECIPIENT = 'THREEsyntheticRecipient11111111111111111';

const kinds = (plan) => plan.steps.map((s) => s.kind);

describe('rules planner', () => {
	it('turns one sentence into research, entry check and a dependent trade', () => {
		const plan = parsePlanRules('Research $THREE and buy 0.05 SOL if market cap is under $5M');
		expect(kinds(plan)).toEqual(['research', 'entry_check', 'trade']);
		const [research, entry, trade] = plan.steps;
		expect(research).toMatchObject({ key: 's1', role: 'researcher', params: { mint: THREE } });
		expect(entry.role).toBe('entry');
		expect(entry.params.condition).toEqual({ all: [{ signal: 'mcap_usd', op: 'lt', value: 5_000_000 }] });
		expect(trade).toMatchObject({ role: 'trader', depends_on: ['s1', 's2'], params: { side: 'buy', mint: THREE, amount: 0.05, amount_unit: 'SOL' } });
		expect(plan.clarify).toBeNull();
	});

	it('tags every step with the role that owns its kind', () => {
		for (const text of [
			`buy half a sol of ${SYNTH} with 3% slippage`,
			'launch a coin called Moon Cat ($MCAT) about a cat on the moon',
			'snipe new launches with 0.05 SOL each if smart money score over 60',
			`send 1 SOL to ${RECIPIENT}`,
			'Remember my default trade size is 0.1 SOL and keep risk low',
		]) {
			const plan = parsePlanRules(text);
			expect(plan.steps.length).toBeGreaterThan(0);
			for (const s of plan.steps) expect(s.role).toBe(KIND_ROLE[s.kind]);
		}
	});

	it('reads sizes and slippage in plain words', () => {
		const plan = parsePlanRules(`buy half a sol of ${SYNTH} with 3% slippage`);
		const trade = plan.steps.find((s) => s.kind === 'trade');
		expect(trade.params).toMatchObject({ amount: 0.5, slippage_bps: 300 });
		expect(parseQuantity('$1.5m')).toBe(1_500_000);
		expect(parseQuantity('50,000')).toBe(50_000);
		expect(parseQuantity('2 million')).toBe(2_000_000);
	});

	it('sells a percentage of a position without a research gate', () => {
		const plan = parsePlanRules(`sell half my ${SYNTH}`);
		expect(kinds(plan)).toEqual(['trade']);
		expect(plan.steps[0].params).toMatchObject({ side: 'sell', amount: 50, amount_unit: 'percent' });
	});

	it('falls back to the remembered default size and says so', () => {
		const plan = parsePlanRules('buy three', { prefs: { default_trade_sol: 0.2 } });
		expect(plan.steps.find((s) => s.kind === 'trade').params.amount).toBe(0.2);
		expect(plan.notes.join(' ')).toMatch(/remembered default/i);
	});

	it('remembers preferences as their own steps', () => {
		const plan = parsePlanRules('Remember my default trade size is 0.1 SOL and keep risk low');
		expect(plan.steps.map((s) => s.params)).toEqual([
			{ key: 'default_trade_sol', value: 0.1 },
			{ key: 'risk', value: 'low' },
		]);
		expect(parsePreferences('keep risk low').find((p) => p.key === 'risk').value).toBe('low');
	});

	it('extracts a launch plan with the ticker and description', () => {
		const plan = parsePlanRules('launch a coin called Moon Cat ($MCAT) about a cat on the moon with 0.1 SOL initial buy');
		expect(plan.steps[0]).toMatchObject({ kind: 'launch', role: 'launcher', params: { name: 'Moon Cat', symbol: 'MCAT', initial_buy_sol: 0.1 } });
	});

	it('asks instead of guessing a coin', () => {
		expect(parsePlanRules('buy some of that dog coin').steps).toEqual([]);
		expect(parsePlanRules('buy some of that dog coin').clarify).toMatch(/mint address/i);
		expect(parsePlanRules('check these three coins').steps).toEqual([]);
		expect(parsePlanRules('hello there').clarify).toMatch(/research a coin/i);
	});

	it('does not read "three" in a plain sentence as the coin', () => {
		const plan = parsePlanRules('check these three coins');
		expect(plan.steps.some((s) => s.params?.mint === THREE)).toBe(false);
	});

	it('labels $THREE and shortens anything else', () => {
		expect(mintLabel(THREE)).toBe('$THREE');
		expect(mintLabel(SYNTH)).not.toContain(SYNTH);
	});
});

describe('model plan validation', () => {
	it('keeps grounded steps and gates a buy on research and an entry check', () => {
		const v = validatePlan({
			steps: [
				{ kind: 'research', params: { mint: SYNTH } },
				{ kind: 'trade', params: { side: 'buy', mint: SYNTH, amount: 0.1 } },
			],
		}, { utterance: `look into ${SYNTH} and buy 0.1 sol` });
		expect(v.ok).toBe(true);
		expect(kinds(v)).toEqual(['research', 'entry_check', 'trade']);
		expect(v.steps[2].depends_on).toEqual(['s1', 's2']);
	});

	it('drops an amount the owner never stated', () => {
		const v = validatePlan({ steps: [{ kind: 'trade', params: { side: 'buy', mint: SYNTH, amount: 5 } }] }, { utterance: `buy 0.1 sol of ${SYNTH}` });
		expect(v.steps.some((s) => s.kind === 'trade' && s.params.amount === 5)).toBe(false);
		expect(v.notes.join(' ')).toMatch(/did not state/);
	});

	it('drops a coin the owner never named', () => {
		const v = validatePlan({ steps: [{ kind: 'research', params: { mint: SYNTH } }] }, { utterance: 'research $THREE' });
		expect(v.steps.some((s) => s.params?.mint === SYNTH)).toBe(false);
	});

	it('drops a transfer to a recipient the owner never wrote', () => {
		const v = validatePlan({
			steps: [{ kind: 'transfer', params: { amount: 1, asset: 'SOL', recipient: RECIPIENT } }],
		}, { utterance: `research ${SYNTH}` });
		expect(v.steps.some((s) => s.kind === 'transfer')).toBe(false);
		expect(v.dropped.join(' ')).toMatch(/recipient you did not name/);
	});

	it('caps the plan length', () => {
		const steps = Array.from({ length: 20 }, () => ({ kind: 'research', params: { mint: THREE } }));
		const v = validatePlan({ steps }, { utterance: 'research $THREE' });
		expect(v.steps.length).toBeLessThanOrEqual(MAX_STEPS);
	});

	it('parses JSON out of a fenced model reply and rejects junk', () => {
		expect(extractJson('```json\n{"steps":[]}\n```')).toEqual({ steps: [] });
		expect(extractJson('no json here')).toBeNull();
	});
});

describe('buildPlan', () => {
	it('uses the rules planner when the model is off', async () => {
		const plan = await buildPlan('Research $THREE and buy 0.05 SOL if market cap is under $5M', { useModel: false });
		expect(plan.planner).toBe('rules');
		expect(kinds(plan)).toEqual(['research', 'entry_check', 'trade']);
	});
});

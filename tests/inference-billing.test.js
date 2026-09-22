import { describe, it, expect } from 'vitest';
import {
	priceInference,
	normalizeInferenceBudget,
	getInferenceBudget,
	applyInferenceBudget,
	exhaustedWindow,
	suggestedBudget,
	inferencePricing,
	estimateTokens,
} from '../api/_lib/inference-billing.js';
import { normalizeTopupAmount, creditsForUsdc } from '../api/_lib/inference-topup.js';
import { normalizeIntent, describeIntent } from '../api/_lib/wallet-intents.js';
import { INFERENCE_USD_PER_MTOK, INFERENCE_MIN_CALL_USD, CATALOG } from '../api/_lib/pricing/catalog.js';

describe('inference pricing', () => {
	it('prices tokens at the published per-million rate, rounded up to the micro-dollar', () => {
		expect(priceInference({ inputTokens: 962, outputTokens: 5 })).toBe(0.000491);
		expect(priceInference({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(INFERENCE_USD_PER_MTOK.input);
		expect(priceInference({ inputTokens: 0, outputTokens: 1_000_000 })).toBe(INFERENCE_USD_PER_MTOK.output);
	});

	it('never charges less than the minimum per call', () => {
		expect(priceInference({ inputTokens: 0, outputTokens: 0 })).toBe(INFERENCE_MIN_CALL_USD);
		expect(priceInference({ inputTokens: 3 })).toBe(INFERENCE_MIN_CALL_USD);
	});

	it('publishes the rate, the 1:1 USDC credit rate and a zero top-up fee', () => {
		expect(inferencePricing()).toMatchObject({ model: 'three-ws/agent', usdc_credit_rate: 1, topup_fee_usd: 0 });
		expect(CATALOG['inference.agent']).toMatchObject({ category: 'inference', usd: null });
	});

	it('estimates tokens at about four characters each', () => {
		expect(estimateTokens('abcdefgh')).toBe(2);
		expect(estimateTokens(null)).toBe(0);
	});
});

describe('inference budgets', () => {
	it('accepts either field style and clears on null or empty', () => {
		expect(normalizeInferenceBudget({ daily: 1, monthly: 20 })).toEqual({ daily_usd: 1, monthly_usd: 20 });
		expect(normalizeInferenceBudget({ daily_usd: 0.5 })).toEqual({ daily_usd: 0.5, monthly_usd: null });
		expect(normalizeInferenceBudget(null)).toBeNull();
		expect(normalizeInferenceBudget({})).toBeNull();
	});

	it('rejects non-positive, oversized, inverted and malformed budgets', () => {
		expect(() => normalizeInferenceBudget({ daily: -1 })).toThrow(/positive/);
		expect(() => normalizeInferenceBudget({ daily: 1e9 })).toThrow(/exceed/);
		expect(() => normalizeInferenceBudget({ daily: 10, monthly: 5 })).toThrow(/larger/);
		expect(() => normalizeInferenceBudget('5')).toThrow(/object/);
	});

	it('stores the budget on meta and drops a prior exhaustion stamp', () => {
		const meta = { solana_address: 'x', inference_budget: { daily_usd: 1, exhausted: { key: '2026-09-22' } } };
		const next = applyInferenceBudget(meta, { daily_usd: 2, monthly_usd: null });
		expect(next.solana_address).toBe('x');
		expect(next.inference_budget.daily_usd).toBe(2);
		expect(next.inference_budget.exhausted).toBeUndefined();
		expect(getInferenceBudget(next)).toEqual({ daily_usd: 2, monthly_usd: null });
		expect(applyInferenceBudget(next, null).inference_budget).toBeUndefined();
	});

	it('names the window that is used up, daily first', () => {
		const budget = { daily_usd: 1, monthly_usd: 10 };
		expect(exhaustedWindow(budget, { today_usd: 0.5, month_usd: 3 })).toBeNull();
		expect(exhaustedWindow(budget, { today_usd: 1, month_usd: 3 })).toBe('daily');
		expect(exhaustedWindow(budget, { today_usd: 0.2, month_usd: 10 })).toBe('monthly');
		expect(exhaustedWindow(null, { today_usd: 99, month_usd: 99 })).toBeNull();
	});

	it('suggests a raise that actually readmits the next call', () => {
		expect(suggestedBudget(0.0002, 0.000491)).toBeGreaterThan(0.000491);
		expect(suggestedBudget(1, 0.5)).toBe(2);
	});
});

describe('wallet top-ups', () => {
	it('bounds and truncates amounts to USDC precision', () => {
		expect(normalizeTopupAmount(1.1234567)).toBe(1.123456);
		expect(() => normalizeTopupAmount(0.05)).toThrow(/smallest/);
		expect(() => normalizeTopupAmount(5000)).toThrow(/largest/);
		expect(() => normalizeTopupAmount('abc')).toThrow(/positive/);
	});

	it('credits one dollar per USDC with no fee', () => {
		expect(creditsForUsdc(5)).toBe(5);
	});
});

describe('the fund_inference wallet intent', () => {
	it('compiles "when credits fall below 100, top up 5 USDC"', () => {
		const r = normalizeIntent({
			trigger_type: 'credits_below',
			trigger_config: { threshold_usd: 100 },
			action_type: 'fund_inference',
			action_config: { amount_usdc: 5 },
		});
		expect(r.ok).toBe(true);
		expect(r.intent.trigger).toEqual({ type: 'credits_below', threshold_usd: 100 });
		expect(r.intent.action).toEqual({ type: 'fund_inference', amount_usdc: 5 });
		expect(describeIntent(r.intent)).toMatch(/at most once a day/);
	});

	it('requires a threshold and an amount, and refuses other pairings', () => {
		expect(normalizeIntent({ trigger_type: 'credits_below', action_type: 'fund_inference', action_config: { amount_usdc: 5 } }).error).toBe('needs_threshold');
		expect(normalizeIntent({ trigger_type: 'credits_below', trigger_config: { threshold_usd: 1 }, action_type: 'fund_inference' }).error).toBe('needs_amount');
		expect(normalizeIntent({ trigger_type: 'on_tip_received', action_type: 'fund_inference', action_config: { amount_usdc: 5 } }).error).toBe('bad_pairing');
		expect(normalizeIntent({ trigger_type: 'credits_below', trigger_config: { threshold_usd: 1 }, action_type: 'tip', action_config: { amount_sol: 1, destination: 'x' } }).error).toBe('bad_pairing');
	});
});

// How v1 chat messages pay for their model calls.
//
// Every account gets a daily free allowance of messages, set in
// app_settings['free_tier'] and metered by api/_lib/free-tier.js (the same
// allowance /pricing shows and GET /api/v1/me/free-tier reports). It covers
// the free open models the roster marks `free` (api/_lib/model-roster.js) and
// the platform's free-first chain when no model is named. Each message draws
// one unit; the day resets at 00:00 UTC.
//
//   • A free model named explicitly (per message or as the agent's default)
//     runs ONLY on the allowance. Once it is spent the call is refused with a
//     429 free_tier_exhausted carrying the reset time: a free model never
//     quietly starts costing credits.
//   • No model named: the allowance pays first; past it the platform chain is
//     billed from credits at the published three-ws/agent rate through
//     chargeInference (api/_lib/inference-billing.js), which also enforces the
//     per-agent inference budget.
//   • A paid model named explicitly is billed at that model's list price
//     (api/_lib/llm-pricing.js), because the flat agent rate would not cover it.
// assertInferenceAllowed gates every billed call up front, so an empty balance
// or an exhausted agent budget is refused before any tokens are spent.

import { debitCredits } from '../credits.js';
import { MODEL_CATALOG, resolveModelId, isFreeTierModel } from '../chat-models.js';
import { isFreeLane } from '../llm-pricing.js';
import { assertInferenceAllowed, chargeInference } from '../inference-billing.js';
import { consumeFreeMessage, getFreeTierStatus, FreeTierExhaustedError } from '../free-tier.js';
import { freeRosterIds } from '../model-roster.js';

/** Whether a catalog model id draws on credits at its own price. */
export function isPaidModel(model) {
	const id = model ? resolveModelId(model) : null;
	const meta = id ? MODEL_CATALOG[id] : null;
	if (!meta || meta.free) return false;
	if (meta.paid) return true;
	return !isFreeLane(meta.provider, id);
}

/**
 * The caller's free allowance for today.
 * @returns {Promise<{ limit: number, used: number, remaining: number, period: 'utc_day', resetsAt: string, models: string[] }>}
 */
export async function freeTierStatus(userId) {
	const s = await getFreeTierStatus({ userId });
	return {
		limit: s.limit,
		used: s.used,
		remaining: s.remaining,
		period: 'utc_day',
		resetsAt: s.resetAt,
		models: freeRosterIds(),
	};
}

/**
 * Decide how the next call is paid for, and refuse it now if it cannot be.
 * @param {{ userId: string, agent: object|null, model: string|null }} o
 * @returns {Promise<{ free: boolean, allowance: object|null }>}
 * @throws {FreeTierExhaustedError} a named free model with the allowance spent
 */
export async function admitCall({ userId, agent, model }) {
	if (model && isFreeTierModel(model)) {
		const allowance = await consumeFreeMessage({ userId, model });
		return { free: true, allowance };
	}
	if (!isPaidModel(model)) {
		try {
			const allowance = await consumeFreeMessage({ userId, model });
			return { free: true, allowance };
		} catch (err) {
			if (!(err instanceof FreeTierExhaustedError)) throw err;
		}
	}
	await assertInferenceAllowed({ userId, agent });
	return { free: false, allowance: null };
}

/**
 * Bill one completed model call. `event` is the loop's model_call event.
 * @returns {Promise<{ chargedUsd: number, shortfallUsd: number }>}
 */
export async function chargeCall({ userId, agentId, callId, event, model, free }) {
	if (free) return { chargedUsd: 0, shortfallUsd: 0 };
	// The named paid model answered: bill its own metered cost.
	if (isPaidModel(model) && !event.free && event.costMicroUsd > 0) {
		const amountUsd = Math.ceil(event.costMicroUsd) / 1e6;
		try {
			const r = await debitCredits({
				userId,
				amountUsd,
				// Counted by the per-agent budget (inference-billing.js AGENT_SPEND_ACTIONS).
				action: 'agent.model',
				refType: 'agent',
				refId: agentId,
				idempotencyKey: `agent_model:${callId}`,
				meta: { model: event.model, provider: event.provider, input_tokens: event.usage.input, output_tokens: event.usage.output },
			});
			return { chargedUsd: r.chargedUsd ?? amountUsd, shortfallUsd: 0 };
		} catch (err) {
			if (err?.code === 'insufficient_credits') return { chargedUsd: 0, shortfallUsd: amountUsd };
			throw err;
		}
	}
	const r = await chargeInference({
		userId,
		agentId,
		callId,
		inputTokens: event.usage.input,
		outputTokens: event.usage.output,
		estimated: event.usage.estimated,
		provider: event.provider,
		model: event.model,
	});
	return { chargedUsd: r.chargedUsd, shortfallUsd: r.shortfallUsd };
}

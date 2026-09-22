// How v1 chat messages and runs pay for their model calls.
//
// Every account gets FREE_DAILY_CALLS free agent calls per UTC day. A chat
// message counts as one call, and so does each model call a run makes. The
// count comes from the rows the calls themselves write (agent_messages with
// free_tier = true, run model_call steps marked freeTier), so there is no
// separate counter to drift.
//
// Past the free allowance a call is billed from credits, one of two ways:
//   • the platform's free-first chain (no model named) at the published
//     three-ws/agent rate, through chargeInference (api/_lib/inference-billing.js),
//     which also enforces the per-agent inference budget;
//   • a paid model the caller named explicitly, at that model's list price
//     (api/_lib/llm-pricing.js), because the flat agent rate would not cover it.
// assertInferenceAllowed gates every billed call up front, so an empty balance
// or an exhausted agent budget is refused before any tokens are spent.

import { sql } from '../db.js';
import { debitCredits } from '../credits.js';
import { MODEL_CATALOG } from '../chat-models.js';
import { isFreeLane } from '../llm-pricing.js';
import { assertInferenceAllowed, chargeInference } from '../inference-billing.js';

export const FREE_DAILY_CALLS = 50;

function utcDayStart(now = new Date()) {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Whether a catalog model id draws on credits at its own price. */
export function isPaidModel(model) {
	return Boolean(model && MODEL_CATALOG[model] && !isFreeLane(MODEL_CATALOG[model].provider, model));
}

/**
 * The caller's free allowance for today.
 * @returns {Promise<{ limit: number, used: number, remaining: number, period: 'utc_day', resetsAt: string }>}
 */
export async function freeTierStatus(userId, now = new Date()) {
	const since = utcDayStart(now);
	const [row] = await sql`
		SELECT
			(SELECT count(*)::int FROM agent_messages
			  WHERE user_id = ${userId} AND role = 'user' AND free_tier = true AND created_at >= ${since.toISOString()})
			+
			(SELECT count(*)::int FROM agent_run_steps s JOIN agent_runs r ON r.id = s.run_id
			  WHERE r.user_id = ${userId} AND s.kind = 'model_call' AND s.created_at >= ${since.toISOString()}
			    AND (s.output->>'freeTier')::boolean IS TRUE)
			AS used
	`;
	const used = Number(row?.used || 0);
	const resetsAt = new Date(since.getTime() + 86_400_000).toISOString();
	return { limit: FREE_DAILY_CALLS, used, remaining: Math.max(0, FREE_DAILY_CALLS - used), period: 'utc_day', resetsAt };
}

/**
 * Decide how the next call is paid for, and refuse it now if it cannot be.
 * @returns {Promise<{ free: boolean }>}
 */
export async function admitCall({ userId, agent, model }) {
	if (!isPaidModel(model)) {
		const tier = await freeTierStatus(userId);
		if (tier.remaining > 0) return { free: true };
	}
	await assertInferenceAllowed({ userId, agent });
	return { free: false };
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

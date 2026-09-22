// Strategy loop budgets: per-agent daily caps on what loop ticks may spend,
// separate from manual chat.
//
//   credits  model calls inside ticks, charged to the account's prepaid credits
//            at the published inference rate (api/_lib/inference-billing.js)
//   usdc     the USD value of trades the loop buys from the agent wallet
//
// Both are summed from agent_loop_ticks for the current UTC day, so a manual
// chat or a trade the owner made by hand never counts against the loop, and
// the loop never eats into what the owner does by hand beyond the agent's own
// spend policy (which still gates every trade, loop or not).
//
// A cap of 0 on credits means the loop may not call a model at all; a cap of 0
// on usdc means the loop may not buy anything (the default).

import { sql } from '../db.js';

/** Loop spend for an agent since the start of the current UTC day. */
export async function loopSpendToday(agentId) {
	const [row] = await sql`
		SELECT coalesce(sum(spent_credits_usd), 0)::float8 AS credits,
		       coalesce(sum(spent_usd), 0)::float8 AS usdc,
		       count(*)::int AS ticks,
		       count(*) FILTER (WHERE status = 'failed')::int AS failed
		  FROM agent_loop_ticks
		 WHERE agent_id = ${agentId}
		   AND started_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'
	`;
	return {
		creditsUsd: Number(row?.credits || 0),
		usdcUsd: Number(row?.usdc || 0),
		ticks: row?.ticks || 0,
		failed: row?.failed || 0,
	};
}

/**
 * Which cap, if any, stops the loop right now.
 * @param {{ dailyCreditsUsd: number, dailyUsdcUsd: number }} caps
 * @param {{ creditsUsd: number }} spent  loop spend so far today
 * @returns {null | { reason: 'credit_cap', capUsd: number, spentUsd: number }}
 */
export function creditCapVerdict(caps, spent) {
	if (spent.creditsUsd >= caps.dailyCreditsUsd) {
		return { reason: 'credit_cap', capUsd: caps.dailyCreditsUsd, spentUsd: spent.creditsUsd };
	}
	return null;
}

/**
 * Whether a buy of `usd` fits in what is left of the loop's daily USD cap.
 * @returns {null | { reason: 'usdc_cap', capUsd: number, spentUsd: number, requestedUsd: number, remainingUsd: number }}
 */
export function usdcCapVerdict(caps, spent, usd) {
	const remaining = Math.max(0, caps.dailyUsdcUsd - spent.usdcUsd);
	if (!(Number(usd) > 0)) return null;
	if (usd > remaining + 1e-9) {
		return { reason: 'usdc_cap', capUsd: caps.dailyUsdcUsd, spentUsd: spent.usdcUsd, requestedUsd: usd, remainingUsd: remaining };
	}
	return null;
}

// Skill access — single source of truth for "does user X own skill Y on agent Z?".
//
// Usage: every server endpoint that executes a paid skill should call hasSkillAccess
// before doing the work. Agent-to-agent x402 callers go through verifyPaid in x402.js
// instead; this helper covers the human-buyer / direct-API path.
//
// Returns { paid, owned, price?, reason? }
//   paid    — boolean: is this skill priced (i.e. requires payment)?
//   owned   — boolean: does the user have a confirmed (or active trial / valid time-window) purchase?
//   price   — { skill, amount, currency_mint, chain } when paid; undefined otherwise
//   reason  — short string when access is denied ('not_purchased' | 'trial_exhausted' | 'expired')

import { sql } from './db.js';

export async function hasSkillAccess(userId, agentId, skill) {
	const [price] = await sql`
		SELECT skill, amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${agentId} AND skill = ${skill} AND is_active = true
	`;
	if (!price) return { paid: false, owned: true };

	if (!userId) return { paid: true, owned: false, price, reason: 'not_purchased' };

	const [purchase] = await sql`
		SELECT status, valid_until, trial_remaining
		FROM skill_purchases
		WHERE user_id = ${userId} AND agent_id = ${agentId} AND skill = ${skill}
		  AND status IN ('confirmed', 'trial')
		ORDER BY
			(status = 'confirmed') DESC,    -- confirmed beats trial
			confirmed_at DESC NULLS LAST,
			created_at DESC
		LIMIT 1
	`;

	if (!purchase) return { paid: true, owned: false, price, reason: 'not_purchased' };

	if (purchase.status === 'confirmed') {
		// Time-limited access (C3): if valid_until is set, it must be in the future.
		if (purchase.valid_until && new Date(purchase.valid_until) <= new Date()) {
			return { paid: true, owned: false, price, reason: 'expired' };
		}
		return { paid: true, owned: true, price };
	}

	// Trial mode (C2)
	if (purchase.status === 'trial') {
		if ((purchase.trial_remaining ?? 0) <= 0) {
			return { paid: true, owned: false, price, reason: 'trial_exhausted' };
		}
		return { paid: true, owned: true, price, trial: true, trial_remaining: purchase.trial_remaining };
	}

	return { paid: true, owned: false, price, reason: 'not_purchased' };
}

// Decrement trial counter atomically. Caller invokes after a successful trial use.
// Returns the new remaining count, or null if no trial row matched.
export async function consumeTrialUse(userId, agentId, skill) {
	const [row] = await sql`
		UPDATE skill_purchases
		SET trial_remaining = trial_remaining - 1, updated_at = now()
		WHERE user_id = ${userId} AND agent_id = ${agentId} AND skill = ${skill}
		  AND status = 'trial' AND trial_remaining > 0
		RETURNING trial_remaining
	`;
	return row?.trial_remaining ?? null;
}

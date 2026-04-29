// Spend-policy guard for agent-signed Solana transactions.
//
// Policy lives on agent_identities.meta.spend_policy:
//   {
//     max_sol_per_tx:  number,    // hard cap per individual buy
//     daily_sol_cap:   number,    // rolling 24h sum across pumpfun.buy
//     allowed_mints?:  string[],  // optional allowlist (omit = any mint)
//   }
//
// If no policy is set, a conservative default is applied so a freshly
// provisioned agent can't be drained by a stolen session token.

import { sql } from './db.js';

const DEFAULT_POLICY = {
	max_sol_per_tx: 1,
	daily_sol_cap: 5,
	allowed_mints: null,
};

export function resolveSpendPolicy(meta) {
	const p = (meta && meta.spend_policy) || {};
	return {
		max_sol_per_tx: Number.isFinite(p.max_sol_per_tx) ? p.max_sol_per_tx : DEFAULT_POLICY.max_sol_per_tx,
		daily_sol_cap: Number.isFinite(p.daily_sol_cap) ? p.daily_sol_cap : DEFAULT_POLICY.daily_sol_cap,
		allowed_mints: Array.isArray(p.allowed_mints) && p.allowed_mints.length ? p.allowed_mints : null,
	};
}

// Returns null if allowed, or { status, code, msg } if blocked.
export async function checkBuyAllowed({ agentId, meta, mint, solAmount }) {
	const policy = resolveSpendPolicy(meta);

	if (solAmount > policy.max_sol_per_tx) {
		return {
			status: 403,
			code: 'spend_cap_exceeded',
			msg: `solAmount ${solAmount} > max_sol_per_tx ${policy.max_sol_per_tx}`,
		};
	}

	if (policy.allowed_mints && !policy.allowed_mints.includes(mint)) {
		return {
			status: 403,
			code: 'mint_not_allowed',
			msg: `mint ${mint} not in allowed_mints`,
		};
	}

	const [{ spent_24h } = { spent_24h: 0 }] = await sql`
		SELECT COALESCE(SUM((payload->>'solAmount')::numeric), 0) AS spent_24h
		FROM agent_actions
		WHERE agent_id = ${agentId}
			AND type = 'pumpfun.buy'
			AND created_at > NOW() - INTERVAL '24 hours'
	`;
	const spent = Number(spent_24h) || 0;
	if (spent + solAmount > policy.daily_sol_cap) {
		return {
			status: 403,
			code: 'daily_cap_exceeded',
			msg: `would spend ${spent + solAmount} SOL in 24h, cap is ${policy.daily_sol_cap}`,
		};
	}

	return null;
}

// Spend-policy guard for agent-signed Solana transactions.
//
// Policy lives on agent_identities.meta.spend_policy:
//   {
//     max_sol_per_tx:  number,    // hard cap per individual SOL-spend tx
//     daily_sol_cap:   number,    // rolling 24h sum across ALL SOL outflows
//     allowed_mints?:  string[],  // optional allowlist (omit = any mint)
//   }
//
// If no policy is set, a conservative default is applied so a freshly
// provisioned agent can't be drained by a stolen session token.
//
// The daily cap counts every action that moves SOL OUT of the agent wallet —
// bonding-curve buys, the initial buy of a launch, and AMM swap-buys. Sells and
// fee withdrawals are inflows and are not counted. Earlier this summed only
// `pumpfun.buy`, so a caller could alternate buys with launches/swaps and blow
// past the daily cap.

import { sql } from './db.js';
import { runLocked } from './locked-sql.js';

// SOL-outflow action types that draw down the daily cap.
export const SOL_OUTFLOW_TYPES = ['pumpfun.buy', 'pumpfun.launch', 'pumpfun.swap.buy'];

const DEFAULT_POLICY = {
	max_sol_per_tx: 1,
	daily_sol_cap: 5,
	allowed_mints: null,
};

export function resolveSpendPolicy(meta) {
	const p = (meta && meta.spend_policy) || {};
	return {
		max_sol_per_tx: Number.isFinite(p.max_sol_per_tx)
			? p.max_sol_per_tx
			: DEFAULT_POLICY.max_sol_per_tx,
		daily_sol_cap: Number.isFinite(p.daily_sol_cap)
			? p.daily_sol_cap
			: DEFAULT_POLICY.daily_sol_cap,
		allowed_mints:
			Array.isArray(p.allowed_mints) && p.allowed_mints.length ? p.allowed_mints : null,
	};
}

// Static (non-DB) policy checks shared by checkBuyAllowed and reserveSpend.
// Returns null if the per-tx cap and mint allowlist pass, else a blocked object.
function staticBlock(policy, mint, amount) {
	if (amount > policy.max_sol_per_tx) {
		return {
			status: 403,
			code: 'spend_cap_exceeded',
			msg: `solAmount ${amount} > max_sol_per_tx ${policy.max_sol_per_tx}`,
		};
	}
	if (policy.allowed_mints && mint && !policy.allowed_mints.includes(mint)) {
		return {
			status: 403,
			code: 'mint_not_allowed',
			msg: `mint ${mint} not in allowed_mints`,
		};
	}
	return null;
}

// Read-only cap check. Returns null if allowed, or { status, code, msg } if
// blocked. This is a best-effort gate: because it does not hold a lock across
// the on-chain send, two concurrent spends can both pass (TOCTOU). Callers that
// need an exact cap MUST use reserveSpend, which closes that race atomically.
// Retained for callers that record their own action row after sending.
export async function checkBuyAllowed({ agentId, meta, mint, solAmount }) {
	const policy = resolveSpendPolicy(meta);
	const amount = Number(solAmount) || 0;

	const blocked = staticBlock(policy, mint, amount);
	if (blocked) return blocked;

	const [{ spent_24h } = { spent_24h: 0 }] = await sql`
		SELECT COALESCE(SUM(COALESCE((payload->>'solAmount')::numeric, (payload->>'amountSol')::numeric)), 0) AS spent_24h
		FROM agent_actions
		WHERE agent_id = ${agentId}
			AND type = ANY(${SOL_OUTFLOW_TYPES})
			AND created_at > NOW() - INTERVAL '24 hours'
	`;
	const spent = Number(spent_24h) || 0;
	if (spent + amount > policy.daily_sol_cap) {
		return {
			status: 403,
			code: 'daily_cap_exceeded',
			msg: `would spend ${spent + amount} SOL in 24h, cap is ${policy.daily_sol_cap}`,
		};
	}

	return null;
}

// Atomically check the daily cap AND record a pending reservation row under a
// per-agent advisory lock. Concurrent spends for the SAME agent serialize on the
// lock, so two requests can never both read the same 24h total and both pass —
// closing the TOCTOU that checkBuyAllowed leaves open. The reservation row is a
// real agent_actions row (so it counts immediately toward the cap); the caller
// finalizes it with the tx signature on success, or releases it on failure.
//
// Returns { ok: true, reservationId } when allowed, or
//          { ok: false, status, code, msg } when blocked.
export async function reserveSpend({ agentId, meta, mint, solAmount, type, payload = {} }) {
	if (!SOL_OUTFLOW_TYPES.includes(type)) {
		throw new Error(`reserveSpend: ${type} is not a SOL-outflow type`);
	}
	const policy = resolveSpendPolicy(meta);
	const amount = Number(solAmount) || 0;

	const blocked = staticBlock(policy, mint, amount);
	if (blocked) return { ok: false, ...blocked };

	const reserved = JSON.stringify({
		...payload,
		solAmount: amount,
		mint: mint || null,
		status: 'reserved',
	});

	// The advisory xact lock is taken in its own statement ahead of the INSERT…SELECT
	// in one transaction (see locked-sql.js: a lock inside the same statement does
	// not refresh the snapshot, so the loser would not see the winner's row). The
	// INSERT…SELECT only materializes a row when the rolling 24h total plus this
	// spend stays within the cap, so the check and the reservation are atomic.
	const rows = await runLocked([agentId], sql`
		WITH spent AS (
			SELECT COALESCE(SUM(COALESCE((payload->>'solAmount')::numeric, (payload->>'amountSol')::numeric)), 0) AS s
			FROM agent_actions
			WHERE agent_id = ${agentId}
				AND type = ANY(${SOL_OUTFLOW_TYPES})
				AND created_at > NOW() - INTERVAL '24 hours'
		)
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		SELECT ${agentId}, ${type}, ${reserved}::jsonb, ${'pumpfun'}
		FROM spent
		WHERE spent.s + ${amount}::numeric <= ${policy.daily_sol_cap}::numeric
		RETURNING id
	`);

	if (!rows.length) {
		return {
			status: 403,
			code: 'daily_cap_exceeded',
			msg: `would exceed daily_sol_cap ${policy.daily_sol_cap} SOL in 24h`,
			ok: false,
		};
	}
	return { ok: true, reservationId: rows[0].id };
}

// Finalize a reservation after the on-chain send succeeds: merge the real tx
// details (signature, network, …) into the reserved row and mark it confirmed.
export async function finalizeSpend(reservationId, payload = {}) {
	if (!reservationId) return;
	await sql`
		UPDATE agent_actions
		SET payload = payload || ${JSON.stringify({ ...payload, status: 'confirmed' })}::jsonb
		WHERE id = ${reservationId}
	`.catch((e) => console.error('[spend-policy] finalize failed', e));
}

// Release a reservation when the send never lands (build/sign/send failure) so a
// failed attempt does not permanently consume the agent's daily cap.
export async function releaseSpend(reservationId) {
	if (!reservationId) return;
	await sql`
		DELETE FROM agent_actions WHERE id = ${reservationId}
	`.catch((e) => console.error('[spend-policy] release failed', e));
}

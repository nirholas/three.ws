// Persistence + guard hook for owner-funded on-chain allowances.
// Pure chain access lives in onchain-allowance.js; this module maps agents to
// their delegation accounts (agent_onchain_allowances) and exposes the
// "remaining allowance is a hard ceiling" check the spend guards call.

import { sql } from './db.js';
import { checkAllowancePull } from './onchain-allowance.js';

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function viewRow(r) {
	return {
		id: r.id,
		agentId: r.agent_id,
		network: r.network,
		kind: r.kind,
		ownerWallet: r.owner_wallet,
		delegatee: r.delegatee,
		mint: r.mint,
		nonce: String(r.nonce),
		delegationPda: r.delegation_pda,
		capRaw: String(r.cap_raw),
		expiryTs: Number(r.expiry_ts),
		periodLengthS: r.period_length_s == null ? null : Number(r.period_length_s),
		createSignature: r.create_signature,
		revokeSignature: r.revoke_signature,
		revokedAt: r.revoked_at,
		createdAt: r.created_at,
	};
}

export async function listAllowances(agentId, network, { includeRevoked = false } = {}) {
	const rows = await sql`
		SELECT * FROM agent_onchain_allowances
		WHERE agent_id = ${agentId} AND network = ${network}
		  AND (${includeRevoked} OR revoked_at IS NULL)
		ORDER BY created_at DESC
		LIMIT 50
	`;
	return rows.map(viewRow);
}

export async function getAllowance(agentId, id) {
	const [row] = await sql`SELECT * FROM agent_onchain_allowances WHERE id = ${id} AND agent_id = ${agentId}`;
	return row ? viewRow(row) : null;
}

/** Idempotent on (network, delegation_pda): a repeated confirm never resets the recorded cap. */
export async function recordAllowance(a) {
	const [row] = await sql`
		INSERT INTO agent_onchain_allowances
			(agent_id, user_id, network, kind, owner_wallet, delegatee, mint, nonce,
			 delegation_pda, cap_raw, expiry_ts, period_length_s, create_signature)
		VALUES (${a.agentId}, ${a.userId}, ${a.network}, ${a.kind}, ${a.ownerWallet}, ${a.delegatee}, ${a.mint},
			${String(a.nonce)}, ${a.delegationPda}, ${String(a.capRaw)}, ${a.expiryTs}, ${a.periodLengthS ?? null},
			${a.createSignature ?? null})
		ON CONFLICT (network, delegation_pda) DO UPDATE SET create_signature = COALESCE(agent_onchain_allowances.create_signature, EXCLUDED.create_signature)
		RETURNING *
	`;
	return viewRow(row);
}

export async function markRevoked(id, signature) {
	const [row] = await sql`
		UPDATE agent_onchain_allowances
		SET revoked_at = COALESCE(revoked_at, now()), revoke_signature = COALESCE(revoke_signature, ${signature ?? null})
		WHERE id = ${id}
		RETURNING *
	`;
	return row ? viewRow(row) : null;
}

/**
 * Hard ceiling for the spend guards. An agent with no active allowance for the
 * mint is not gated (the feature is owner opt-in, like every other cap). With
 * one on file, the live on-chain remaining amount decides: a pull the program
 * would reject is refused here, before any transaction is built.
 *
 * With several active allowances for the same mint the request is checked
 * against each and allowed if any one of them covers it; `allowance` names the
 * one a pull should use.
 */
export async function checkAgentAllowanceSpend({ agentId, network = 'mainnet', mint, amount, connection = null }) {
	if (typeof mint !== 'string' || !SOLANA_ADDRESS_RE.test(mint)) return { gated: false };
	const active = (await listAllowances(agentId, network)).filter((a) => a.mint === mint);
	if (active.length === 0) return { gated: false };

	let lastRefusal = null;
	for (const a of active) {
		const verdict = await checkAllowancePull({ network, kind: a.kind, delegationPda: a.delegationPda, amount, connection });
		if (verdict.allow) return { gated: true, allow: true, code: verdict.code, reason: verdict.reason, detail: verdict.detail, allowance: a, live: verdict.live };
		lastRefusal = { ...verdict, allowance: a };
	}
	return { gated: true, allow: false, code: lastRefusal.code, reason: lastRefusal.reason, detail: lastRefusal.detail, allowance: lastRefusal.allowance, live: lastRefusal.live };
}

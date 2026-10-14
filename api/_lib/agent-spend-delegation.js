// Owner-signed, epoch-bounded spend delegations: server-side store +
// enforcement. See packages/agent-guards/src/delegation.js for the canonical
// message format and the offline-verifiable signature spec; this module is
// the platform's own copy of that same arithmetic, run against the REAL
// realized-spend ledger (agent_custody_events) rather than a caller's claim.
//
// Lifecycle:
//   1. The owner signs { agent, owner, cap_lamports_per_epoch, epoch_seconds,
//      not_after, nonce } with their linked Solana wallet (a message, never
//      a transaction) and submits { delegation, signature }.
//   2. registerDelegation verifies the signature, verifies `owner` really is
//      the agent's linked owner wallet, and stores it. A replayed nonce
//      (same agent + nonce already on file, whatever its current status) is
//      rejected: a captured signed envelope can never be resubmitted to
//      reset the epoch counter or extend an authorization past what was
//      actually signed.
//   3. checkDelegationSpend runs on every subsequent proposed spend for that
//      agent: it sums REALIZED spend from agent_custody_events over the
//      trailing `epoch_seconds` window (the same ledger `updateCustodyEvent`
//      corrects to the post-settlement realized amount for exact-output
//      trades) and rejects a debit that would push the rolling total past
//      the signed cap.
//
// No delegation on file for an agent is not a block: the feature is
// owner-opt-in, exactly like every other cap in agent-trade-guards.js.

import { sql } from './db.js';
import { verifyDelegationSignature, checkDelegationCap } from '../../packages/agent-guards/src/delegation.js';
import { getDailySpendLamports } from './agent-trade-guards.js';
import { logAudit } from './audit.js';

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class DelegationError extends Error {
	constructor(code, message, extra = {}) {
		super(message);
		this.code = code;
		this.extra = extra;
	}
}

/**
 * Look up the Solana wallet the agent's owner has linked to their account.
 * This is the ONLY address a delegation for this agent may claim as `owner`.
 * That is what makes the endpoint safe to expose without a session: forgery
 * is prevented by the Ed25519 signature check, not by auth on the request.
 */
async function ownerWalletFor(agentId) {
	const [agent] = await sql`
		SELECT user_id FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agent) return null;
	const [wallet] = await sql`
		SELECT address FROM user_wallets
		WHERE user_id = ${agent.user_id} AND chain_type = 'solana'
		ORDER BY is_primary DESC, created_at ASC
		LIMIT 1
	`;
	return wallet?.address ?? null;
}

/**
 * Verify + store a signed delegation envelope. Returns the stored row on
 * success; throws DelegationError with a specific `code` on every rejection
 * path (wrong signer, expired, replayed nonce, unknown agent).
 */
export async function registerDelegation({ agentId, delegation, signature }) {
	if (!delegation || typeof delegation !== 'object') {
		throw new DelegationError('invalid_delegation', 'delegation must be an object.');
	}
	const nonce = typeof delegation.nonce === 'string' ? delegation.nonce.trim().slice(0, 200) : '';
	if (!nonce) throw new DelegationError('invalid_delegation', 'delegation.nonce is required.');

	const owner = typeof delegation.owner === 'string' ? delegation.owner.trim() : '';
	if (!SOLANA_ADDRESS_RE.test(owner)) {
		throw new DelegationError('invalid_delegation', 'delegation.owner must be a base58 Solana address.');
	}

	const capLamports = BigInt(delegation.cap_lamports_per_epoch ?? 0);
	const epochSeconds = Number(delegation.epoch_seconds);
	const notAfterSec = Number(delegation.not_after);
	if (capLamports <= 0n) throw new DelegationError('invalid_delegation', 'cap_lamports_per_epoch must be positive.');
	if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
		throw new DelegationError('invalid_delegation', 'epoch_seconds must be a positive number.');
	}
	if (!Number.isFinite(notAfterSec)) throw new DelegationError('invalid_delegation', 'not_after must be a unix timestamp (seconds).');
	if (notAfterSec <= Math.floor(Date.now() / 1000)) {
		throw new DelegationError('expired_delegation', 'This delegation is already expired (not_after is in the past).');
	}

	const ownerWallet = await ownerWalletFor(agentId);
	if (!ownerWallet) {
		throw new DelegationError('agent_not_found', 'That agent has no linked owner wallet to delegate from.');
	}
	if (ownerWallet !== owner) {
		throw new DelegationError('wrong_signer', "delegation.owner does not match this agent's linked owner wallet.");
	}

	let sigOk = false;
	try {
		sigOk = verifyDelegationSignature({ ...delegation, agent: agentId, owner, nonce }, signature);
	} catch {
		sigOk = false;
	}
	if (!sigOk) {
		throw new DelegationError('wrong_signer', 'Signature does not verify against the claimed owner wallet.');
	}

	let row;
	try {
		[row] = await sql`
			INSERT INTO agent_spend_delegations
				(agent_id, owner_wallet, cap_lamports_per_epoch, epoch_seconds, not_after, nonce, signature)
			VALUES (
				${agentId}, ${owner}, ${capLamports.toString()}, ${Math.round(epochSeconds)},
				to_timestamp(${notAfterSec}), ${nonce}, ${signature}
			)
			RETURNING id, agent_id, owner_wallet, cap_lamports_per_epoch, epoch_seconds, not_after, nonce, status, created_at
		`;
	} catch (e) {
		if (String(e?.message || '').includes('agent_spend_delegations_nonce_unique')) {
			throw new DelegationError('replayed_nonce', 'This delegation nonce has already been used for this agent.');
		}
		throw e;
	}

	logAudit({
		userId: null,
		action: 'agent.spend_delegation.registered',
		resourceId: agentId,
		meta: { delegationId: row.id, capLamportsPerEpoch: capLamports.toString(), epochSeconds, notAfter: row.not_after },
	});

	return row;
}

/**
 * The current delegation on file for an agent (not revoked), or null. This
 * deliberately does NOT filter on `not_after > now()`: a time-expired
 * delegation must still be returned so checkDelegationSpend's cap check sees
 * it and rejects with DELEGATION_EXPIRED, rather than it silently looking
 * like "no delegation" once its clock runs out.
 */
export async function getActiveDelegation(agentId) {
	const [row] = await sql`
		SELECT id, agent_id, owner_wallet, cap_lamports_per_epoch, epoch_seconds, not_after, nonce, status, created_at
		FROM agent_spend_delegations
		WHERE agent_id = ${agentId} AND status = 'active'
		ORDER BY created_at DESC
		LIMIT 1
	`;
	return row || null;
}

/**
 * Check a proposed debit (lamports) against the agent's active delegation,
 * if any. Realized epoch spend is read straight from agent_custody_events,
 * the same ledger every custody path (trade/snipe/x402/withdraw) writes and
 * corrects to the post-settlement realized amount, never from the caller's
 * own claim about what the action will cost.
 *
 * Returns { gated: false } when no delegation is on file (opt-in cap, not a
 * default restriction). Returns { gated: true, allow, code, reason, detail }
 * when a delegation IS on file and was evaluated.
 */
export async function checkDelegationSpend({ agentId, debitLamports, network = 'mainnet' }) {
	const delegation = await getActiveDelegation(agentId);
	if (!delegation) return { gated: false };

	const epochHours = Number(delegation.epoch_seconds) / 3600;
	const epochSpentLamports = await getDailySpendLamports(agentId, network, epochHours);

	const result = checkDelegationCap({
		delegation: {
			agent: delegation.agent_id,
			owner: delegation.owner_wallet,
			cap_lamports_per_epoch: delegation.cap_lamports_per_epoch,
			epoch_seconds: delegation.epoch_seconds,
			not_after: Math.floor(new Date(delegation.not_after).getTime() / 1000),
			nonce: delegation.nonce,
		},
		epochSpentLamports,
		debitLamports: BigInt(debitLamports ?? 0),
	});

	return { gated: true, delegation, epochSpentLamports, ...result };
}

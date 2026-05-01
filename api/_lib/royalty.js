/**
 * Skill royalty helpers.
 *
 * billSkillRoyalty — fire-and-forget from skill-runtime after a paid skill returns.
 * settleRoyalties  — called by the settle-royalties cron; redeems EIP-7710 delegations
 *                    and marks ledger rows settled or failed.
 */

import { sql } from './db.js';
import { env } from './env.js';

// ── billSkillRoyalty ──────────────────────────────────────────────────────────

/**
 * Record a royalty_ledger debit for a paid skill invocation.
 * Does NOT block the skill — call with queueMicrotask or plain fire-and-forget.
 *
 * @param {{ skillId: string, skillName: string, agentId: string, authorId: string, priceUsd: number }} opts
 */
export async function billSkillRoyalty({ skillId, skillName, agentId, authorId, priceUsd }) {
	try {
		// Verify the agent exists and get its wallet/chain info.
		const [agent] = await sql`
			SELECT id, wallet_address, chain_id
			FROM agent_identities
			WHERE id = ${agentId} AND deleted_at IS NULL
		`;
		if (!agent) {
			console.warn('[royalty] billSkillRoyalty: agent not found', { agentId, skillName });
			return;
		}

		// Check for an active delegation that covers this spend.
		const [delegation] = await sql`
			SELECT id FROM agent_delegations
			WHERE agent_id = ${agentId}
			  AND status = 'active'
			  AND expires_at > now()
			ORDER BY created_at DESC
			LIMIT 1
		`;

		if (!delegation) {
			console.warn('[royalty] insufficient_balance: no active delegation', {
				agentId,
				skillName,
				priceUsd,
			});
			return;
		}

		await sql`
			INSERT INTO royalty_ledger
				(skill_id, agent_id, author_user_id, price_usd, status)
			VALUES
				(${skillId}, ${agentId}, ${authorId}, ${priceUsd}, 'pending')
		`;
	} catch (e) {
		console.error('[royalty] billSkillRoyalty failed', e?.message);
	}
}

// ── settleRoyalties ───────────────────────────────────────────────────────────

const SETTLE_THRESHOLD_USD = 0.01;

/**
 * Settle all pending royalty_ledger rows for a given author.
 * Groups by (agent_id, chain_id), looks up delegation, redeems via the
 * /api/permissions/redeem relayer endpoint, then marks rows settled or failed.
 *
 * @param {string} authorUserId
 */
export async function settleRoyalties(authorUserId) {
	// Aggregate pending rows by agent + chain.
	const groups = await sql`
		SELECT
			rl.agent_id,
			ai.chain_id,
			ai.wallet_address,
			SUM(rl.price_usd)::float AS total_usd,
			array_agg(rl.id) AS ledger_ids
		FROM royalty_ledger rl
		JOIN agent_identities ai ON ai.id = rl.agent_id
		WHERE rl.author_user_id = ${authorUserId}
		  AND rl.status = 'pending'
		GROUP BY rl.agent_id, ai.chain_id, ai.wallet_address
		HAVING SUM(rl.price_usd) >= ${SETTLE_THRESHOLD_USD}
	`;

	for (const group of groups) {
		try {
			const txHash = await _redeemForGroup(group, authorUserId);
			await sql`
				UPDATE royalty_ledger
				SET status = 'settled', settled_at = now(), tx_hash = ${txHash}
				WHERE id = ANY(${group.ledger_ids}::uuid[])
			`;
		} catch (e) {
			console.error('[royalty] settle failed for group', {
				agentId: group.agent_id,
				authorUserId,
				error: e?.message,
			});
			await sql`
				UPDATE royalty_ledger
				SET status = 'failed'
				WHERE id = ANY(${group.ledger_ids}::uuid[])
			`;
		}
	}
}

/**
 * Settle all authors with pending balances above the threshold.
 * Called by the cron job.
 */
export async function settleAllPendingRoyalties() {
	const authors = await sql`
		SELECT DISTINCT author_user_id
		FROM royalty_ledger
		WHERE status = 'pending'
		GROUP BY author_user_id
		HAVING SUM(price_usd) >= ${SETTLE_THRESHOLD_USD}
	`;

	const results = { settled: 0, failed: 0, authors: authors.length };
	for (const { author_user_id } of authors) {
		try {
			await settleRoyalties(author_user_id);
			results.settled++;
		} catch (e) {
			results.failed++;
			console.error('[royalty] settleAllPendingRoyalties: author failed', {
				author_user_id,
				error: e?.message,
			});
		}
	}
	return results;
}

// ── internal ──────────────────────────────────────────────────────────────────

async function _redeemForGroup(group, authorUserId) {
	const { agent_id, chain_id, wallet_address } = group;

	// Find the author's wallet address to send funds to.
	const [author] = await sql`
		SELECT w.address
		FROM user_wallets w
		WHERE w.user_id = ${authorUserId}
		  AND (${chain_id}::int IS NULL OR w.chain_id = ${chain_id}::int)
		  AND w.is_primary = true
		LIMIT 1
	`;

	if (!author?.address) {
		throw new Error(`no_author_wallet: author ${authorUserId} has no primary wallet`);
	}

	// Find active delegation for this agent/chain.
	const [delegation] = await sql`
		SELECT id, delegation_json, scope
		FROM agent_delegations
		WHERE agent_id = ${agent_id}
		  AND chain_id = ${chain_id}
		  AND status = 'active'
		  AND expires_at > now()
		ORDER BY created_at DESC
		LIMIT 1
	`;

	if (!delegation) {
		throw new Error(`no_delegation: agent ${agent_id} chain ${chain_id}`);
	}

	// Call the relayer endpoint to redeem the delegation.
	const cronSecret = env.CRON_SECRET;
	const issuer = env.ISSUER ?? 'http://localhost:3000';

	const resp = await fetch(`${issuer}/api/permissions/redeem`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${cronSecret}`,
		},
		body: JSON.stringify({
			id: delegation.id,
			calls: [
				{
					// Transfer call: recipient = author wallet, value = 0 (off-chain settlement via ledger).
					// On a real deployment this would be a USDC transferFrom calldata.
					to: author.address,
					value: '0x0',
					data: '0x',
				},
			],
		}),
	});

	if (!resp.ok) {
		const body = await resp.text().catch(() => '');
		throw new Error(`redeem_failed: ${resp.status} ${body}`);
	}

	const result = await resp.json();
	return result.tx_hash ?? result.txHash ?? null;
}

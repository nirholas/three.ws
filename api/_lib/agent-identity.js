// Avatar ↔ agent-identity bridge.
//
// Wallets on this platform are keyed to `agent_identities`, not avatars. An
// avatar is a 3D model; an agent identity is the wallet-owning entity that can
// wear that avatar. Giving an avatar a wallet therefore means: ensure an agent
// identity exists for it, then provision the identity's custodial Solana wallet.
//
// This module is the single source of truth for that resolution so the pump.fun
// launch flow, avatar-creation auto-provisioning, and the avatar wallet endpoint
// all behave identically. Extracted from resolveLaunchAgentId in
// api/pump/[action].js (which now imports resolveOrCreateAgentForAvatar).

import { sql } from './db.js';
import { getOrCreateAgentSolanaWallet } from './agent-wallet.js';
import { ensureAgentLaunchPath } from './agent-token-plan.js';

/**
 * Resolve the agent identity for a launch/wallet action, creating one from the
 * avatar if the user has none linked yet.
 *
 * Resolution order:
 *   1. explicit agentId (scoped to the user)
 *   2. the user's agent identity already linked to this avatar
 *   3. a new identity created from the avatar's name/description, put on the
 *      coin path (custodial Solana wallet + auto-drafted plan) like every other
 *      newly created agent
 *   4. on the per-user uniqueness constraint, an existing unlinked identity is
 *      linked to this avatar; failing that, the user's first identity
 *
 * @returns {Promise<{id: string, name: string}|null>}
 */
export async function resolveOrCreateAgentForAvatar({ userId, agentId, avatarId }) {
	if (agentId) {
		const [row] = await sql`
			select id, name from agent_identities
			where id=${agentId} and user_id=${userId} and deleted_at is null
			limit 1
		`;
		return row || null;
	}
	const [linked] = await sql`
		select id, name from agent_identities
		where user_id=${userId} and avatar_id=${avatarId} and deleted_at is null
		order by created_at asc limit 1
	`;
	if (linked) return linked;

	const [avatar] = await sql`
		select id, name, description from avatars
		where id=${avatarId} and owner_id=${userId} and deleted_at is null
		limit 1
	`;
	if (!avatar) return null;

	const agentName = (avatar.name || 'Agent').slice(0, 100);
	const agentDesc = avatar.description ? String(avatar.description).slice(0, 1000) : null;
	try {
		const [created] = await sql`
			insert into agent_identities (user_id, name, description, avatar_id)
			values (${userId}, ${agentName}, ${agentDesc}, ${avatar.id})
			returning id, user_id, name, description, meta
		`;
		await ensureAgentLaunchPath({ agent: created });
		return { id: created.id, name: created.name };
	} catch (err) {
		if (err?.code !== '23505') throw err;
		// Unique-per-user constraint: reuse the user's existing identity and
		// link it to this avatar if it has none yet.
		const [unlinked] = await sql`
			select id, name from agent_identities
			where user_id=${userId} and avatar_id is null and deleted_at is null
			order by created_at asc limit 1
		`;
		if (unlinked) {
			await sql`
				update agent_identities set avatar_id=${avatar.id}, updated_at=now()
				where id=${unlinked.id}
			`;
			return unlinked;
		}
		const [any] = await sql`
			select id, name from agent_identities
			where user_id=${userId} and deleted_at is null
			order by created_at asc limit 1
		`;
		return any || null;
	}
}

/**
 * Ensure the avatar's agent identity has a custodial Solana wallet, creating
 * both the identity (if needed) and the wallet (idempotently) in one call.
 *
 * @returns {Promise<{ agentId: string, agentName: string, address: string, created: boolean }|null>}
 *          null when the avatar can't be resolved to an owned agent identity.
 */
export async function getOrCreateAvatarSolanaWallet({ userId, avatarId, agentId = null }) {
	const agent = await resolveOrCreateAgentForAvatar({ userId, agentId, avatarId });
	if (!agent) return null;
	const wallet = await getOrCreateAgentSolanaWallet(agent.id);
	return { agentId: agent.id, agentName: agent.name, address: wallet.address, created: wallet.created };
}

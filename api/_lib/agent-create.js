// Create an agent identity: the one path every creation surface shares.
//
// POST /api/agents (api/agents.js) and the create_agent MCP tool both call
// createAgentIdentity, so an agent made from a browser and one made by a model
// through MCP get the same integrity screening, the same custodial wallets and
// the same announcements. Transport concerns (auth, CSRF, rate limits, scope)
// stay with the caller.

import { sql } from './db.js';
import { env } from './env.js';
import { generateAgentWallet, generateSolanaAgentWallet } from './agent-wallet.js';
import { checkIdentityIntegrity } from './identity-integrity.js';
import { pingIndexNow } from './indexnow.js';
import { publishFeedEvent } from './feed.js';

export const DEFAULT_AGENT_SKILLS = Object.freeze(['greet', 'present-model', 'validate-model', 'remember', 'think']);

// Wallet minting encrypts keys under the secret box, which can fail when that
// key is misconfigured (for example under the JWT_SECRET fallback, see
// api/_lib/secret-box.js). That must never brick creating an agent. The
// platform mints wallets lazily and idempotently on first use (ensureAgentWallet
// / getOrCreateAgentEvmWallet), so a walletless identity self-heals the next
// time it touches a wallet once the key is configured, which is exactly how
// the avatar-agent path degrades. On failure the agent is created with a null
// wallet_address and no encrypted keys, and a warning is logged (never the
// secret-box internals). Returns { walletAddress, meta } for the INSERT.
export async function mintAgentWalletMeta() {
	try {
		const [wallet, sol] = await Promise.all([generateAgentWallet(), generateSolanaAgentWallet()]);
		return {
			walletAddress: wallet.address,
			meta: {
				encrypted_wallet_key: wallet.encrypted_key,
				solana_address: sol.address,
				encrypted_solana_secret: sol.encrypted_secret,
			},
		};
	} catch (err) {
		console.warn(
			'[agents] wallet provisioning deferred: minting failed at create time, ' +
				'agent will be provisioned lazily on first wallet use:',
			err?.message,
		);
		return { walletAddress: null, meta: {} };
	}
}

/**
 * Create an agent owned by `userId`.
 *
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.name             already trimmed, 1-100 chars
 * @param {string} [p.description]
 * @param {string[]} [p.personaToneTags]  fed to the identity-integrity screen
 * @param {string|null} [p.avatarId]  an avatar the caller owns (checked by caller)
 * @param {string[]} [p.skills]
 * @param {object} [p.meta]           extra meta merged under the wallet keys
 * @param {string|null} [p.personaPrompt]  the brain's persona (persona_prompt column)
 * @returns {Promise<{ agent: object } | { blocked: { message: string, integrity: object } }>}
 */
export async function createAgentIdentity({
	userId,
	name,
	description = null,
	personaToneTags,
	avatarId = null,
	skills = null,
	meta: extraMeta = {},
	personaPrompt = null,
}) {
	// Granite identity-integrity gate: refuse an identity that impersonates an
	// existing public agent (embedding look-alike) or fails content screening.
	// Best-effort: any failure, or watsonx being unconfigured, lets creation
	// proceed rather than failing closed.
	let integrity = null;
	try {
		integrity = await checkIdentityIntegrity(
			{ name, description, persona_tone_tags: personaToneTags },
			{ userId },
		);
		if (integrity.status === 'block') {
			return {
				blocked: {
					message: integrity.reasons[0] || 'this identity conflicts with an existing agent',
					integrity,
				},
			};
		}
	} catch (err) {
		console.error('[agents] identity_integrity_check_failed', err);
		integrity = null;
	}

	const { walletAddress, meta: walletMeta } = await mintAgentWalletMeta();
	const meta = { ...(extraMeta || {}), ...walletMeta };
	// Stamp the integrity verdict onto the identity so the profile/editor can show
	// a "distinct identity" signal and reviewers can see what was checked at birth.
	if (integrity && integrity.configured) {
		meta.identity_integrity = {
			status: integrity.status,
			uniqueness: integrity.uniqueness,
			guardian: integrity.guardian ? integrity.guardian.decision : null,
			closest: integrity.similar[0]
				? { name: integrity.similar[0].name, score: integrity.similar[0].score }
				: null,
			checked_at: new Date().toISOString(),
		};
	}

	const [agent] = await sql`
		INSERT INTO agent_identities (user_id, name, description, skills, wallet_address, meta, avatar_id, persona_prompt)
		VALUES (
			${userId},
			${name},
			${description ? String(description).slice(0, 500) : null},
			${skills || [...DEFAULT_AGENT_SKILLS]},
			${walletAddress},
			${JSON.stringify(meta)}::jsonb,
			${avatarId},
			${personaPrompt ? String(personaPrompt).slice(0, 8000) : null}
		)
		RETURNING *
	`;

	// Push the new agent's URL to IndexNow so Bing / Yandex discover it within
	// minutes instead of waiting for the next crawl. Fire-and-forget.
	pingIndexNow(`${env.APP_ORIGIN}/agents/${agent.id}`).catch(() => {});

	// Announce the new agent on the site-wide live activity ticker. Fire-and-forget.
	publishFeedEvent({
		type: 'agent-deploy',
		ts: Date.now(),
		actor: name,
		agentId: agent.id,
		name,
	}).catch(() => {});

	return { agent };
}

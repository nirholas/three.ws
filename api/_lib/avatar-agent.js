// Provision an agent (and its custodial Solana wallet) for a newly created
// avatar. Extracted from api/avatars/index.js so every avatar-creation path —
// direct upload AND the chat/forge "text → avatar" save — yields a first-class
// agent the same way, instead of a bare library entry.

import { sql } from './db.js';
import { withDbRetry } from './db-retry.js';
import { writeAssetProvenance } from './asset-provenance.js';
import { ensureAgentLaunchPath } from './agent-token-plan.js';

// Names the platform gives an agent before its owner names it. A coin drafted
// for an agent still wearing one of these takes the avatar's name instead.
const PLACEHOLDER_AGENT_NAMES = new Set(['my first agent', 'my agent', 'agent']);

// Claim an existing agent that has no avatar yet, or create a default one, then
// put that agent on the coin path: a custodial Solana wallet and a private
// auto-drafted coin plan (ensureAgentLaunchPath). Idempotent and safe to retry
// (the claim is naturally idempotent and the insert is guarded by NOT EXISTS),
// so a transient DB blip never leaves an avatar without its agent. Never throws
// — callers run it fire-and-forget via queueMicrotask. Returns the agent id (or
// null if provisioning could not complete).
//
// @param {object} p
// @param {object} [p.provenance] generation provenance to record on the ledger
//   once the agent resolves — { prompt, generationModel, generationProvider,
//   parentAvatarId }. Omitted for a plain upload with no generation metadata;
//   still records creator + timestamp when provided with all-null fields, since
//   authorship alone is meaningful provenance. Best-effort, never blocks.
export async function provisionAvatarAgent({ userId, avatarId, avatarName, provenance }) {
	try {
		const agent = await withDbRetry(async () => {
			const linked = await sql`
				WITH agent_to_update AS (
					SELECT id FROM agent_identities
					WHERE user_id = ${userId}
						AND avatar_id IS NULL
						AND deleted_at IS NULL
					ORDER BY created_at ASC
					LIMIT 1
				)
				UPDATE agent_identities
				SET avatar_id = ${avatarId}, updated_at = NOW()
				FROM agent_to_update
				WHERE agent_identities.id = agent_to_update.id
				RETURNING agent_identities.id, agent_identities.user_id, agent_identities.name,
					agent_identities.description, agent_identities.persona_prompt, agent_identities.meta
			`;
			if (linked.length) return linked[0];
			const [created] = await sql`
				INSERT INTO agent_identities (user_id, name, avatar_id, is_public, created_at, updated_at)
				SELECT
					${userId},
					${avatarName || 'My Agent'},
					${avatarId},
					false,
					NOW(),
					NOW()
				WHERE NOT EXISTS (
					SELECT 1 FROM agent_identities
					WHERE user_id = ${userId} AND avatar_id = ${avatarId}
				)
				RETURNING id, user_id, name, description, persona_prompt, meta
			`;
			return created ?? null;
		});
		const agentId = agent?.id ?? null;

		// Every 3D avatar's agent gets a custodial Solana wallet on first save so
		// it can transact immediately (Solana-only by product decision; EVM is
		// opt-in via the wallet panel), and a draft coin plan so its home page
		// leads with the launch. Both idempotent and never throw.
		if (agentId) {
			const placeholder = PLACEHOLDER_AGENT_NAMES.has(String(agent.name || '').trim().toLowerCase());
			await ensureAgentLaunchPath({
				agent: { ...agent, user_id: agent.user_id || userId, name: placeholder && avatarName ? avatarName : agent.name },
			});

			// Signed provenance on generation (Prompt 08, task 1): a durable,
			// append-only ledger record of authorship — creator (the agent),
			// prompt, generation model/provider, and parent lineage (a fork).
			// Best-effort and fire-and-forget-safe: writeAssetProvenance never
			// throws, so a signing/DB hiccup here can never break avatar creation.
			writeAssetProvenance({
				agentId,
				type: 'avatar.generated',
				payload: {
					avatar_id: avatarId,
					avatar_name: avatarName || null,
					prompt: provenance?.prompt ?? null,
					generation_model: provenance?.generationModel ?? null,
					generation_provider: provenance?.generationProvider ?? null,
					parent_avatar_id: provenance?.parentAvatarId ?? null,
					created_at: new Date().toISOString(),
				},
				sourceSkill: 'avatar-agent',
			}).catch(() => {});
		}
		return agentId;
	} catch (err) {
		// This path is idempotent, fire-and-forget, and self-healing: the claim is
		// guarded by NOT EXISTS and re-runs the next time the user opens their
		// avatar/agent, so a transient DB stall (Neon scale-to-zero wake, a
		// connection blip — see db-retry.js) leaves nothing broken and the avatar
		// was already created. Logging that at error level trips false alarms, so
		// classify it the same way db-retry does and warn instead; reserve error
		// for genuinely unexpected failures (constraint violations, bugs).
		const transient =
			err?.code === 'DB_TIMEOUT' ||
			/fetch failed|connecting to database|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|terminat/i.test(
				err?.message || '',
			);
		const detail = { avatarId, userId, error: err?.message };
		if (transient) {
			console.warn('[avatar-agent] auto-agent provisioning deferred (transient DB stall — retries on next interaction)', detail);
		} else {
			console.error('[avatar-agent] auto-agent failed', detail);
		}
		return null;
	}
}

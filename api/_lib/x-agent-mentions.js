// Agent mode for the X mention bot: which agents answer mentions of their own
// connected X account, and what each answer is built from.
//
// The mention poller (x-mention-poll.js) treats an agent account like the
// company account, with three differences supplied here:
//
//   - the account list: every agent whose policy has mention_replies_enabled
//     and whose own X account is connected (agent_x_connections),
//   - the scope check: the connection must carry the scopes mention replies
//     need (X_MENTION_REQUIRED_SCOPES); otherwise the poller reports
//     `missing_scope` and the settings page shows the same gap,
//   - the context: the agent's persona for the reply brain, its avatar poster
//     for conversational replies, and its policy (dry run, daily cap, intents).

import { sql } from './db.js';
import { appOrigin } from './gateway/format.js';
import { posterPngUrl } from '../_mcp-studio/asset-links.js';
import { X_MENTION_REQUIRED_SCOPES, missingScopes } from './x-scopes.js';

/** Intents the allow-list governs. help and launch never carry a 3D side effect. */
const GATED_INTENTS = new Set(['chat', 'make', 'image3d', 'avatar']);

/**
 * Whether the policy lets an agent act on a parsed intent.
 * @param {{ mention_replies_allowed_intents?: string[] }} policy
 * @param {string} intent
 */
export function intentAllowed(policy, intent) {
	if (!GATED_INTENTS.has(intent)) return true;
	return (policy?.mention_replies_allowed_intents || []).includes(intent);
}

/** The policy fields the poller reads, from a joined row. */
export function mentionPolicyOf(row) {
	return {
		dry_run: row.mention_replies_dry_run !== false,
		daily_cap: Number.isInteger(row.mention_replies_daily_cap) ? row.mention_replies_daily_cap : 10,
		mention_replies_allowed_intents: row.mention_replies_allowed_intents || [],
	};
}

/**
 * Agents to poll: policy enabled and an own X account connected. Each entry
 * carries `missingScopes` so the poller can report the gap instead of calling X.
 *
 * @param {{ db?: typeof sql }} [opts]
 * @returns {Promise<Array<{ agentId: string, userId: string, agent: object, policy: object, missingScopes: string[] }>>}
 */
export async function agentMentionAccounts({ db = sql } = {}) {
	const rows = await db`
		select a.id, a.user_id, a.name, a.persona_prompt, a.meta, a.avatar_id,
		       p.mention_replies_dry_run, p.mention_replies_daily_cap, p.mention_replies_allowed_intents,
		       c.scopes
		from agent_x_policies p
		join agent_identities a on a.id = p.agent_id and a.deleted_at is null
		join agent_x_connections c on c.agent_id = p.agent_id and c.disconnected_at is null
		where p.mention_replies_enabled = true
		order by p.agent_id
		limit 200
	`;
	return rows.map((r) => ({
		agentId: String(r.id),
		userId: String(r.user_id),
		agent: { id: String(r.id), user_id: String(r.user_id), name: r.name, persona_prompt: r.persona_prompt, meta: r.meta || {}, avatar_id: r.avatar_id || null },
		policy: mentionPolicyOf(r),
		missingScopes: missingScopes(r.scopes, X_MENTION_REQUIRED_SCOPES),
	}));
}

/**
 * The poster image of an agent's own avatar, or null when it has none or its
 * model cannot be located. The render endpoint draws the GLB; nothing here is
 * taken from the mention.
 *
 * @param {{ avatar_id?: string|null }} agent
 */
export async function agentPosterUrl(agent, { db = sql, base = appOrigin() } = {}) {
	if (!agent?.avatar_id) return null;
	const [row] = await db`select storage_key from avatars where id = ${agent.avatar_id} and deleted_at is null limit 1`;
	const glbUrl = row ? (await import('./r2.js')).publicUrlOrNull(row.storage_key) : null;
	return glbUrl ? posterPngUrl(base, glbUrl) : null;
}

/**
 * A token resolver for one agent's own X account; refreshes on expiry. Only
 * the agent's connection is ever used, never the owner's personal account.
 */
export function agentTokenResolver({ agentId, userId }) {
	return async () => {
		const { resolveXConnection, refreshIfNeeded } = await import('./x-post.js');
		const conn = await resolveXConnection({ userId, agentId });
		if (!conn || conn.source !== 'agent') throw new Error(`agent ${agentId} has no connected X account`);
		return refreshIfNeeded(conn);
	};
}

/**
 * Token resolver for a recorded x_mention_events row, or null for non-agent
 * rows. Matches createDeliver's `getAccessToken(row)`: sync to call, lazy to run.
 */
export function tokenResolverForRow(row, { db = sql } = {}) {
	if (row?.account_kind !== 'agent') return null;
	return async () => {
		const [a] = await db`select user_id from agent_identities where id = ${row.account_ref} limit 1`;
		if (!a) throw new Error(`agent ${row.account_ref} no longer exists`);
		return agentTokenResolver({ agentId: String(row.account_ref), userId: String(a.user_id) })();
	};
}

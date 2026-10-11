// Is this X user one of ours? One answer, shared by every caller that needs
// it: the mention-reply cron (personalized replies and per-user limits), the
// forge-creation claim flow, and the mention-to-launch flow (order 925).
//
// "Ours" means an X account proven by OAuth and still connected today:
// social_connections holds the link made when an owner (or an agent, via
// agent_x_connections) ran api/auth/x/[action].js's connect flow. This is
// deliberately separate from user_identities (api/_lib/identities.js), which
// is the newer "sign in with X" sign-in method: a person can be looked up
// here from a mention long before, or without ever, signing in with X.

import { sql } from './db.js';

/**
 * @param {string} xAuthorId the X (Twitter) numeric user id from a tweet's author_id
 * @returns {Promise<{ user_id: string, username: string } | null>}
 */
export async function findUserByXId(xAuthorId) {
	if (!xAuthorId || typeof xAuthorId !== 'string') return null;
	const [owner] = await sql`
		select user_id, username from social_connections
		where provider = 'x' and provider_uid = ${xAuthorId} and disconnected_at is null
		limit 1
	`;
	if (owner) return { user_id: owner.user_id, username: owner.username };
	const [agentOwner] = await sql`
		select user_id, username from agent_x_connections
		where provider_uid = ${xAuthorId} and disconnected_at is null
		limit 1
	`;
	return agentOwner ? { user_id: agentOwner.user_id, username: agentOwner.username } : null;
}

// The `launch` intent of the X mention bot: "@trythreews launch Moon Cat $MCAT".
//
// This module NEVER launches anything. A launch signs with the agent's
// custodial wallet, and three.ws allows that only from a same-site browser
// session (requireSessionUser in api/pump/[action].js). So the only product of
// a launch mention is one reply to the author: a prefilled /launch link they
// open, review the cost on, and sign themselves. Nothing is paid until then.
//
// The mention text is untrusted data. By the time it reaches here it has been
// reduced by the pure parser (x-mention-intents.js parseLaunch) to a name, a
// ticker and a description of bounded length; this module only places those
// three strings in URL query parameters (URLSearchParams encodes them) and in
// no other position that could be read as an instruction. The author is
// resolved from the X user id X itself attached to the post, never from text.
//
// Three outcomes, each a plain reply:
//   linked author with an agent that has a 3D body -> the prefilled /launch link
//   linked author with no agent or no body         -> a link to create one
//   author not linked to a three.ws account        -> the sign-in and X linking link

import { sql } from './db.js';
import { findUserByXId } from './x-identity.js';
import { claimUrl } from './x-creation-claim.js';

export const LAUNCH_NO_SPEND_LINE = 'Nothing is paid until you review and sign on three.ws.';

/** The agent that would launch for this user: newest live agent that has a 3D body. */
export async function launchAgentForUser(userId) {
	const [row] = await sql`
		select id, name, avatar_id from agent_identities
		where user_id = ${userId} and deleted_at is null and avatar_id is not null
		order by created_at desc
		limit 1
	`;
	if (row) return { id: row.id, name: row.name, avatarId: row.avatar_id, hasBody: true };
	const [bare] = await sql`
		select id, name from agent_identities
		where user_id = ${userId} and deleted_at is null
		order by created_at desc
		limit 1
	`;
	return bare ? { id: bare.id, name: bare.name, avatarId: null, hasBody: false } : null;
}

/** The /launch URL with the coin fields prefilled. PURE. */
export function launchUrl(base, { avatarId, name, symbol, description }) {
	const url = new URL('/launch', base);
	url.searchParams.set('avatar', avatarId);
	url.searchParams.set('name', name);
	url.searchParams.set('symbol', symbol);
	if (description) url.searchParams.set('description', description);
	return url.toString();
}

/**
 * Decide the reply to a parsed launch mention.
 *
 * @param {{ args: { name: string, symbol: string, description?: string }, authorId: string|null, base: string }} input
 * @param {{ findUser?: typeof findUserByXId, findAgent?: typeof launchAgentForUser }} [deps]
 * @returns {Promise<{ text: string, reason: string, link: string }>}
 */
export async function composeLaunchReply({ args, authorId, base }, deps = {}) {
	const user = authorId ? await (deps.findUser || findUserByXId)(String(authorId)) : null;
	if (!user) {
		const link = claimUrl(base);
		return { text: `Sign in to three.ws and connect this X account first, then ask again: ${link} ${LAUNCH_NO_SPEND_LINE}`, reason: 'launch_unlinked', link };
	}
	const agent = await (deps.findAgent || launchAgentForUser)(user.user_id);
	if (!agent) {
		const link = `${base}/create`;
		return { text: `You need an agent before you can launch its coin. Create one here: ${link}`, reason: 'launch_no_agent', link };
	}
	if (!agent.hasBody) {
		const link = `${base}/agents/${agent.id}`;
		return { text: `${agent.name} needs a 3D body before it can launch a coin. Give it one here: ${link}`, reason: 'launch_no_body', link };
	}
	const link = launchUrl(base, { avatarId: agent.avatarId, name: args.name, symbol: args.symbol, description: args.description });
	return { text: `${args.name} ($${args.symbol}) is ready to launch with ${agent.name}. Review the cost and sign here: ${link} ${LAUNCH_NO_SPEND_LINE}`, reason: 'launch_link', link };
}

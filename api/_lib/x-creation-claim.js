// Claiming what the X mention bot made for you.
//
// A creation made from a mention belongs to the system bot account and carries
// forge_creations.x_author_id (the author's numeric X id) until that person
// links the same X account. The proof of identity is the OAuth link itself:
// social_connections.provider_uid is the id X returned for the signed-in
// account, so a creation moves only to a user whose verified X id equals its
// x_author_id, and never otherwise. Each move writes an x_creation_claims row.
//
// Callers:
//   - api/auth/x/[action].js   claimForUser after a successful owner link
//   - api/x/claim.js           the /x/claim page (list and claim)
//   - x-mention-make.js and siblings   claimForAuthor right after attribution,
//                                      withClaimNote on every success reply

import { sql } from './db.js';
import { selfOrigin } from './self-origin.js';
import { BOT_EMAIL } from './x-mention-make.js';
import { weightedLength, X_POST_MAX_WEIGHT } from './x-text-weight.js';

export const CLAIM_PATH = '/x/claim';
export const LIBRARY_PATH = '/my-creations';

/** The page an unlinked author is sent to. PURE. */
export function claimUrl(base) {
	return `${base}${CLAIM_PATH}`;
}

/** The line appended to a success reply. PURE. */
export function claimNote(linked, base) {
	return linked ? 'Saved to your library.' : `Claim it: ${claimUrl(base)}`;
}

async function botUserId() {
	const [row] = await sql`select id from users where email = ${BOT_EMAIL} and service_account limit 1`;
	return row?.id ?? null;
}

/** The three.ws user whose live X link carries this X id, or null. */
export async function linkedUserForAuthor(xAuthorId) {
	if (!xAuthorId) return null;
	const [row] = await sql`
		select user_id from social_connections
		where provider = 'x' and provider_uid = ${String(xAuthorId)} and disconnected_at is null
		order by connected_at asc
		limit 1
	`;
	return row?.user_id ?? null;
}

/** The X id this user has linked, or null. */
export async function linkedXUid(userId) {
	const [row] = await sql`
		select provider_uid, username from social_connections
		where user_id = ${userId} and provider = 'x' and disconnected_at is null
		limit 1
	`;
	return row ? { uid: row.provider_uid, username: row.username } : null;
}

/**
 * Creations still owned by the bot whose x_author_id equals the X id this user
 * has linked. Empty when no X account is linked.
 */
export async function listClaimable(userId) {
	const link = await linkedXUid(userId);
	const bot = await botUserId();
	if (!link || !bot) return [];
	return sql`
		select id, prompt, status, glb_url, preview_image_url, created_at
		from forge_creations
		where x_author_id = ${link.uid} and user_id = ${bot}
		order by created_at desc
		limit 200
	`;
}

/**
 * Move every claimable creation (or only `ids`) to the user and log each move.
 * The UPDATE re-checks both the author id and bot ownership, so a race or a
 * hand-built id list can never move anything else.
 *
 * @param {string} userId
 * @param {{ source?: 'link'|'claim_page'|'mention', ids?: string[]|null }} [opts]
 * @returns {Promise<string[]>} the claimed creation ids
 */
export async function claimForUser(userId, { source = 'claim_page', ids = null } = {}) {
	const link = await linkedXUid(userId);
	const bot = await botUserId();
	if (!link || !bot) return [];
	const only = Array.isArray(ids) ? ids.map(String) : null;
	if (only && only.length === 0) return [];
	const moved = await sql`
		update forge_creations set user_id = ${userId}, updated_at = now()
		where x_author_id = ${link.uid} and user_id = ${bot}
		  and (${only ? only.join(',') : null}::text is null or id::text = any(string_to_array(${only ? only.join(',') : null}::text, ',')))
		returning id
	`;
	for (const row of moved) {
		await sql`
			insert into x_creation_claims (creation_id, x_author_id, user_id, source)
			values (${row.id}, ${link.uid}, ${userId}, ${source})
			on conflict (creation_id) do nothing
		`;
	}
	return moved.map((r) => String(r.id));
}

/** Hand a fresh bot creation to its author when they already linked. */
export async function claimForAuthor(xAuthorId) {
	const userId = await linkedUserForAuthor(xAuthorId);
	if (!userId) return { linked: false, claimed: [] };
	return { linked: true, claimed: await claimForUser(userId, { source: 'mention' }) };
}

/**
 * Append the library or claim line to a success reply, in place. Looks up the
 * mention's author, so it works for the late follow-up tick as well. A reply
 * that would pass the post length with the line is left as it was.
 */
export async function withClaimNote(reply, { tweetId, base = selfOrigin() }) {
	if (!reply || reply.kind !== 'success' || !tweetId) return reply;
	try {
		const [event] = await sql`select author_id from x_mention_events where tweet_id = ${String(tweetId)}`;
		if (!event?.author_id) return reply;
		const linked = Boolean(await linkedUserForAuthor(event.author_id));
		const text = `${reply.text}\n${claimNote(linked, base)}`;
		if (weightedLength(text) <= X_POST_MAX_WEIGHT) reply.text = text;
	} catch (err) {
		// The line is a courtesy; a lookup failure must never block the reply itself.
		console.warn('[x-creation-claim] claim line skipped:', err?.message);
	}
	return reply;
}

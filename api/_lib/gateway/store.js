// Persistence for the chat gateways: paired chats, pairing codes, the webhook
// inbox and financial previews. Tables: 20260922180000_chat_gateways.sql.

import { sql } from '../db.js';
import { generatePairCode, hashPairCode, CODE_TTL_MINUTES } from './codes.js';

export const PREVIEW_TTL_MINUTES = 10;

export class GatewayError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

// ── links ────────────────────────────────────────────────────────────────────

export async function getLiveLink(platform, chatId) {
	const [row] = await sql`
		SELECT * FROM gateway_links
		WHERE platform = ${platform} AND chat_id = ${String(chatId)} AND revoked_at IS NULL
		LIMIT 1`;
	return row || null;
}

export async function getLinkById(id) {
	const [row] = await sql`SELECT * FROM gateway_links WHERE id = ${id} LIMIT 1`;
	return row || null;
}

export async function listLinksForUser(userId) {
	return sql`
		SELECT l.id, l.platform, l.platform_username, l.chat_id, l.chat_type, l.chat_title,
		       l.default_agent_id, a.name AS default_agent_name, l.notify, l.voice_replies, l.preferred,
		       l.created_at, l.last_seen_at
		FROM gateway_links l
		LEFT JOIN agent_identities a ON a.id = l.default_agent_id AND a.deleted_at IS NULL
		WHERE l.user_id = ${userId} AND l.revoked_at IS NULL
		ORDER BY l.created_at DESC`;
}

export async function listNotifyLinks(userId) {
	return sql`
		SELECT id, platform, chat_id, preferred, last_seen_at FROM gateway_links
		WHERE user_id = ${userId} AND revoked_at IS NULL AND notify = true`;
}

/**
 * Pair a chat to an account. A chat already paired to the same account returns
 * that link unchanged; a chat paired to another account is refused, so one chat
 * can never drive two accounts.
 */
export async function createLink({ platform, platformUserId, platformUsername = null, chatId, chatType = null, chatTitle = null, userId, defaultAgentId = null }) {
	const existing = await getLiveLink(platform, chatId);
	if (existing) {
		if (existing.user_id !== userId) throw new GatewayError('chat_taken', 'This chat is already paired to a different three.ws account. Send /unlink from that account first.', 409);
		return existing;
	}
	try {
		const [row] = await sql`
			INSERT INTO gateway_links (platform, platform_user_id, platform_username, chat_id, chat_type, chat_title, user_id, default_agent_id, last_seen_at)
			VALUES (${platform}, ${String(platformUserId)}, ${platformUsername}, ${String(chatId)}, ${chatType}, ${chatTitle}, ${userId}, ${defaultAgentId}, now())
			RETURNING *`;
		return row;
	} catch (e) {
		// Two redemptions raced for the same chat: the unique live-link index lets
		// exactly one win. Re-read to report the winner honestly.
		if (e?.code === '23505') {
			const won = await getLiveLink(platform, chatId);
			if (won && won.user_id === userId) return won;
			throw new GatewayError('chat_taken', 'This chat is already paired to a different three.ws account.', 409);
		}
		throw e;
	}
}

export async function revokeLink(linkId, userId) {
	const [row] = await sql`
		UPDATE gateway_links SET revoked_at = now(), preferred = false
		WHERE id = ${linkId} AND user_id = ${userId} AND revoked_at IS NULL
		RETURNING id, platform, chat_id`;
	if (row) {
		await sql`
			UPDATE gateway_previews SET status = 'cancelled', decided_at = now()
			WHERE link_id = ${linkId} AND status = 'pending'`;
	}
	return row || null;
}

export async function setLinkDefaultAgent(linkId, agentId) {
	await sql`UPDATE gateway_links SET default_agent_id = ${agentId} WHERE id = ${linkId}`;
}

export async function setLinkNotify(linkId, userId, notify) {
	const [row] = await sql`
		UPDATE gateway_links SET notify = ${!!notify}
		WHERE id = ${linkId} AND user_id = ${userId} AND revoked_at IS NULL
		RETURNING id, notify`;
	return row || null;
}

export async function setLinkVoiceReplies(linkId, userId, on) {
	const [row] = await sql`
		UPDATE gateway_links SET voice_replies = ${!!on}
		WHERE id = ${linkId} AND user_id = ${userId} AND revoked_at IS NULL
		RETURNING id, voice_replies`;
	return row || null;
}

/**
 * Make one chat the account's preferred notification channel, or clear it.
 * The partial unique index allows one preferred live link per account, so the
 * old one is cleared first, in the same transaction.
 */
export async function setLinkPreferred(linkId, userId, on) {
	if (!on) {
		const [row] = await sql`
			UPDATE gateway_links SET preferred = false
			WHERE id = ${linkId} AND user_id = ${userId} AND revoked_at IS NULL
			RETURNING id, preferred`;
		return row || null;
	}
	const [, rows] = await sql.transaction([
		sql`UPDATE gateway_links SET preferred = false WHERE user_id = ${userId} AND preferred AND id <> ${linkId}`,
		sql`
			UPDATE gateway_links SET preferred = true, notify = true
			WHERE id = ${linkId} AND user_id = ${userId} AND revoked_at IS NULL
			RETURNING id, preferred`,
	]);
	return rows?.[0] || null;
}

export async function resetLinkContext(linkId) {
	await sql`UPDATE gateway_links SET context_reset_at = now() WHERE id = ${linkId}`;
}

export async function touchLink(linkId) {
	await sql`UPDATE gateway_links SET last_seen_at = now() WHERE id = ${linkId}`;
}

// ── pairing codes ────────────────────────────────────────────────────────────

/** The bot printed a code in a chat; the owner redeems it on the site. */
export async function issueChatCode({ platform, platformUserId, platformUsername = null, chatId, chatType = null, chatTitle = null }) {
	// One live code per chat: a fresh /start supersedes the last one.
	await sql`
		DELETE FROM gateway_pair_codes
		WHERE origin = 'chat' AND platform = ${platform} AND chat_id = ${String(chatId)} AND redeemed_at IS NULL`;
	const code = generatePairCode();
	await sql`
		INSERT INTO gateway_pair_codes (code_hash, origin, platform, platform_user_id, platform_username, chat_id, chat_type, chat_title, expires_at)
		VALUES (${hashPairCode(code)}, 'chat', ${platform}, ${String(platformUserId)}, ${platformUsername}, ${String(chatId)}, ${chatType}, ${chatTitle},
		        now() + make_interval(mins => ${CODE_TTL_MINUTES}))`;
	return { code, expiresInMinutes: CODE_TTL_MINUTES };
}

/** The site generated a code for a signed-in owner to paste into a chat. */
export async function issueSiteCode(userId) {
	await sql`
		DELETE FROM gateway_pair_codes
		WHERE origin = 'site' AND user_id = ${userId} AND redeemed_at IS NULL`;
	const code = generatePairCode();
	const [row] = await sql`
		INSERT INTO gateway_pair_codes (code_hash, origin, user_id, expires_at)
		VALUES (${hashPairCode(code)}, 'site', ${userId}, now() + make_interval(mins => ${CODE_TTL_MINUTES}))
		RETURNING expires_at`;
	return { code, expiresAt: row.expires_at, expiresInMinutes: CODE_TTL_MINUTES };
}

async function loadLiveCode(code, origin) {
	const [row] = await sql`
		SELECT * FROM gateway_pair_codes WHERE code_hash = ${hashPairCode(code)} AND origin = ${origin} LIMIT 1`;
	if (!row) throw new GatewayError('code_invalid', 'That code was not recognised. Codes are eight characters, like ABCD-EFGH.', 404);
	if (row.redeemed_at) throw new GatewayError('code_used', 'That code was already used. Ask for a new one.', 410);
	if (new Date(row.expires_at) <= new Date()) throw new GatewayError('code_expired', 'That code expired. Codes last ten minutes; ask for a new one.', 410);
	return row;
}

async function consumeCode(id, { userId, linkId }) {
	const [row] = await sql`
		UPDATE gateway_pair_codes SET redeemed_at = now(), user_id = COALESCE(user_id, ${userId}), link_id = ${linkId}
		WHERE id = ${id} AND redeemed_at IS NULL AND expires_at > now()
		RETURNING id`;
	if (!row) throw new GatewayError('code_used', 'That code was just used. Ask for a new one.', 410);
}

/** Site side: a signed-in owner redeems a code the bot printed. */
export async function redeemChatCode({ code, userId }) {
	const row = await loadLiveCode(code, 'chat');
	const existing = await getLiveLink(row.platform, row.chat_id);
	if (existing && existing.user_id !== userId) {
		throw new GatewayError('chat_taken', 'That chat is already paired to a different three.ws account. Send /unlink in the chat from that account first.', 409);
	}
	const link = existing || await createLink({
		platform: row.platform, platformUserId: row.platform_user_id, platformUsername: row.platform_username,
		chatId: row.chat_id, chatType: row.chat_type, chatTitle: row.chat_title, userId,
	});
	await consumeCode(row.id, { userId, linkId: link.id });
	return link;
}

/** Chat side: the bot receives a code the owner generated on the site. */
export async function redeemSiteCode({ code, identity }) {
	const row = await loadLiveCode(code, 'site');
	const link = await createLink({ ...identity, userId: row.user_id });
	await consumeCode(row.id, { userId: row.user_id, linkId: link.id });
	return link;
}

// ── webhook inbox ────────────────────────────────────────────────────────────

/** @returns {Promise<boolean>} false when this delivery was already queued (a platform retry). */
export async function enqueueInbox({ platform, dedupeKey, chatKey, payload }) {
	const rows = await sql`
		INSERT INTO gateway_inbox (platform, dedupe_key, chat_key, payload)
		VALUES (${platform}, ${String(dedupeKey)}, ${String(chatKey)}, ${JSON.stringify(payload)}::jsonb)
		ON CONFLICT (platform, dedupe_key) DO NOTHING
		RETURNING id`;
	return rows.length > 0;
}

/**
 * Claim up to `limit` deliveries, at most one per chat, and only the oldest open
 * delivery of a chat whose previous delivery is not still being processed, so a
 * chat's replies always come back in the order its messages were sent.
 *
 * A queued delivery whose `locked_until` lies in the future is backing off after
 * a failed attempt (failInbox with retryAfterSeconds) and is not ready yet; it
 * still heads its chat, so nothing behind it overtakes it.
 *
 * `platforms` limits the claim to the platforms this worker has an adapter for,
 * so a row for a platform it cannot deliver to waits for a worker that can.
 * `chatKeys` limits it to specific chats (draining one chat while debugging).
 */
export async function claimInbox({ limit = 8, leaseSeconds = 120, platforms = null, chatKeys = null } = {}) {
	const platformList = Array.isArray(platforms) ? platforms.map(String) : null;
	const chatList = Array.isArray(chatKeys) ? chatKeys.map(String) : null;
	return sql`
		WITH heads AS (
			SELECT DISTINCT ON (chat_key) id, status, locked_until
			FROM gateway_inbox
			WHERE status IN ('queued', 'processing')
			  AND (${platformList}::text[] IS NULL OR platform = ANY(${platformList}::text[]))
			  AND (${chatList}::text[] IS NULL OR chat_key = ANY(${chatList}::text[]))
			ORDER BY chat_key, id
		), ready AS (
			SELECT id FROM heads
			WHERE (status = 'queued' AND (locked_until IS NULL OR locked_until <= now()))
			   OR (status = 'processing' AND locked_until < now())
			ORDER BY id
			LIMIT ${limit}
		)
		UPDATE gateway_inbox g
		SET status = 'processing', attempts = g.attempts + 1, locked_until = now() + make_interval(secs => ${leaseSeconds})
		FROM ready
		WHERE g.id = ready.id
		  AND ((g.status = 'queued' AND (g.locked_until IS NULL OR g.locked_until <= now()))
		    OR (g.status = 'processing' AND g.locked_until < now()))
		RETURNING g.id, g.platform, g.chat_key, g.payload, g.attempts, g.created_at`;
}

/**
 * Extend the lease on a delivery still being processed, so a long agent turn is
 * never reclaimed (and answered twice) while it is still running. Returns false
 * when the row is no longer this worker's to hold.
 */
export async function renewInboxLease(id, leaseSeconds = 120) {
	const rows = await sql`
		UPDATE gateway_inbox SET locked_until = now() + make_interval(secs => ${leaseSeconds})
		WHERE id = ${id} AND status = 'processing'
		RETURNING id`;
	return rows.length > 0;
}

export async function completeInbox(id) {
	await sql`UPDATE gateway_inbox SET status = 'done', finished_at = now(), locked_until = NULL WHERE id = ${id}`;
}

/**
 * Requeue for another attempt, or park as failed (the dead letter) after
 * `maxAttempts` or when `deadLetter` says a retry cannot help. A requeued row
 * waits `retryAfterSeconds` before it can be claimed again.
 */
export async function failInbox(id, message, { attempts, maxAttempts = 3, retryAfterSeconds = 0, deadLetter = false } = {}) {
	const giveUp = deadLetter || attempts >= maxAttempts;
	const wait = giveUp ? 0 : Math.max(0, Math.ceil(Number(retryAfterSeconds) || 0));
	await sql`
		UPDATE gateway_inbox
		SET status = ${giveUp ? 'failed' : 'queued'}, last_error = ${String(message || '').slice(0, 500)},
		    locked_until = ${wait > 0 ? new Date(Date.now() + wait * 1000).toISOString() : null},
		    finished_at = ${giveUp ? new Date().toISOString() : null}
		WHERE id = ${id}`;
	return giveUp;
}

/** The most recent dead letters, newest first, for the operator. */
export async function listFailedInbox({ limit = 20 } = {}) {
	return sql`
		SELECT id, platform, chat_key, attempts, last_error, created_at, finished_at
		FROM gateway_inbox WHERE status = 'failed'
		ORDER BY finished_at DESC NULLS LAST, id DESC
		LIMIT ${limit}`;
}

/** Put one dead letter back on the queue with a fresh attempt budget. */
export async function requeueInbox(id) {
	const [row] = await sql`
		UPDATE gateway_inbox
		SET status = 'queued', attempts = 0, locked_until = NULL, finished_at = NULL
		WHERE id = ${id} AND status = 'failed'
		RETURNING id, platform, chat_key`;
	return row || null;
}

export async function pruneInbox({ keepDays = 7 } = {}) {
	await sql`
		DELETE FROM gateway_inbox
		WHERE status IN ('done', 'failed') AND created_at < now() - make_interval(days => ${keepDays})`;
}

// ── previews ─────────────────────────────────────────────────────────────────

export async function createPreview({ linkId, userId, agentId, kind, proposal }) {
	const [row] = await sql`
		INSERT INTO gateway_previews (link_id, user_id, agent_id, kind, proposal, expires_at)
		VALUES (${linkId}, ${userId}, ${agentId}, ${kind}, ${JSON.stringify(proposal)}::jsonb,
		        now() + make_interval(mins => ${PREVIEW_TTL_MINUTES}))
		RETURNING *`;
	return row;
}

export async function setPreviewMessageRef(id, ref) {
	await sql`UPDATE gateway_previews SET message_ref = ${JSON.stringify(ref)}::jsonb WHERE id = ${id}`;
}

export async function getPreview(id) {
	if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
	const [row] = await sql`SELECT * FROM gateway_previews WHERE id = ${id} LIMIT 1`;
	return row || null;
}

/** pending -> executing, only while it is still live. Exactly one press wins. */
export async function claimPreview(id) {
	const [row] = await sql`
		UPDATE gateway_previews SET status = 'executing', decided_at = now()
		WHERE id = ${id} AND status = 'pending' AND expires_at > now()
		RETURNING *`;
	return row || null;
}

export async function cancelPreview(id) {
	const [row] = await sql`
		UPDATE gateway_previews SET status = 'cancelled', decided_at = now()
		WHERE id = ${id} AND status = 'pending'
		RETURNING *`;
	return row || null;
}

export async function expirePreview(id) {
	await sql`
		UPDATE gateway_previews SET status = 'expired', decided_at = now()
		WHERE id = ${id} AND status = 'pending'`;
}

export async function finishPreview(id, status, result) {
	await sql`
		UPDATE gateway_previews SET status = ${status}, result = ${JSON.stringify(result || {})}::jsonb
		WHERE id = ${id}`;
}

/**
 * Expire every live preview past its deadline and return what the sweeper
 * needs to strip its buttons: the message ref and the chat's platform.
 */
export async function expireDuePreviews({ limit = 50 } = {}) {
	return sql`
		WITH due AS (
			SELECT id FROM gateway_previews
			WHERE status = 'pending' AND expires_at <= now()
			ORDER BY expires_at
			LIMIT ${limit}
		)
		UPDATE gateway_previews p
		SET status = 'expired', decided_at = now()
		FROM due, gateway_links l
		WHERE p.id = due.id AND l.id = p.link_id AND p.status = 'pending'
		RETURNING p.id, p.proposal, p.message_ref, l.platform`;
}

/** Queue depth for health reporting: open deliveries and the oldest one's age. */
export async function inboxBacklog() {
	const [row] = await sql`
		SELECT count(*)::int AS open,
		       COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::int AS oldest_s
		FROM gateway_inbox WHERE status IN ('queued', 'processing')`;
	return { open: row?.open ?? 0, oldestSeconds: row?.oldest_s ?? 0 };
}

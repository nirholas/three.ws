/**
 * Live trade rooms: spectator chat.
 *
 * Two layers, like trade-room.js:
 *   - PURE: cleanBody, validateBody, shapeMessage, chatCursor, canRemove. No
 *     DB, no network; tests/trade-room-chat.test.js pins them.
 *   - LOADERS: listMessages, insertMessage, removeMessage, fetchNewMessages,
 *     fetchHiddenSince. They run SQL and defer every decision to the pure layer.
 *
 * Moderation never deletes a row. The room owner hiding a message, or its
 * author removing it, stamps hidden_at / hidden_by; every reader filters on
 * hidden_at is null, and the stream announces the removal with `chat_hidden`.
 *
 * Privacy: a message carries the author's public display name and an `owner`
 * flag, never a user id or an email. Viewer-specific flags (`mine`) are only
 * computed on the per-viewer HTTP responses; stream events are shared.
 */

import { sql } from './db.js';
import { containsHateSlur } from './display-name-safety.js';

export const CHAT_MAX_LEN = 280;
export const CHAT_RECENT_LIMIT = 50;
/** An identical message from the same user inside this window is a double-send. */
export const CHAT_DUPLICATE_WINDOW_SEC = 30;
/** Furthest back a stream's chat cursor may start. */
export const CHAT_CURSOR_MAX_AGE_MS = 10 * 60_000;

/** Postgres "undefined_table": the migration has not been applied yet. */
export function isMissingTable(err) {
	return err?.code === '42P01';
}

/**
 * Normalize a raw message: control characters become spaces, runs of spaces
 * collapse, ends are trimmed. PURE. Returns '' for non-strings.
 * @param {unknown} raw
 */
export function cleanBody(raw) {
	if (typeof raw !== 'string') return '';
	return raw
		.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]+/g, ' ')
		.replace(/ {2,}/g, ' ')
		.trim();
}

/**
 * Validate a message a viewer wants to post. PURE.
 * Codes: invalid_body | empty | too_long | blocked_content.
 * @param {unknown} raw
 * @returns {{ok: true, body: string} | {ok: false, code: string, message: string, status: number}}
 */
export function validateBody(raw) {
	if (typeof raw !== 'string') {
		return { ok: false, status: 400, code: 'invalid_body', message: 'Message must be text.' };
	}
	const body = cleanBody(raw);
	if (!body) return { ok: false, status: 400, code: 'empty', message: 'Write something first.' };
	if ([...body].length > CHAT_MAX_LEN) {
		return { ok: false, status: 400, code: 'too_long', message: `Keep it under ${CHAT_MAX_LEN} characters.` };
	}
	if (containsHateSlur(body)) {
		return {
			ok: false,
			status: 422,
			code: 'blocked_content',
			message: 'That message contains language this room does not allow. Rephrase and send again.',
		};
	}
	return { ok: true, body };
}

/**
 * The public name a viewer sees for an author. Never an email. PURE.
 * @param {{display_name?: string|null, username?: string|null}} row
 */
export function publicName(row) {
	const name = String(row?.display_name || '').trim() || String(row?.username || '').trim();
	return name ? name.slice(0, 40) : 'Anonymous';
}

function iso(v) {
	const t = v == null ? NaN : new Date(v).getTime();
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Shape a joined message row for the wire. PURE.
 * @param {object} row trade_room_messages row joined with users (author_*)
 * @param {{ownerId?: string|null, viewerId?: string|null}} [ctx] viewerId adds `mine`
 */
export function shapeMessage(row, { ownerId = null, viewerId = null } = {}) {
	const out = {
		id: row.id,
		body: row.body,
		at: iso(row.created_at),
		name: publicName({ display_name: row.author_display_name, username: row.author_username }),
		avatar: row.author_avatar_url || null,
		is_owner: Boolean(ownerId) && String(row.user_id) === String(ownerId),
	};
	if (viewerId) out.mine = String(row.user_id) === String(viewerId);
	return out;
}

/**
 * Who may remove a message. PURE. The author removes their own; the room owner
 * hides anyone's. Returns the role that applies, or null.
 * @returns {'author'|'owner'|null}
 */
export function canRemove({ message, viewerId, ownerId }) {
	if (!viewerId || !message) return null;
	if (String(message.user_id) === String(viewerId)) return 'author';
	if (ownerId && String(ownerId) === String(viewerId)) return 'owner';
	return null;
}

/**
 * Starting cursor (ms) for the stream's chat poll from the client's newest
 * painted message time. PURE. Missing or unparseable: now. Future: now. Older
 * than the cap: the cap.
 * @param {unknown} raw ISO timestamp
 * @param {number} [now]
 */
export function chatCursor(raw, now = Date.now()) {
	const t = typeof raw === 'string' && raw ? new Date(raw).getTime() : NaN;
	if (!Number.isFinite(t)) return now;
	return Math.min(now, Math.max(now - CHAT_CURSOR_MAX_AGE_MS, t));
}

/**
 * Newest messages for a room, oldest first (the order a chat paints).
 * @param {{agentId: string, limit?: number}} input
 */
export async function listMessages({ agentId, limit = CHAT_RECENT_LIMIT }) {
	const rows = await sql`
		select m.id, m.user_id, m.body, m.created_at, u.display_name as author_display_name, u.username as author_username, u.avatar_url as author_avatar_url
		from trade_room_messages m
		join users u on u.id = m.user_id
		where m.agent_id = ${agentId} and m.hidden_at is null
		order by m.created_at desc
		limit ${Math.max(1, Math.min(CHAT_RECENT_LIMIT, limit))}
	`;
	return rows.reverse();
}

/**
 * True when this user already sent this exact body to this room a moment ago.
 * @param {{agentId: string, userId: string, body: string}} input
 */
export async function isDuplicate({ agentId, userId, body }) {
	const [row] = await sql`
		select 1 as hit from trade_room_messages
		where agent_id = ${agentId} and user_id = ${userId} and body = ${body}
		  and created_at > now() - make_interval(secs => ${CHAT_DUPLICATE_WINDOW_SEC})
		limit 1
	`;
	return Boolean(row);
}

/** Insert a message and return it joined with its author. */
export async function insertMessage({ agentId, userId, body }) {
	const [row] = await sql`
		with ins as (
			insert into trade_room_messages (agent_id, user_id, body)
			values (${agentId}, ${userId}, ${body})
			returning id, user_id, body, created_at
		)
		select ins.id, ins.user_id, ins.body, ins.created_at, u.display_name as author_display_name, u.username as author_username, u.avatar_url as author_avatar_url
		from ins join users u on u.id = ins.user_id
	`;
	return row;
}

/** One visible message in a room, for the permission check before removal. */
export async function loadMessage({ agentId, id }) {
	const [row] = await sql`
		select id, user_id from trade_room_messages
		where id = ${id} and agent_id = ${agentId} and hidden_at is null
		limit 1
	`;
	return row || null;
}

/** Stamp a message hidden. Returns false when it was already hidden or gone. */
export async function removeMessage({ agentId, id, byUserId }) {
	const rows = await sql`
		update trade_room_messages set hidden_at = now(), hidden_by = ${byUserId}
		where id = ${id} and agent_id = ${agentId} and hidden_at is null
		returning id
	`;
	return rows.length > 0;
}

/**
 * Messages created after a cursor, oldest first. Millisecond truncation keeps
 * the comparison honest against a cursor that went through a JS Date.
 * @param {{agentId: string, cursorIso: string}} input
 */
export async function fetchNewMessages({ agentId, cursorIso }) {
	return sql`
		select m.id, m.user_id, m.body, m.created_at, u.display_name as author_display_name, u.username as author_username, u.avatar_url as author_avatar_url
		from trade_room_messages m
		join users u on u.id = m.user_id
		where m.agent_id = ${agentId} and m.hidden_at is null
		  and date_trunc('milliseconds', m.created_at) > ${cursorIso}
		order by m.created_at asc
		limit 50
	`;
}

/**
 * Ids hidden after a cursor, oldest first, so moderation reaches every open
 * tab. Only rows hidden after the cursor are returned.
 * @param {{agentId: string, cursorIso: string}} input
 */
export async function fetchHiddenSince({ agentId, cursorIso }) {
	return sql`
		select id, hidden_at from trade_room_messages
		where agent_id = ${agentId} and hidden_at is not null
		  and date_trunc('milliseconds', hidden_at) > ${cursorIso}
		order by hidden_at asc
		limit 100
	`;
}

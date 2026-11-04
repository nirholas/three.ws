// world-invites: resolve the people a private world is shared with.
//
// Invitees are stored on the world row as user ids. The owner types a username,
// so the handler resolves it here. Usernames (not emails) are the only handle
// accepted: a username is public, an email is not, and answering "is this email
// registered?" to a world owner would leak account existence.

import { sql } from './db.js';

const USERNAME_RE = /^[a-z0-9._-]{1,64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve an owner-typed handle (a username, optionally with a leading "@", or a
 * user id) to a live account.
 * @param {string} handle
 * @returns {Promise<{ id: string, username: string|null }|null>} null when no
 *   active account matches
 */
export async function resolveInvitee(handle) {
	const raw = String(handle ?? '').trim().replace(/^@/, '');
	if (!raw) return null;
	if (UUID_RE.test(raw)) {
		const rows = await sql`
			SELECT id, username FROM users WHERE id = ${raw} AND deleted_at IS NULL LIMIT 1
		`;
		return rows.length ? { id: String(rows[0].id), username: rows[0].username ?? null } : null;
	}
	if (!USERNAME_RE.test(raw)) return null;
	const rows = await sql`
		SELECT id, username FROM users
		WHERE lower(username) = ${raw.toLowerCase()} AND deleted_at IS NULL
		LIMIT 1
	`;
	return rows.length ? { id: String(rows[0].id), username: rows[0].username ?? null } : null;
}

/**
 * Label the invitee ids on a private world for its owner's list.
 * @param {string[]} ids
 * @returns {Promise<Array<{ id: string, username: string|null }>>}
 */
export async function describeInvitees(ids) {
	if (!Array.isArray(ids) || !ids.length) return [];
	const rows = await sql`
		SELECT id, username FROM users WHERE id = ANY(${ids}::uuid[])
	`;
	const byId = new Map(rows.map((r) => [String(r.id), r.username ?? null]));
	return ids.map((id) => ({ id, username: byId.get(id) ?? null }));
}

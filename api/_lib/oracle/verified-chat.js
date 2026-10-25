/**
 * Proof of Telegram chat control for the Oracle alert endpoints.
 *
 * A Telegram private chat id equals the Telegram user id, and that id is
 * verified when an account links Telegram (widget HMAC or the /start deep-link
 * claimed by the bot webhook, see api/_lib/account-link/telegram-login.js).
 * So the only chat a signed-in user has proven to control is the subject of
 * their linked `telegram` identity.
 */

import { sql } from '../db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../auth.js';

export async function resolveUserId(req) {
	const session = await getSessionUser(req);
	if (session) return session.id;
	const bearer = await authenticateBearer(extractBearer(req));
	return bearer ? bearer.userId : null;
}

/** The chat id the user verified by linking Telegram, or null when none is linked. */
export async function verifiedTelegramChatId(userId) {
	const [row] = await sql`
		select subject from user_identities
		where user_id = ${userId} and provider = 'telegram'
		limit 1
	`;
	return row?.subject ? String(row.subject) : null;
}

export const UNVERIFIED_CHAT_MESSAGE =
	'chat_id must be the Telegram chat you linked to your account (sign in with Telegram at /login first)';

export function escapeTelegramHtml(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

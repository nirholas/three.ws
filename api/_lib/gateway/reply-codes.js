// Approve and Cancel for channels without buttons (SMS, Signal, email).
//
// A preview there is rendered as text ending "Reply APPROVE 482913 to execute or
// CANCEL 482913 to discard." The six-digit code is bound to one chat (link) and
// one preview, stored as a sha256, used once, and dead when the preview expires.
// Only a message that is exactly that verb plus that code, from the paired
// sender, becomes a button press; every other message, including prose that
// merely contains the word "approve", goes to the agent as ordinary text and can
// never set the confirm flag.

import { randomInt, createHash } from 'node:crypto';
import { sql } from '../db.js';
import { APPROVE, CANCEL } from './conversation.js';

export const REPLY_CODE_DIGITS = 6;
const REPLY_RE = /^\s*(approve|cancel|dismiss)\s+(\d{6})\s*[.!]?\s*$/i;

function hashReplyCode(linkId, code) {
	return createHash('sha256').update(`gateway-reply:${linkId}:${code}`).digest('hex');
}

function newCode() {
	return String(randomInt(0, 10 ** REPLY_CODE_DIGITS)).padStart(REPLY_CODE_DIGITS, '0');
}

/** Parse a whole message as a reply code answer, or null. */
export function parseReplyCode(text) {
	const m = REPLY_RE.exec(String(text || ''));
	if (!m) return null;
	const verb = m[1].toLowerCase() === 'approve' ? 'approve' : 'cancel';
	return { verb, code: m[2] };
}

/** The preview id a choice id carries (gw:ap:<uuid> or gw:cx:<uuid>). */
export function previewIdOfChoice(choiceId) {
	const s = String(choiceId || '');
	if (s.startsWith(APPROVE)) return s.slice(APPROVE.length);
	if (s.startsWith(CANCEL)) return s.slice(CANCEL.length);
	return null;
}

/**
 * Issue a code for a preview in a chat. One code answers both verbs, so the
 * owner replies APPROVE or CANCEL with the same digits. Retries a collision
 * inside the same chat (the unique index is per link).
 * @returns {Promise<string>} the plaintext code
 */
export async function issueReplyCode({ linkId, previewId, expiresAt }) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = newCode();
		try {
			await sql`
				INSERT INTO gateway_reply_codes (link_id, preview_id, code_hash, expires_at)
				VALUES (${linkId}, ${previewId}, ${hashReplyCode(linkId, code)}, ${expiresAt})`;
			return code;
		} catch (e) {
			if (e?.code !== '23505') throw e;
		}
	}
	throw new Error('could not allocate a unique reply code');
}

/**
 * Resolve a reply code answer in a chat to a button action, consuming the code.
 * Returns null when the code is unknown, used or expired for this chat.
 * @returns {Promise<{ verb:'approve'|'cancel', previewId:string } | null>}
 */
export async function redeemReplyCode({ linkId, verb, code }) {
	const [row] = await sql`
		UPDATE gateway_reply_codes SET used_at = now()
		WHERE link_id = ${linkId} AND code_hash = ${hashReplyCode(linkId, code)}
		  AND used_at IS NULL AND expires_at > now()
		RETURNING preview_id`;
	return row ? { verb, previewId: row.preview_id } : null;
}

/**
 * Render a choice list as text for a channel without buttons, issuing the code.
 * `choices` is what conversation.js passes to sendChoice.
 * @returns {Promise<string>} the full message text
 */
export async function renderTextChoices({ link, text, choices }) {
	const previewId = choices.map((c) => previewIdOfChoice(c.id)).find(Boolean);
	if (!previewId || !link) return text;
	const [preview] = await sql`SELECT id, expires_at FROM gateway_previews WHERE id = ${previewId} LIMIT 1`;
	if (!preview) return text;
	const code = await issueReplyCode({ linkId: link.id, previewId: preview.id, expiresAt: preview.expires_at });
	const canApprove = choices.some((c) => String(c.id).startsWith(APPROVE));
	const body = String(text).replace(/\n*Approve to execute, Cancel to discard\.[^\n]*$/, '');
	const tail = canApprove
		? `Reply APPROVE ${code} to execute or CANCEL ${code} to discard. The code works once, only from this chat, and expires with the preview.`
		: `Reply CANCEL ${code} to dismiss.`;
	return `${body}\n\n${tail}`;
}

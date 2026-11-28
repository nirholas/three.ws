// Command URLs for the three.ws Basecamp chatbot.
//
// A Basecamp admin adds a chatbot (Adminland, or a Campfire's "Configure
// chatbots") and pastes a command URL. Basecamp then POSTs every `!name ...`
// message to that URL with no signature, so the unguessable token in the URL is
// the whole credential. This module mints those tokens for a signed-in three.ws
// account, stores only their SHA-256, resolves an incoming token to its owner,
// and lets the owner list and revoke them. The command handler is
// api/basecamp/command.js; the chat logic is api/_lib/basecamp-forge.js.

import { randomBytes } from 'node:crypto';
import { sql } from './db.js';
import { sha256Hex } from './idempotency.js';

export const MAX_ACTIVE_PER_USER = 10;
export const LABEL_MAX = 60;
const TOKEN_PREFIX = 'bc_';
// 32 random bytes, base64url: 43 characters after the prefix.
const TOKEN_RE = /^bc_[A-Za-z0-9_-]{43}$/;
const COMMAND_PATH = '/api/basecamp/command/';

export class ChatbotLimitError extends Error {
	constructor() {
		super(`An account can have ${MAX_ACTIVE_PER_USER} active Basecamp command URLs. Revoke one you no longer use first.`);
		this.code = 'limit_reached';
		this.status = 409;
	}
}

export function isChatbotToken(token) {
	return typeof token === 'string' && TOKEN_RE.test(token);
}

export function mintToken() {
	return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function commandUrl(origin, token) {
	return `${String(origin).replace(/\/+$/, '')}${COMMAND_PATH}${token}`;
}

/** A label as stored: trimmed, single-line, bounded, never empty. */
export function cleanLabel(raw) {
	const label = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
	return label || 'Basecamp';
}

function present(row) {
	return {
		id: row.id,
		label: row.label,
		token_hint: row.token_hint,
		command_count: Number(row.command_count) || 0,
		last_command_at: row.last_command_at,
		last_basecamp_account: row.last_basecamp_account,
		created_at: row.created_at,
		revoked_at: row.revoked_at,
	};
}

/**
 * Create a command URL for `userId`. Resolves to `{ chatbot, token }`; the
 * token is returned this once and never again.
 */
export async function createChatbot(userId, { label } = {}) {
	const [{ n }] = await sql`
		select count(*)::int as n from basecamp_chatbots where user_id = ${userId} and revoked_at is null
	`;
	if (n >= MAX_ACTIVE_PER_USER) throw new ChatbotLimitError();
	const token = mintToken();
	const [row] = await sql`
		insert into basecamp_chatbots (user_id, label, token_hash, token_hint)
		values (${userId}, ${cleanLabel(label)}, ${sha256Hex(token)}, ${token.slice(-4)})
		returning *
	`;
	return { chatbot: present(row), token };
}

/** Every command URL the account created, newest first, revoked ones included. */
export async function listChatbots(userId) {
	const rows = await sql`
		select * from basecamp_chatbots where user_id = ${userId} order by created_at desc limit 50
	`;
	return rows.map(present);
}

/** Revoke one of the account's command URLs. True when a live one was revoked. */
export async function revokeChatbot(userId, id) {
	const rows = await sql`
		update basecamp_chatbots set revoked_at = now()
		where id = ${id} and user_id = ${userId} and revoked_at is null
		returning id
	`;
	return rows.length > 0;
}

/**
 * The connection a command URL token belongs to, or null for a token that was
 * never issued. A revoked connection is returned with `revoked: true` so the
 * caller can say so in the room instead of failing silently.
 */
export async function resolveToken(token) {
	if (!isChatbotToken(token)) return null;
	const [row] = await sql`
		select b.id, b.user_id, b.label, b.revoked_at
		from basecamp_chatbots b
		join users u on u.id = b.user_id and u.deleted_at is null
		where b.token_hash = ${sha256Hex(token)}
	`;
	if (!row) return null;
	return { id: row.id, userId: row.user_id, label: row.label, revoked: Boolean(row.revoked_at) };
}

/** Count a command against its connection, for the "last used" line in settings. */
export async function recordCommand(id, { basecampAccount = null } = {}) {
	await sql`
		update basecamp_chatbots
		set command_count = command_count + 1,
		    last_command_at = now(),
		    last_basecamp_account = coalesce(${basecampAccount}, last_basecamp_account)
		where id = ${id}
	`;
}

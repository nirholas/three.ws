// Telegram as a sign-in method and an account link.
//
// Two ways in, both landing on the same user_identities row (provider
// 'telegram', subject = the numeric Telegram user id, which never changes):
//
//   widget   the browser is sent to Telegram's login page (the same OAuth
//            endpoint the official login widget uses, loaded without any
//            third-party script so the site CSP stays closed). Telegram sends
//            the person back with id, name, username, photo, auth_date and an
//            HMAC-SHA256 `hash` over those fields keyed by SHA256(bot token).
//            verifyWidgetPayload checks the hash in constant time, the
//            freshness window, and records the payload hash so the exact same
//            payload can never open a second session (replay).
//   magic    the browser mints a one-time token and shows a t.me deep link
//            (and a QR for the phone). Tapping it sends `/start tl_<token>` to
//            the bot, which proves control of that Telegram account to the
//            server. The browser polls with a separate poll secret: the token
//            lives only in the chat, the poll secret only in the browser, and
//            both are stored hashed. Claiming is a single conditional UPDATE,
//            so the second tap of the same link finds nothing to claim.
//
// Both intents (`login` creates or signs in, `link` attaches to the signed-in
// account) run through the same completion: findUserByIdentity, or a fresh
// walletless account with a placeholder email (the SIWS convention), or
// linkIdentity. Nothing here moves funds.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../db.js';
import { randomToken, sha256 } from '../crypto.js';
import { findUserByIdentity, linkIdentity, touchIdentity, IdentityError } from '../identities.js';
import { telegramConfigured, telegramUsername } from '../gateway/bots.js';

export const PROVIDER = 'telegram';
export const MAGIC_PREFIX = 'tl_';
export const MAGIC_TTL_SEC = 10 * 60;
// Telegram signs auth_date with second precision; five minutes absorbs clock
// skew between Telegram and us while keeping a captured payload short-lived.
export const WIDGET_MAX_AGE_SEC = 5 * 60;
export const INTENTS = Object.freeze(['login', 'link']);
export const WIDGET_FIELDS = Object.freeze(['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date']);

const MAGIC_RE = /^tl_[A-Za-z0-9_-]{32,}$/;

export class TelegramLoginError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export function telegramLoginConfigured(env = process.env) {
	return telegramConfigured(env) && /^\d+:/.test(String(env.TELEGRAM_BOT_TOKEN || ''));
}

/** The numeric bot id the widget endpoint keys on: the part of the token before the colon. */
export function telegramBotId(env = process.env) {
	const m = /^(\d+):/.exec(String(env.TELEGRAM_BOT_TOKEN || ''));
	return m ? m[1] : null;
}

/**
 * Where the browser goes to sign in with Telegram. This is the URL the
 * official widget opens; `return_to` must sit on the domain registered with
 * BotFather (/setdomain), or Telegram refuses the request.
 */
export function widgetAuthUrl({ origin, returnTo, env = process.env }) {
	const botId = telegramBotId(env);
	if (!botId) return null;
	const q = new URLSearchParams({ bot_id: botId, origin, return_to: returnTo, request_access: 'write' });
	return `https://oauth.telegram.org/auth?${q.toString()}`;
}

export function isMagicToken(value) {
	return MAGIC_RE.test(String(value || ''));
}

/**
 * Verify a widget callback payload: HMAC over the sorted `key=value` lines
 * of every field except `hash`, keyed by SHA256(bot token), compared in
 * constant time. Then the freshness window. Returns the normalized claims.
 */
export function verifyWidgetPayload(params, { env = process.env, now = Date.now(), maxAgeSec = WIDGET_MAX_AGE_SEC } = {}) {
	const token = env.TELEGRAM_BOT_TOKEN;
	if (!token) throw new TelegramLoginError('not_configured', 'Telegram sign-in is not configured', 501);
	const given = String(params.hash || '');
	if (!/^[0-9a-f]{64}$/.test(given)) throw new TelegramLoginError('invalid_hash', 'the Telegram payload carries no valid signature');
	const lines = Object.keys(params)
		.filter((k) => k !== 'hash' && params[k] !== undefined && params[k] !== null && params[k] !== '')
		.sort()
		.map((k) => `${k}=${params[k]}`);
	const key = createHash('sha256').update(token).digest();
	const expected = createHmac('sha256', key).update(lines.join('\n')).digest('hex');
	if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))) {
		throw new TelegramLoginError('invalid_hash', 'the Telegram payload signature does not match');
	}
	const authDate = Number(params.auth_date);
	if (!Number.isFinite(authDate) || authDate <= 0) throw new TelegramLoginError('invalid_payload', 'the Telegram payload has no auth_date');
	const ageSec = Math.floor(now / 1000) - authDate;
	if (ageSec > maxAgeSec) throw new TelegramLoginError('stale', 'that Telegram sign-in is too old; try again', 400);
	if (ageSec < -60) throw new TelegramLoginError('invalid_payload', 'the Telegram payload is dated in the future');
	if (!/^\d{1,20}$/.test(String(params.id || ''))) throw new TelegramLoginError('invalid_payload', 'the Telegram payload has no user id');
	return { claims: claimsFrom(params), payloadHash: given, authDate: new Date(authDate * 1000) };
}

/** Normalized identity claims from either a widget payload or a bot `from` object. */
export function claimsFrom(src) {
	const subject = String(src.id);
	const first = String(src.first_name || '').trim();
	const last = String(src.last_name || '').trim();
	const username = src.username ? String(src.username).replace(/^@/, '') : null;
	return {
		subject,
		username,
		email: null,
		email_verified: false,
		display_name: [first, last].filter(Boolean).join(' ') || (username ? `@${username}` : `Telegram ${subject}`),
		avatar_url: typeof src.photo_url === 'string' && /^https:\/\//.test(src.photo_url) ? src.photo_url.slice(0, 500) : null,
	};
}

/**
 * Record a widget payload as used. The primary key makes the second insert
 * of the same payload fail, which is exactly a replay. Rows older than the
 * freshness window can never verify again, so they are pruned on the way.
 */
export async function recordWidgetPayload(payloadHash, authDate) {
	await sql`delete from telegram_login_replays where auth_date < now() - interval '1 day'`;
	const rows = await sql`
		insert into telegram_login_replays (payload_hash, auth_date)
		values (${payloadHash}, ${authDate})
		on conflict (payload_hash) do nothing
		returning payload_hash
	`;
	if (!rows.length) throw new TelegramLoginError('replayed', 'that Telegram sign-in was already used', 409);
}

// ── magic links ───────────────────────────────────────────────────────────────

/** Mint a magic link. Returns the deep link for the chat and the poll secret for the browser. */
export async function issueMagicToken({ intent, userId = null, next = null }) {
	if (!INTENTS.includes(intent)) throw new TelegramLoginError('invalid_intent', `intent must be one of ${INTENTS.join(', ')}`);
	if (intent === 'link' && !userId) throw new TelegramLoginError('unauthorized', 'sign in before linking Telegram', 401);
	const token = `${MAGIC_PREFIX}${randomToken(32)}`;
	const pollSecret = randomToken(24);
	const [row] = await sql`
		insert into telegram_login_tokens (token_hash, poll_secret_hash, intent, user_id, next, expires_at)
		values (${await sha256(token)}, ${await sha256(pollSecret)}, ${intent}, ${userId}, ${next},
		        now() + ${`${MAGIC_TTL_SEC} seconds`}::interval)
		returning id, expires_at
	`;
	const bot = await telegramUsername();
	return {
		id: row.id,
		pollSecret,
		expiresAt: row.expires_at,
		deepLink: bot ? `https://t.me/${bot}?start=${token}` : null,
		token,
	};
}

/**
 * The bot received `/start tl_...` from `from` in a private chat. Claim the
 * token for that Telegram account in one conditional UPDATE: a used, expired
 * or unknown token changes nothing and the caller tells the chat so.
 */
export async function claimMagicToken({ token, from, chat }) {
	if (!isMagicToken(token)) return { ok: false, reason: 'invalid' };
	if (chat && chat.type && chat.type !== 'private') return { ok: false, reason: 'group' };
	const claims = claimsFrom(from);
	const chatMeta = chat ? { chat_id: String(chat.id), chat_type: chat.type || 'private', chat_title: chat.title || chat.username || null } : null;
	const [row] = await sql`
		update telegram_login_tokens
		set status = 'claimed', claimed_at = now(), claims = ${JSON.stringify({ ...claims, chat: chatMeta })}::jsonb
		where token_hash = ${await sha256(token)} and status = 'issued' and expires_at > now()
		returning id, intent, user_id
	`;
	if (!row) return { ok: false, reason: 'expired' };
	if (row.intent === 'link') {
		const owner = await findUserByIdentity(PROVIDER, claims.subject);
		if (owner && owner.id !== row.user_id) {
			await sql`update telegram_login_tokens set status = 'expired' where id = ${row.id}`;
			return { ok: false, reason: 'in_use' };
		}
	}
	return { ok: true, id: row.id, intent: row.intent, claims };
}

/** What the browser sees while it polls. Only the poll secret unlocks the row. */
export async function readMagicToken({ id, pollSecret }) {
	if (!id || !pollSecret) return null;
	const [row] = await sql`
		select id, intent, user_id, next, claims, status, expires_at, result_user_id
		from telegram_login_tokens
		where id = ${id} and poll_secret_hash = ${await sha256(pollSecret)}
		limit 1
	`;
	if (!row) return null;
	if (row.status === 'issued' && new Date(row.expires_at).getTime() <= Date.now()) row.status = 'expired';
	return row;
}

/**
 * Finish a claimed magic token: a login signs the claimed Telegram account's
 * user in (creating one when none is linked); a link attaches the claims to
 * the minting user. Single-use: the row flips to `completed` in the same
 * statement that reads it, so a browser that polls twice gets one session.
 */
export async function completeMagicToken({ id, pollSecret, sessionUserId = null }) {
	const [row] = await sql`
		update telegram_login_tokens set status = 'completed', completed_at = now()
		where id = ${id} and poll_secret_hash = ${await sha256(pollSecret)} and status = 'claimed'
		returning id, intent, user_id, next, claims
	`;
	if (!row) throw new TelegramLoginError('not_claimable', 'that sign-in link is no longer waiting', 409);
	const claims = row.claims || {};
	try {
		if (row.intent === 'link') {
			if (!sessionUserId || sessionUserId !== row.user_id) throw new TelegramLoginError('wrong_account', 'this link was started from a different account', 403);
			const result = await linkIdentity({ userId: row.user_id, provider: PROVIDER, claims });
			await sql`update telegram_login_tokens set result_user_id = ${row.user_id} where id = ${row.id}`;
			return { intent: 'link', userId: row.user_id, claims, relinked: result.relinked, next: row.next };
		}
		const { userId, isNew } = await resolveLoginUser(claims);
		await sql`update telegram_login_tokens set result_user_id = ${userId} where id = ${row.id}`;
		return { intent: 'login', userId, isNew, claims, next: row.next };
	} catch (err) {
		// A failed completion must not strand the person on a spent token: let
		// them see the error and start again.
		await sql`update telegram_login_tokens set status = 'expired' where id = ${row.id}`.catch(() => {});
		throw err;
	}
}

/**
 * The account a verified Telegram identity signs into. Linked: that account.
 * Unlinked: a new walletless account named after the Telegram profile with a
 * placeholder address that is never mailed (the SIWS convention).
 */
export async function resolveLoginUser(claims) {
	const linked = await findUserByIdentity(PROVIDER, claims.subject);
	if (linked) {
		if (linked.deleted_at) throw new TelegramLoginError('account_deleted', 'this account has been deleted', 403);
		await touchIdentity(linked.identity_id);
		return { userId: linked.id, isNew: false };
	}
	const idHash = await sha256(`telegram:${claims.subject}`);
	let placeholderEmail = `tg-${idHash.slice(0, 16)}@wallet.local`;
	const [taken] = await sql`select id from users where email = ${placeholderEmail} limit 1`;
	if (taken) placeholderEmail = `tg-${idHash.slice(0, 16)}.${randomToken(8).toLowerCase()}@wallet.local`;
	const [user] = await sql`
		insert into users (email, display_name, avatar_url)
		values (${placeholderEmail}, ${claims.display_name.slice(0, 80)}, ${claims.avatar_url})
		returning id
	`;
	await linkIdentity({ userId: user.id, provider: PROVIDER, claims });
	return { userId: user.id, isNew: true };
}

export { IdentityError };

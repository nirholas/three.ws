// Safety rails for the public X mention bot. Runs before any handler.
//
// X removed tens of thousands of AI reply bots. This bot must never look like
// one: no loops with other bots, no reply storms, no replying where it was not
// addressed, an instant kill switch. Every rule below returns a decision and a
// reason that x-mention-poll.js records on the mention's x_mention_events row.
//
//   paused                    kill switch: env X_MENTION_BOT_PAUSED=1, or the
//                             app_settings row x_mention_bot_paused
//                             ({ "paused": true }), which takes effect on the
//                             next tick with no redeploy
//   own_account               the author is one of our accounts
//   author_blocked            the author id is on the blocklist
//                             (app_settings x_mention_blocklist)
//   bot_quote_of_own_post     a known bot quoted our post and did not address us
//   known_bot                 the author is a known bot (x-mention-known-bots.js)
//   new_account               the author's account is under 24 hours old
//   conversation_hourly       we already replied in this conversation this hour
//   conversation_depth        we already replied twice in this conversation
//
// Author text is untrusted data. Nothing here reads a mention's words; every
// rule keys off ids, timestamps and our own records.

import { sql } from './db.js';
import { companyUserId } from './x-mentions.js';
import * as mentionStore from './x-mention-store.js';
import { loadKnownBots } from './x-mention-known-bots.js';

export const PAUSE_KEY = 'x_mention_bot_paused';
export const BLOCKLIST_KEY = 'x_mention_blocklist';
export const MIN_AUTHOR_AGE_SECONDS = 24 * 3600;
export const CONVERSATION_WINDOW_SECONDS = 3600;
export const CONVERSATION_MAX_REPLIES = 2;

async function readSetting(key) {
	const [row] = await sql`select value from app_settings where key = ${key}`;
	return row?.value ?? null;
}

/** Whether the kill switch is on. The env var and the settings row are both honored. */
export async function isPaused(env = process.env, read = readSetting) {
	if (String(env.X_MENTION_BOT_PAUSED || '').trim() === '1') return true;
	try {
		return (await read(PAUSE_KEY))?.paused === true;
	} catch {
		// A settings read failure must never un-pause the bot, and it must not
		// run on a database it cannot read: fail closed.
		return true;
	}
}

/** Author ids on the owner-managed blocklist: { "ids": ["123", ...] }. */
export async function loadBlocklist(read = readSetting) {
	const value = await read(BLOCKLIST_KEY);
	return new Set((Array.isArray(value?.ids) ? value.ids : []).map(String));
}

/** Every user id and handle that is one of our own accounts. */
export function ownIdentities({ account, env = process.env }) {
	const ids = new Set();
	const handles = new Set();
	const add = (id) => id && ids.add(String(id));
	add(account?.userId);
	add(companyUserId(env));
	for (const id of String(env.X_MENTION_OWN_USER_IDS || '').split(',')) add(id.trim());
	for (const h of [account?.handle, env.X_COMPANY_HANDLE || 'trythreews']) if (h) handles.add(String(h).replace(/^@/, '').toLowerCase());
	return { ids, handles };
}

function ageSeconds(createdAt, now) {
	const t = createdAt ? Date.parse(createdAt) : NaN;
	return Number.isFinite(t) ? Math.floor((now - t) / 1000) : null;
}

function mentionsHandle(mention, handles) {
	return (mention.mentions || []).some((m) => m.username && handles.has(String(m.username).toLowerCase()));
}

/**
 * Decide whether a mention may be answered at all. Rules run cheapest and
 * most absolute first. Never throws for a missing optional field.
 *
 * @param {{ mention: any, account: any, env?: object, now?: number, store?: object, read?: Function, knownBots?: { isKnownBot: (author: {id?:string,username?:string}) => boolean } }} o
 * @returns {Promise<{ allow: true } | { allow: false, decision: 'skip', reason: string }>}
 */
export async function guardMention({ mention, account, env = process.env, now = Date.now(), store = mentionStore, read = readSetting, knownBots = null }) {
	const authorId = String(mention.userId || mention.author?.id || '');
	const own = ownIdentities({ account, env });
	const skip = (reason) => ({ allow: false, decision: 'skip', reason });

	if (own.ids.has(authorId) || own.handles.has(String(mention.username || mention.author?.username || '').toLowerCase())) return skip('own_account');
	if ((await loadBlocklist(read)).has(authorId)) return skip('author_blocked');

	const bots = knownBots || (await loadKnownBots({ env, read }));
	const author = { id: authorId, username: mention.username || mention.author?.username || null };
	if (bots.isKnownBot(author)) {
		const quotedAuthor = mention.quoted?.author?.id ? String(mention.quoted.author.id) : null;
		if (quotedAuthor && own.ids.has(quotedAuthor) && !mentionsHandle(mention, own.handles)) return skip('bot_quote_of_own_post');
		return skip('known_bot');
	}

	const age = ageSeconds(mention.author?.createdAt, now);
	if (age !== null && age < MIN_AUTHOR_AGE_SECONDS) return skip('new_account');

	const conversationId = mention.conversationId || mention.chatId;
	if (conversationId) {
		const acct = { kind: account.kind, ref: account.ref };
		const total = await store.countRepliesInConversation(conversationId, { account: acct });
		if (total >= CONVERSATION_MAX_REPLIES) return skip('conversation_depth');
		const recent = await store.countRepliesInConversation(conversationId, { windowSeconds: CONVERSATION_WINDOW_SECONDS, account: acct });
		if (recent >= 1) return skip('conversation_hourly');
	}
	return { allow: true };
}

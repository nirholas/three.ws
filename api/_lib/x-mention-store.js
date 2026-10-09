// @ts-check
// The audit trail and dedupe ledger of the X mention bot.
//
// Every mention the reader (x-mentions.js) returns is recorded here once,
// with the intent the pure parser (x-mention-intents.js) gave it, before
// anything else happens. The tweet id is the primary key, so two overlapping
// polls that both see a mention race on one INSERT ... ON CONFLICT DO
// NOTHING and exactly one of them wins the right to handle it. The decision,
// the reply (or, in dry-run mode, the reply it would have posted) and any
// error are written back onto the same row. The table is
// x_mention_events (migration 20261008170000_x_mention_events.sql).
//
// Polling cursors are one app_settings row per account,
// `x_mentions_cursor:<kind>:<ref>` (e.g. x_mentions_cursor:company:trythreews,
// x_mentions_cursor:agent:<agent id>), and only ever move forward.

import { sql } from './db.js';

export const DECISIONS = Object.freeze(['reply', 'skip', 'rate_limited', 'unsafe', 'budget', 'error', 'pending', 'paused']);
export const ACCOUNT_KINDS = Object.freeze(['company', 'agent']);
export const MENTION_TEXT_MAX = 4000;
const TEXT_MAX = 2000;
const SNOWFLAKE_RE = /^\d{1,25}$/;

export class MentionStoreError extends Error {
	/** @param {string} message @param {string} code */
	constructor(message, code) {
		super(message);
		this.name = 'MentionStoreError';
		this.code = code;
	}
}

function capText(v, max = TEXT_MAX) {
	if (v == null) return null;
	const s = String(v);
	return s.length > max ? s.slice(0, max) : s;
}

function accountOf(account) {
	const kind = account?.kind;
	const ref = account?.ref != null ? String(account.ref) : '';
	if (!ACCOUNT_KINDS.includes(kind) || !ref) throw new MentionStoreError('account must be { kind: company|agent, ref }', 'bad_account');
	return { kind, ref };
}

/** The app_settings key holding one account's mention cursor. */
export function cursorKey(account) {
	const { kind, ref } = accountOf(account);
	return `x_mentions_cursor:${kind}:${ref}`;
}

/** The newest mention id already read for an account, or null before the first poll. */
export async function getCursor(account) {
	const [row] = await sql`select value from app_settings where key = ${cursorKey(account)}`;
	const id = row?.value?.since_id;
	return id ? String(id) : null;
}

/**
 * Move an account's cursor forward to `sinceId`. A cursor never moves back:
 * when two polls finish out of order, the older one's write is a no-op.
 * @returns {Promise<boolean>} true when the cursor moved
 */
export async function advanceCursor(account, sinceId) {
	const id = String(sinceId ?? '');
	if (!SNOWFLAKE_RE.test(id)) throw new MentionStoreError(`not an X post id: ${id.slice(0, 40)}`, 'bad_cursor');
	const value = JSON.stringify({ since_id: id });
	const rows = await sql`
		insert into app_settings (key, value) values (${cursorKey(account)}, ${value}::jsonb)
		on conflict (key) do update
			set value = excluded.value, updated_at = now()
			where coalesce((app_settings.value->>'since_id')::numeric, 0) < (excluded.value->>'since_id')::numeric
		returning key
	`;
	return rows.length > 0;
}

/**
 * Record a mention once. The first caller for a tweet id gets
 * `inserted: true` and owns its handling; every later caller gets false.
 *
 * @param {{ mention: any, parsed: { intent: string, args?: object, reason?: string }, dryRun?: boolean, decision?: string|null, reason?: string|null }} input
 * @returns {Promise<{ inserted: boolean, tweetId: string }>}
 */
export async function recordMention({ mention, parsed, dryRun = true, decision = null, reason = null }) {
	const tweetId = String(mention?.id ?? '');
	if (!SNOWFLAKE_RE.test(tweetId)) throw new MentionStoreError('mention has no X post id', 'bad_mention');
	const authorId = mention?.userId || mention?.author?.id;
	if (!authorId) throw new MentionStoreError('mention has no author id', 'bad_mention');
	const { kind, ref } = accountOf(mention?.account);
	if (!parsed?.intent) throw new MentionStoreError('mention was not parsed', 'bad_intent');
	if (decision != null && !DECISIONS.includes(decision)) throw new MentionStoreError(`unknown decision: ${decision}`, 'bad_decision');
	const createdAt = mention.createdAt && Number.isFinite(Date.parse(mention.createdAt)) ? mention.createdAt : null;
	const rows = await sql`
		insert into x_mention_events (
			tweet_id, account_kind, account_ref, author_id, author_username, conversation_id,
			mention_text, mention_created_at, intent, args, decision, reason, dry_run, decided_at
		) values (
			${tweetId}, ${kind}, ${ref}, ${String(authorId)}, ${mention.username || mention.author?.username || null},
			${mention.conversationId || mention.chatId || null}, ${capText(mention.text, MENTION_TEXT_MAX)}, ${createdAt},
			${parsed.intent}, ${JSON.stringify(parsed.args || {})}::jsonb, ${decision},
			${capText(reason ?? parsed.reason ?? null)}, ${dryRun !== false}, ${decision ? new Date().toISOString() : null}
		)
		on conflict (tweet_id) do nothing
		returning tweet_id
	`;
	return { inserted: rows.length > 0, tweetId };
}

/**
 * Write a decision and its reply back onto a recorded mention. Fields left
 * undefined keep their value. A reply_tweet_id, once set, is never replaced:
 * one mention gets one reply.
 *
 * @param {string} tweetId
 * @param {{ decision?: string, reason?: string, replyText?: string, replyMediaUrl?: string, replyLink?: string, replyTweetId?: string, creationId?: string, error?: string, dryRun?: boolean }} fields
 * @returns {Promise<object|null>} the updated row, or null when no such mention
 */
export async function updateDecision(tweetId, fields = {}) {
	const id = String(tweetId ?? '');
	if (!SNOWFLAKE_RE.test(id)) throw new MentionStoreError('not an X post id', 'bad_mention');
	const d = fields.decision ?? null;
	if (d != null && !DECISIONS.includes(d)) throw new MentionStoreError(`unknown decision: ${d}`, 'bad_decision');
	const replyTweetId = fields.replyTweetId != null ? String(fields.replyTweetId) : null;
	const rows = await sql`
		update x_mention_events set
			decision        = coalesce(${d}, decision),
			reason          = coalesce(${capText(fields.reason)}, reason),
			reply_text      = coalesce(${capText(fields.replyText)}, reply_text),
			reply_media_url = coalesce(${capText(fields.replyMediaUrl)}, reply_media_url),
			reply_link      = coalesce(${capText(fields.replyLink)}, reply_link),
			reply_tweet_id  = coalesce(reply_tweet_id, ${replyTweetId}),
			replied_at      = case when reply_tweet_id is null and ${replyTweetId}::text is not null then now() else replied_at end,
			creation_id     = coalesce(${fields.creationId != null ? String(fields.creationId) : null}, creation_id),
			error           = coalesce(${capText(fields.error)}, error),
			dry_run         = coalesce(${typeof fields.dryRun === 'boolean' ? fields.dryRun : null}::boolean, dry_run),
			decided_at      = case when ${d}::text is not null then now() else decided_at end,
			updated_at      = now()
		where tweet_id = ${id}
		returning *
	`;
	return rows[0] || null;
}

/** One recorded mention, or null. */
export async function getMentionEvent(tweetId) {
	const [row] = await sql`select * from x_mention_events where tweet_id = ${String(tweetId)}`;
	return row || null;
}

/**
 * How many mentions from one author were recorded in the trailing window,
 * optionally limited to some decisions (e.g. ['reply'] for a reply cap) and
 * to one of our accounts.
 *
 * @param {string} authorId
 * @param {{ windowSeconds?: number, decisions?: string[]|null, account?: { kind: string, ref: string }|null }} [opts]
 */
export async function countByAuthor(authorId, { windowSeconds = 3600, decisions = null, account = null } = {}) {
	const secs = Math.max(1, Math.round(Number(windowSeconds) || 3600));
	const list = decisions && decisions.length ? decisions.filter((x) => DECISIONS.includes(x)) : null;
	const acct = account ? accountOf(account) : null;
	const [row] = await sql`
		select count(*)::int as n from x_mention_events
		where author_id = ${String(authorId)}
		  and created_at > now() - make_interval(secs => ${secs})
		  and (${list ? list.join(',') : null}::text is null or decision = any(string_to_array(${list ? list.join(',') : null}::text, ',')))
		  and (${acct?.kind ?? null}::text is null or (account_kind = ${acct?.kind ?? null} and account_ref = ${acct?.ref ?? null}))
	`;
	return row?.n ?? 0;
}

/**
 * The most recent recorded mentions of one account, newest first, optionally
 * only one decision (the dry-run console lists `reply` rows with dry_run).
 *
 * @param {{ kind: string, ref: string }} account
 * @param {{ limit?: number, decision?: string|null, dryRun?: boolean|null }} [opts]
 */
export async function recentDecisions(account, { limit = 50, decision = null, dryRun = null } = {}) {
	const { kind, ref } = accountOf(account);
	if (decision != null && !DECISIONS.includes(decision)) throw new MentionStoreError(`unknown decision: ${decision}`, 'bad_decision');
	const n = Math.max(1, Math.min(500, Math.round(Number(limit) || 50)));
	return sql`
		select * from x_mention_events
		where account_kind = ${kind} and account_ref = ${ref}
		  and (${decision}::text is null or decision = ${decision})
		  and (${dryRun}::boolean is null or dry_run = ${dryRun})
		order by created_at desc, tweet_id desc
		limit ${n}
	`;
}

/**
 * How many replies we recorded in one conversation on one of our accounts,
 * optionally only inside a trailing window. Dry-run replies count: they are
 * recorded with decision `reply` exactly like live ones.
 *
 * @param {string} conversationId
 * @param {{ windowSeconds?: number|null, account: { kind: string, ref: string } }} opts
 */
export async function countRepliesInConversation(conversationId, { windowSeconds = null, account }) {
	const acct = accountOf(account);
	const secs = windowSeconds ? Math.max(1, Math.round(Number(windowSeconds))) : null;
	const [row] = await sql`
		select count(*)::int as n from x_mention_events
		where conversation_id = ${String(conversationId)}
		  and decision = 'reply'
		  and account_kind = ${acct.kind} and account_ref = ${acct.ref}
		  and (${secs}::int is null or created_at > now() - make_interval(secs => ${secs}))
	`;
	return row?.n ?? 0;
}

/**
 * Merge a patch into a recorded mention's args. Used to stamp the human a bot
 * mention is answered on behalf of (`on_behalf_of`) so rate limits and the
 * bot loop cap can find it later.
 *
 * @param {string} tweetId
 * @param {Record<string, unknown>} patch
 */
export async function mergeArgs(tweetId, patch) {
	const id = String(tweetId ?? '');
	if (!SNOWFLAKE_RE.test(id)) throw new MentionStoreError('not an X post id', 'bad_mention');
	const rows = await sql`
		update x_mention_events set args = coalesce(args, '{}'::jsonb) || ${JSON.stringify(patch || {})}::jsonb, updated_at = now()
		where tweet_id = ${id}
		returning tweet_id
	`;
	return rows.length > 0;
}

/**
 * Mentions attributed to one human in the trailing window: the ones they wrote
 * themselves plus the ones a known bot wrote on their behalf, so a person gets
 * one allowance however they reach us.
 *
 * @param {string} principalId  the human's X user id
 * @param {{ windowSeconds?: number, decisions?: string[]|null, account?: { kind: string, ref: string }|null }} [opts]
 */
export async function countByPrincipal(principalId, { windowSeconds = 3600, decisions = null, account = null } = {}) {
	const secs = Math.max(1, Math.round(Number(windowSeconds) || 3600));
	const list = decisions && decisions.length ? decisions.filter((x) => DECISIONS.includes(x)) : null;
	const acct = account ? accountOf(account) : null;
	const [row] = await sql`
		select count(*)::int as n from x_mention_events
		where (author_id = ${String(principalId)} or args->'on_behalf_of'->>'id' = ${String(principalId)})
		  and created_at > now() - make_interval(secs => ${secs})
		  and (${list ? list.join(',') : null}::text is null or decision = any(string_to_array(${list ? list.join(',') : null}::text, ',')))
		  and (${acct?.kind ?? null}::text is null or (account_kind = ${acct?.kind ?? null} and account_ref = ${acct?.ref ?? null}))
	`;
	return row?.n ?? 0;
}

/**
 * Replies already sent to a bot on behalf of a human in one conversation.
 * The bot loop cap reads this: one per conversation, ever.
 *
 * @param {string} conversationId
 * @param {{ account: { kind: string, ref: string } }} opts
 */
export async function countBotRepliesInConversation(conversationId, { account }) {
	const acct = accountOf(account);
	const [row] = await sql`
		select count(*)::int as n from x_mention_events
		where conversation_id = ${String(conversationId)}
		  and decision = 'reply'
		  and args->'on_behalf_of' is not null
		  and account_kind = ${acct.kind} and account_ref = ${acct.ref}
	`;
	return row?.n ?? 0;
}

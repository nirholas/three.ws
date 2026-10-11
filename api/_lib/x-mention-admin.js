// @ts-check
// Operator controls for the X mention bot, read by /x/ops (api/x/ops/[action].js).
//
// Two app_settings keys, both chosen to match the names and value shapes the
// poll cron's guard uses on main (x-mention-guard.js: PAUSE_KEY, BLOCKLIST_KEY)
// so that a future merge of that cron needs no data migration, even though the
// guard itself (the code that reads these keys before replying) does not exist
// on this branch yet. This module only writes the switches; enforcement is out
// of scope here.
//
//   x_mention_bot_paused  -> { paused: boolean }   also honored via env X_MENTION_BOT_PAUSED
//   x_mention_blocklist   -> { ids: string[] }     X author ids, never auto-replied to
//
// The one live-send path lives here too: turning a single captured dry-run
// reply into a real post. "Dry run" on x_mention_events means a reply was
// composed and recorded but never sent; sendDryRunReply posts exactly that
// text (and media, if any) to X, through the same account the mention
// addressed (the company account or one agent's connected account), then
// marks the row live. It never re-derives the reply from the mention text:
// the operator is sending what was already decided, not asking anything new.

import { sql } from './db.js';
import { fetchUpstreamPublic } from './upstream-fetch.js';
import { getMentionEvent, updateDecision } from './x-mention-store.js';
import { postOne, uploadMediaV2, refreshIfNeeded } from './x-post.js';
import { xClientFromEnv } from './x-content/publisher.js';

export const PAUSE_KEY = 'x_mention_bot_paused';
export const BLOCKLIST_KEY = 'x_mention_blocklist';
const MEDIA_FETCH_TIMEOUT_MS = 20_000;
const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

export class MentionAdminError extends Error {
	/** @param {string} message @param {string} code @param {number} [status] */
	constructor(message, code, status = 400) {
		super(message);
		this.name = 'MentionAdminError';
		this.code = code;
		this.status = status;
	}
}

async function readSetting(key) {
	const [row] = await sql`select value from app_settings where key = ${key}`;
	return row?.value ?? null;
}

async function writeSetting(key, value) {
	await sql`
		insert into app_settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
		on conflict (key) do update set value = excluded.value, updated_at = now()
	`;
}

/** Whether the bot is paused right now, per app_settings. */
export async function isPaused() {
	const value = await readSetting(PAUSE_KEY);
	return !!value?.paused;
}

/** Flip the kill switch. The caller (api/x/ops) is responsible for the audit-log entry. */
export async function setPaused(paused) {
	const next = !!paused;
	await writeSetting(PAUSE_KEY, { paused: next, updated_at: new Date().toISOString() });
	return next;
}

/** The blocked X author ids. */
export async function loadBlocklist() {
	const value = await readSetting(BLOCKLIST_KEY);
	const ids = Array.isArray(value?.ids) ? value.ids.map(String).filter(Boolean) : [];
	return [...new Set(ids)];
}

export async function blockAuthor(authorId) {
	const id = String(authorId ?? '').trim();
	if (!id) throw new MentionAdminError('author id required', 'validation_error', 400);
	const ids = await loadBlocklist();
	if (!ids.includes(id)) ids.push(id);
	await writeSetting(BLOCKLIST_KEY, { ids });
	return ids;
}

export async function unblockAuthor(authorId) {
	const id = String(authorId ?? '').trim();
	const ids = (await loadBlocklist()).filter((x) => x !== id);
	await writeSetting(BLOCKLIST_KEY, { ids });
	return ids;
}

function mediaCategoryFor(mimeType) {
	if (mimeType.startsWith('video/')) return 'tweet_video';
	if (mimeType === 'image/gif') return 'tweet_gif';
	return 'tweet_image';
}

/** Fetch a recorded reply_media_url's bytes, SSRF-safe: this URL was written by our own generation pipeline, but it is still an outbound fetch to an operator-triggered address. */
async function fetchReplyMedia(url) {
	const res = await fetchUpstreamPublic(
		url,
		{},
		{ name: 'x:ops:media', timeoutMs: MEDIA_FETCH_TIMEOUT_MS, attempts: 1 },
	);
	const contentType = res.headers.get('content-type') || 'image/png';
	const buffer = Buffer.from(await res.arrayBuffer());
	if (buffer.length > MEDIA_MAX_BYTES) throw new MentionAdminError('reply media is too large to send', 'media_too_large', 400);
	return { buffer, mimeType: contentType.split(';')[0].trim() || 'image/png' };
}

/**
 * The posting surface for one mention's account: company (@trythreews, OAuth
 * 1.0a via x-content/publisher.js) or one agent's own connected account
 * (OAuth2 via x-post.js). This is deliberately not publishTweet() in
 * x-post.js: that function enforces a monthly quota, a posting-cadence floor
 * and dedup rules meant for a user choosing to post, none of which apply to
 * sending a bot reply that was already decided and recorded.
 */
async function resolveSendTarget(accountKind, accountRef) {
	if (accountKind === 'company') {
		const client = await xClientFromEnv();
		if (!client) throw new MentionAdminError('the company X account is not configured on this deployment', 'not_configured', 501);
		return {
			async post({ text, replyTo, mediaIds }) {
				const payload = { text };
				if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };
				if (mediaIds?.length) payload.media = { media_ids: mediaIds };
				const { data } = await client.tweet(payload);
				return data.id;
			},
			uploadMedia: (buffer, mimeType) => client.uploadMedia(buffer, { media_type: mimeType, media_category: mediaCategoryFor(mimeType) }),
		};
	}
	if (accountKind === 'agent') {
		const [conn] = await sql`
			select agent_id, access_token, refresh_token, expires_at
			from agent_x_connections
			where agent_id = ${accountRef} and disconnected_at is null
			limit 1
		`;
		if (!conn) throw new MentionAdminError(`agent ${accountRef} has no connected X account`, 'not_connected', 400);
		const accessToken = await refreshIfNeeded({ ...conn, source: 'agent' });
		return {
			async post({ text, replyTo, mediaIds }) {
				const data = await postOne({ accessToken, text, replyTo, mediaIds });
				return data.id;
			},
			uploadMedia: (buffer, mimeType) => uploadMediaV2({ accessToken, buffer, mimeType }),
		};
	}
	throw new MentionAdminError(`unknown account kind: ${accountKind}`, 'bad_account', 400);
}

/**
 * Post exactly one already-decided, still-dry-run reply, live. Never derives
 * new reply text: the row's own reply_text and reply_media_url, captured when
 * the bot made its decision, are what goes out.
 *
 * @param {{ tweetId: string }} input
 * @returns {Promise<object>} the updated x_mention_events row
 */
export async function sendDryRunReply({ tweetId }) {
	const row = await getMentionEvent(tweetId);
	if (!row) throw new MentionAdminError('mention not found', 'not_found', 404);
	if (row.decision !== 'reply') throw new MentionAdminError('this mention has no reply queued to send', 'not_sendable', 409);
	if (!row.dry_run || row.reply_tweet_id) throw new MentionAdminError('this reply was already sent live', 'already_sent', 409);
	const text = String(row.reply_text || '').trim();
	if (!text) throw new MentionAdminError('this mention has no reply text to send', 'not_sendable', 409);

	const target = await resolveSendTarget(row.account_kind, row.account_ref);

	let mediaIds = null;
	if (row.reply_media_url) {
		const { buffer, mimeType } = await fetchReplyMedia(row.reply_media_url);
		mediaIds = [await target.uploadMedia(buffer, mimeType)];
	}

	let replyTweetId;
	try {
		replyTweetId = await target.post({ text, replyTo: row.tweet_id, mediaIds });
	} catch (err) {
		await updateDecision(row.tweet_id, { error: `manual send failed: ${String(err?.message || err).slice(0, 2000)}` });
		throw err instanceof MentionAdminError ? err : new MentionAdminError(`send failed: ${err?.message || err}`, 'send_failed', 502);
	}

	return updateDecision(row.tweet_id, { replyTweetId, dryRun: false });
}

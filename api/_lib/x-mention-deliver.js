// The delivery bridge for late replies. `finishPendingMakes()` and
// `finishPendingAvatars()` settle a pending row long after the mention was
// handled, and hand the finished reply to an injected `deliver`. This builds
// that function on the order 049 X adapter (gateway/adapters/x.js), so a late
// reply goes through exactly the same safety shape as an immediate one:
//
//   - dry run (the default): the adapter records the would-be reply on the
//     x_mention_events row and makes no HTTP call; `deliver` resolves to null;
//   - live (X_MENTION_BOT_LIVE=1, the row is not dry, and a token resolver is
//     supplied): the adapter posts the reply, with its media, to the mention's
//     author and `deliver` resolves to the new post id.
//
// Callers only invoke `deliver` for rows that are not dry, so the adapter's own
// policy gate is the second lock, never the only one.

import * as mentionStore from './x-mention-store.js';
import { createXAdapter } from './gateway/adapters/x.js';

/** The mention object the adapter needs, rebuilt from the recorded row. */
function mentionFromRow(row) {
	return {
		id: row.tweet_id,
		userId: row.author_id,
		username: row.author_username || null,
		text: row.mention_text || '',
		createdAt: row.mention_created_at || null,
		conversationId: row.conversation_id || null,
		account: { kind: row.account_kind, ref: row.account_ref },
	};
}

/**
 * @param {{ env?: Record<string,string|undefined>, store?: typeof mentionStore, adapterFactory?: typeof createXAdapter, getAccessToken?: ((row: object) => (() => Promise<string>)|null)|null }} [opts]
 *   `getAccessToken(row)` returns the posting account's token resolver for that
 *   row, or null when none exists (the adapter then stays in dry run).
 * @returns {(args: { text: string, mediaUrl?: string|null, inReplyToTweetId: string }) => Promise<string|null>}
 */
export function createDeliver({ env = process.env, store = mentionStore, adapterFactory = createXAdapter, getAccessToken = null } = {}) {
	return async function deliver({ text, mediaUrl = null, inReplyToTweetId }) {
		const row = await store.getMentionEvent(inReplyToTweetId);
		if (!row) return null;
		const resolver = typeof getAccessToken === 'function' ? getAccessToken(row) : null;
		const adapter = adapterFactory({
			mention: mentionFromRow(row),
			parsed: { intent: row.intent },
			policyDryRun: row.dry_run !== false,
			getAccessToken: resolver,
			env,
			store,
		});
		const chatId = String(row.tweet_id);
		const sent = mediaUrl
			? await adapter.sendMedia(chatId, { url: mediaUrl, caption: text })
			: await adapter.sendText(chatId, text);
		return sent?.dry_run ? null : sent?.ref?.messageId || null;
	};
}

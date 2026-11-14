// The company account's (@trythreews) posting surface for mention replies.
//
// One OAuth 1.0a client from the X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN /
// X_ACCESS_SECRET env (x-content/publisher.js), shaped as the `sender` the X
// adapter (gateway/adapters/x.js) and the /x/ops manual send both take:
//
//   post({ text, replyTo, mediaIds }) -> the new post id
//   uploadMedia(buffer, mimeType)     -> the X media id
//
// It is deliberately not publishTweet() in x-post.js: that enforces a monthly
// quota, a cadence floor and dedup rules meant for a person choosing to post,
// none of which apply to a bot reply that was already decided and recorded.
// The mention bot's own guard, per-author limits and X budget (x-budget.js)
// govern how often this is called.

import { xClientFromEnv } from './x-content/publisher.js';

/** The X media category for an upload of this MIME type. */
export function mediaCategoryFor(mimeType) {
	if (mimeType.startsWith('video/')) return 'tweet_video';
	if (mimeType === 'image/gif') return 'tweet_gif';
	return 'tweet_image';
}

/** Wrap a twitter-api-v2 v2 client as a sender. */
export function senderFromClient(client) {
	return {
		async post({ text, replyTo = null, mediaIds = null }) {
			const payload = { text };
			if (replyTo) payload.reply = { in_reply_to_tweet_id: String(replyTo) };
			if (mediaIds?.length) payload.media = { media_ids: mediaIds };
			const { data } = await client.tweet(payload);
			return data.id;
		},
		uploadMedia: (buffer, mimeType) => client.uploadMedia(buffer, { media_type: mimeType, media_category: mediaCategoryFor(mimeType) }),
	};
}

/**
 * The company sender, or null when the company credentials are not all set on
 * this deployment (callers then stay in dry run).
 * @param {Record<string, string|undefined>} [env]
 */
export async function companySender(env = process.env) {
	const client = await xClientFromEnv(env);
	return client ? senderFromClient(client) : null;
}

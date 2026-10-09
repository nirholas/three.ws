// X adapter for the gateway core. A mention of one of our X accounts is just
// another chat event: the "chat" is the mention being answered, so
// `chatId` is that mention's post id and every send is a reply to it. X has
// no buttons and no message editing, so choices render as a three.ws link and
// `typing` does nothing.
//
// Safety shape (order x-grok 27, CLAUDE.md gate 2):
//  - Dry run is the default. A send reaches X only when X_MENTION_BOT_LIVE is
//    exactly "1" AND the account's policy is not in dry run AND a token
//    resolver was supplied. Otherwise the would-be reply is written to
//    x_mention_events and a synthetic delivery marked `dry_run` comes back;
//    no HTTP call is made.
//  - The adapter is bound to ONE mention. It can only reply to that post
//    (so only to its author), at most `maxPosts` posts in total, and never
//    twice: a mention whose row already holds a reply_tweet_id is refused.
//  - Reply text is built by our code from the agent turn; nothing the
//    mention author wrote is ever treated as an instruction here.

import { chunkForX, fitsInPost, X_POST_MAX_WEIGHT, weightedLength } from '../../x-text-weight.js';
import { appOrigin } from '../format.js';
import * as mentionStore from '../../x-mention-store.js';

export const PLATFORM = 'x';
export const MAX_REPLY_POSTS = 2;
export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
const MEDIA_FETCH_TIMEOUT_MS = 20_000;

export class XAdapterError extends Error {
	/** @param {string} code @param {string} message */
	constructor(code, message) {
		super(message);
		this.name = 'XAdapterError';
		this.code = code;
	}
}

/** True only when the operator flipped the global switch to exactly "1". */
export function xBotLive(env = process.env) {
	return env.X_MENTION_BOT_LIVE === '1';
}

async function defaultPost() {
	return (await import('../../x-post.js')).postOne;
}
async function defaultUpload() {
	return (await import('../../x-post.js')).uploadMediaV2;
}

async function defaultFetchMedia(url) {
	const { fetchSafePublicUrlPinned } = await import('../../ssrf-guard.js');
	const r = await fetchSafePublicUrlPinned(url, { signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) }, { maxBytes: MEDIA_MAX_BYTES });
	if (!r.ok) throw new XAdapterError('media_fetch_failed', `media download answered ${r.status}`);
	const mimeType = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	return { buffer: Buffer.from(await r.arrayBuffer()), mimeType };
}

const MEDIA_MIME = /^(image\/(png|jpe?g|webp|gif)|video\/mp4)$/;

/**
 * @param {object} opts
 * @param {object} opts.mention             the recorded mention: { id, account:{kind,ref}, userId|author, username, text, createdAt, conversationId }
 * @param {{ intent: string, args?: object }} [opts.parsed]  the parser result, used to create the audit row when it does not exist yet
 * @param {boolean} [opts.policyDryRun]     the account's own dry-run toggle (true keeps the adapter in dry run)
 * @param {() => Promise<string>} [opts.getAccessToken]  resolves the posting account's OAuth token; never called in dry run
 * @param {string} [opts.buttonsUrl]        where choices render, default the three.ws dashboard
 * @param {number} [opts.maxPosts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {typeof mentionStore} [opts.store]
 * @param {Function} [opts.post]            postOne override (tests capture at the HTTP boundary instead)
 * @param {Function} [opts.uploadMedia]
 * @param {Function} [opts.fetchMedia]
 */
export function createXAdapter({
	mention,
	parsed = { intent: 'chat' },
	policyDryRun = true,
	getAccessToken = null,
	buttonsUrl = null,
	maxPosts = MAX_REPLY_POSTS,
	env = process.env,
	store = mentionStore,
	post = null,
	uploadMedia = null,
	fetchMedia = defaultFetchMedia,
} = {}) {
	const mentionId = String(mention?.id ?? '');
	if (!/^\d{1,25}$/.test(mentionId)) throw new XAdapterError('bad_mention', 'the X adapter needs the mention it answers');
	const live = xBotLive(env) && policyDryRun === false && typeof getAccessToken === 'function';

	let posted = 0;
	let dryCount = 0;
	let tail = mentionId;
	let rowReady = false;
	const dryTexts = [];
	let dryMedia = null;
	let dryLink = null;

	async function ensureRow() {
		if (rowReady) return;
		await store.recordMention({ mention, parsed, dryRun: !live });
		const row = await store.getMentionEvent(mentionId);
		if (row?.reply_tweet_id && live) throw new XAdapterError('already_replied', 'this mention already has a reply');
		rowReady = true;
	}

	function guard(chatId) {
		if (String(chatId) !== mentionId) throw new XAdapterError('wrong_target', 'the X adapter only replies to the mention it was built for');
		if (posted + dryCount >= maxPosts) throw new XAdapterError('reply_cap', `a mention gets at most ${maxPosts} reply posts`);
	}

	async function dryDeliver(text, mediaUrl = null, link = null) {
		await ensureRow();
		dryCount++;
		if (text) dryTexts.push(text);
		if (mediaUrl) dryMedia = mediaUrl;
		if (link) dryLink = link;
		await store.updateDecision(mentionId, {
			decision: 'reply',
			replyText: dryTexts.join('\n\n--- next post ---\n\n') || null,
			replyMediaUrl: dryMedia,
			replyLink: dryLink,
			dryRun: true,
		});
		return { ref: { chatId: mentionId, messageId: `dry_run:${mentionId}:${dryCount}` }, dry_run: true, posts: 1 };
	}

	async function liveDeliver(text, { mediaIds = null, mediaUrl = null, link = null } = {}) {
		await ensureRow();
		const accessToken = await getAccessToken();
		const send = post || (await defaultPost());
		const d = await send({ accessToken, text, replyTo: tail, mediaIds });
		if (!d?.id) throw new XAdapterError('post_failed', 'X accepted the reply but returned no post id');
		posted++;
		tail = String(d.id);
		await store.updateDecision(mentionId, {
			decision: 'reply',
			replyText: text || null,
			replyMediaUrl: mediaUrl,
			replyLink: link,
			replyTweetId: tail,
			dryRun: false,
		});
		return { ref: { chatId: mentionId, messageId: tail }, dry_run: false, posts: 1 };
	}

	async function sendText(chatId, text) {
		guard(chatId);
		const parts = chunkForX(text, { max: X_POST_MAX_WEIGHT, maxParts: Math.max(1, maxPosts - posted - dryCount) });
		if (!parts.length) throw new XAdapterError('empty', 'nothing to send');
		let last = null;
		for (const part of parts) {
			guard(chatId);
			last = live ? await liveDeliver(part) : await dryDeliver(part);
		}
		return { ...last, posts: parts.length };
	}

	async function sendMedia(chatId, media) {
		guard(chatId);
		const url = String(media?.url || '');
		if (!/^https:\/\//i.test(url)) throw new XAdapterError('bad_media', 'media must be an https URL');
		const caption = media.caption ? chunkForX(media.caption, { maxParts: 1 })[0] : '';
		if (!live) return dryDeliver(caption, url);
		const { buffer, mimeType } = await fetchMedia(url);
		if (!MEDIA_MIME.test(mimeType)) throw new XAdapterError('bad_media', `X cannot take ${mimeType || 'unknown'} media`);
		const accessToken = await getAccessToken();
		const upload = uploadMedia || (await defaultUpload());
		const mediaId = await upload({ accessToken, buffer, mimeType });
		return liveDeliver(caption, { mediaIds: [mediaId], mediaUrl: url });
	}

	async function sendChoice(chatId, text, choices = []) {
		const link = buttonsUrl || `${appOrigin()}/dashboard`;
		const labels = choices.map((c) => c.label).filter(Boolean).join(' / ');
		const tail2 = labels ? `\n\n${labels} on three.ws: ${link}` : `\n\nOpen on three.ws: ${link}`;
		const room = X_POST_MAX_WEIGHT - weightedLength(tail2);
		const body = fitsInPost(text, room) ? text : chunkForX(text, { max: room, maxParts: 1 })[0];
		return sendText(chatId, `${body}${tail2}`);
	}

	return {
		platform: PLATFORM,
		buttons: false,
		canEdit: false,
		live,
		sendText,
		sendChoice,
		sendMedia,
		async editMessage() {
			throw new XAdapterError('no_edit', 'X posts cannot be edited by the gateway');
		},
		async typing() {},
		async ackAction() {},
	};
}


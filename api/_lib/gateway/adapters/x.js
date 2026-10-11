// @ts-check
// The X adapter for the chat gateway core (api/_lib/gateway/core.js docblock):
// it turns one decided mention reply into the platform calls that answer it.
//
// Unlike the Telegram and Discord adapters (workers/agent-gateway/src/adapters/),
// which open one long-lived gateway and dispatch many events through it, an X
// mention is a single request/response: read one mention, decide once, answer
// once. So this adapter is a factory per mention, closed over the specific
// tweet being answered, rather than a shared gateway keyed by a chat id. There
// is no X equivalent of a chat id to route on: in_reply_to_tweet_id is always
// the mention itself (or the previous part of this same reply chain).
//
// X has no inline buttons, so sendButtons is text plus one link back to
// three.ws where the actual choice is made. typing is a no-op: X has no
// typing indicator for a reply that has not been posted yet.
//
// Dry run (x-grok design rule 3) is the default and the only mode this order
// ships: X_MENTION_BOT_LIVE must be exactly '1', and the caller may still
// force dry run underneath that (an agent's own mention-reply policy, order
// 060, once it exists) by passing `live: false` explicitly. In dry run,
// nothing reaches X: every send writes the would-be reply onto the mention's
// already-recorded x_mention_events row (x-mention-store.js) and returns a
// synthetic delivery record instead of a real tweet id.
//
// A mention must already be recorded (x-mention-store.recordMention) before
// an adapter is used to answer it; this module only ever updates that row.

import { postOne, uploadMediaV2 } from '../../x-post.js';
import { updateDecision } from '../../x-mention-store.js';
import { appOrigin } from '../format.js';
import { chunkForX, MAX_WEIGHTED_LENGTH } from '../x-text-weight.js';

export class XAdapterError extends Error {
	/** @param {string} message @param {string} code */
	constructor(message, code) {
		super(message);
		this.name = 'XAdapterError';
		this.code = code;
	}
}

/** True only when the deployment-wide switch (owner action, order 928) is on. */
export function isXMentionBotLive(env = process.env) {
	return env.X_MENTION_BOT_LIVE === '1';
}

function syntheticId(mentionId, index) {
	return `dry_run:${mentionId}:${index}`;
}

/**
 * @param {object} opts
 * @param {object} opts.mention       a normalized mention (x-mentions.js), already recorded
 * @param {string} [opts.accessToken] the resolved OAuth2 token to post with; required when live
 * @param {boolean|null} [opts.live]  overrides X_MENTION_BOT_LIVE when false (a dry-run policy); null defers to the env flag
 * @param {Record<string,string|undefined>} [opts.env]
 */
export function createXAdapter({ mention, accessToken = null, live = null, env = process.env } = {}) {
	if (!mention?.id) throw new XAdapterError('the X adapter needs the mention being replied to', 'bad_mention');
	const isLive = live != null ? !!live : isXMentionBotLive(env);
	if (isLive && !accessToken) throw new XAdapterError('live sends need an accessToken', 'no_token');

	let chainTip = String(mention.id);
	/** @type {{id:string, text:string}[]} */
	const parts = [];

	async function postPart(text, mediaIds = null) {
		if (!isLive) {
			const id = syntheticId(mention.id, parts.length);
			parts.push({ id, text });
			return { id, dryRun: true };
		}
		const posted = await postOne({ accessToken, text, replyTo: chainTip, mediaIds });
		chainTip = String(posted.id);
		parts.push({ id: chainTip, text });
		return { id: chainTip, dryRun: false };
	}

	async function recordReply(fields) {
		const row = await updateDecision(mention.id, {
			decision: 'reply',
			dryRun: !isLive,
			replyTweetId: parts[0]?.id ?? null,
			...fields,
		});
		if (!row) throw new XAdapterError(`mention ${mention.id} was never recorded; call recordMention first`, 'not_recorded');
		return row;
	}

	async function recordFailure(err) {
		try {
			await updateDecision(mention.id, { decision: 'error', dryRun: !isLive, error: String(err?.message || err).slice(0, 2000) });
		} catch {
			// The original error is the one that matters; a failed failure-record
			// (e.g. the mention truly was never recorded) must not hide it.
		}
	}

	/**
	 * Reply to the mention with `text`, threaded as at most two posts
	 * (x-text-weight.chunkForX). Returns the first reply's id (real or
	 * synthetic) and every part actually sent.
	 * @param {string} text
	 */
	async function sendText(text) {
		const chunks = chunkForX(text, MAX_WEIGHTED_LENGTH);
		if (!chunks.length) throw new XAdapterError('sendText needs non-empty text', 'empty_text');
		try {
			for (const chunk of chunks) await postPart(chunk);
			await recordReply({ replyText: chunks.join('\n\n') });
		} catch (err) {
			await recordFailure(err);
			throw err;
		}
		return { id: parts[0].id, dryRun: !isLive, parts: parts.map((p) => ({ ...p })) };
	}

	/**
	 * Reply with one attached image/video/gif and an optional caption.
	 * Live posting needs the bytes up front (`buffer`/`mimeType`): this
	 * adapter never fetches a caller-supplied URL itself, so a remote media
	 * source is never a path to an SSRF-style request on our behalf. `url`
	 * is recorded for the dry-run review console and the delivered reply.
	 * @param {{ url: string, buffer?: Buffer, mimeType?: string, caption?: string }} media
	 */
	async function sendMedia(media) {
		const caption = media?.caption ? String(media.caption).trim() : '';
		if (!media?.url) throw new XAdapterError('sendMedia needs a media url to record', 'no_media_url');
		try {
			let mediaIds = null;
			if (isLive) {
				if (!media.buffer || !media.mimeType) throw new XAdapterError('sendMedia needs buffer+mimeType to upload live', 'no_media_bytes');
				mediaIds = [await uploadMediaV2({ accessToken, buffer: media.buffer, mimeType: media.mimeType })];
			}
			const text = caption ? chunkForX(caption, MAX_WEIGHTED_LENGTH)[0] || '' : '';
			await postPart(text, mediaIds);
			await recordReply({ replyText: text || null, replyMediaUrl: media.url });
		} catch (err) {
			await recordFailure(err);
			throw err;
		}
		return { id: parts[0].id, dryRun: !isLive, parts: parts.map((p) => ({ ...p })) };
	}

	/**
	 * X has no inline buttons: render the choices as a plain list plus one
	 * link back to three.ws, where the actual action happens.
	 * @param {string} text
	 * @param {{id:string, label:string}[]} [choices]
	 * @param {{url?: string}} [opts]
	 */
	async function sendButtons(text, choices = [], opts = {}) {
		const url = opts.url || (mention.account?.kind === 'agent' ? `${appOrigin()}/agents/${mention.account.ref}` : appOrigin());
		const list = (choices || []).map((c) => `- ${c.label}`).join('\n');
		const body = [String(text || '').trim(), list, `Continue: ${url}`].filter(Boolean).join('\n\n');
		return sendText(body);
	}

	/** X has no typing indicator for an unsent reply. */
	async function typing() {}

	return { platform: 'x', dryRun: !isLive, sendText, sendMedia, sendButtons, typing };
}

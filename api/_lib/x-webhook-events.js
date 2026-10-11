// @ts-check
// Normalize one Account Activity API webhook event into the same
// platform-neutral mention shape api/_lib/x-mentions.js's normalizeMentions
// produces, so api/_lib/x-mention-intents.js and api/_lib/x-mention-store.js
// read a webhook delivery exactly as they read a polled timeline page. PURE:
// no network, no DB.
//
// The webhook payload carries the classic v1.1 Tweet object (tweet_create_events),
// not the v2 shape fetchMentions reads, so this is a second normalizer rather
// than a variant of normalizeMentions: field names differ (id_str vs id,
// user.screen_name vs username, entities.user_mentions vs entities.mentions,
// created_at as an RFC 2822 string vs ISO 8601) and v1.1 has no
// conversation_id, so a reply's conversation is approximated as the mention's
// own id, same as normalizeMentions does for a non-reply.

import { decodeXText } from './x-search.js';

function permalink(id, username) {
	return username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/status/${id}`;
}

function isoCreatedAt(value) {
	const t = value ? Date.parse(value) : NaN;
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function fullText(t) {
	return decodeXText(t?.extended_tweet?.full_text || t?.full_text || t?.text || '');
}

function authorOf(user) {
	if (!user?.id_str) return null;
	return {
		id: String(user.id_str),
		username: user.screen_name ? String(user.screen_name) : null,
		name: user.name ? decodeXText(user.name) : null,
		profileImageUrl: user.profile_image_url_https || user.profile_image_url || null,
		verified: user.verified === true,
	};
}

function mediaOf(t) {
	const entities = t?.extended_entities?.media || t?.entities?.media || [];
	const out = [];
	for (const m of Array.isArray(entities) ? entities : []) {
		if (!m) continue;
		out.push({
			key: m.id_str ? String(m.id_str) : null,
			type: m.type || null,
			url: m.type === 'photo' ? m.media_url_https || null : null,
			previewUrl: m.media_url_https || null,
			width: Number.isFinite(Number(m.sizes?.large?.w)) ? Number(m.sizes.large.w) : null,
			height: Number.isFinite(Number(m.sizes?.large?.h)) ? Number(m.sizes.large.h) : null,
			altText: m.ext_alt_text ? decodeXText(m.ext_alt_text) : null,
		});
	}
	return out;
}

/** An unresolved parent reference: the webhook payload never inlines the parent tweet. */
function unavailableRef(id, username = null) {
	if (!id) return null;
	return { id: String(id), available: false, text: null, author: null, media: [], url: permalink(id, username), conversationId: null };
}

function quotedOf(t) {
	if (t?.quoted_status?.id_str) {
		const q = t.quoted_status;
		const author = authorOf(q.user);
		return {
			id: String(q.id_str),
			available: true,
			text: fullText(q),
			author,
			media: mediaOf(q),
			url: permalink(q.id_str, author?.username),
			conversationId: null,
		};
	}
	if (t?.is_quote_status && t?.quoted_status_id_str) return unavailableRef(t.quoted_status_id_str);
	return null;
}

/**
 * @param {any} tweet            one entry of payload.tweet_create_events (v1.1 Tweet object)
 * @param {{ kind: 'company'|'agent', ref: string, userId: string, handle?: string|null }} account
 * @returns {object|null} a mention in normalizeMentions' shape, or null when the tweet has no id
 */
export function normalizeActivityEvent(tweet, account) {
	const id = tweet?.id_str || tweet?.id;
	if (!id) return null;
	const author = authorOf(tweet.user);
	const conversationId = String(id);
	const entities = tweet?.extended_tweet?.entities || tweet?.entities || {};
	return {
		platform: 'x',
		id: String(id),
		url: permalink(id, author?.username),
		text: fullText(tweet),
		lang: tweet.lang || null,
		createdAt: isoCreatedAt(tweet.created_at),
		chatId: conversationId,
		chatType: 'public',
		conversationId,
		userId: tweet.user?.id_str ? String(tweet.user.id_str) : null,
		username: author?.username || null,
		author,
		inReplyToUserId: tweet.in_reply_to_user_id_str ? String(tweet.in_reply_to_user_id_str) : null,
		repliedTo: unavailableRef(tweet.in_reply_to_status_id_str),
		quoted: quotedOf(tweet),
		isRetweet: !!tweet.retweeted_status,
		media: mediaOf(tweet),
		mentions: (entities.user_mentions || []).map((m) => ({
			username: m?.screen_name ? String(m.screen_name) : null,
			id: m?.id_str ? String(m.id_str) : null,
			start: Number.isFinite(m?.indices?.[0]) ? m.indices[0] : null,
			end: Number.isFinite(m?.indices?.[1]) ? m.indices[1] : null,
		})),
		urls: (entities.urls || []).map((u) => ({
			url: u?.url || null,
			expandedUrl: u?.expanded_url || null,
			start: Number.isFinite(u?.indices?.[0]) ? u.indices[0] : null,
			end: Number.isFinite(u?.indices?.[1]) ? u.indices[1] : null,
		})),
		account: { kind: account.kind, ref: account.ref, userId: account.userId, handle: account.handle || null },
		fromSelf: !!(tweet.user?.id_str && String(tweet.user.id_str) === String(account.userId)),
	};
}

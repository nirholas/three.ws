// Notifications delivered into paired chats: the `telegram` and `discord`
// channels of the preference center (api/_lib/notify-prefs.js). Alerts, run
// completions, received bids and incoming mail all land in the chat the owner
// already talks to their agent in, so they can reply in place.
//
// Delivery is queued, not sent: each target chat gets a {kind:'notify'} row in
// gateway_inbox and the gateway worker sends it, so platform credentials live
// in one process and every adapter the worker has gets notifications for free.
// A row older than NOTIFY_TTL_MS when the worker reaches it is dropped rather
// than delivered stale.

import { sql } from '../db.js';
import { channelEnabled, pushPayloadFor } from '../notify-prefs.js';
import { enqueueInbox } from './store.js';
import { appOrigin } from './format.js';

export const NOTIFY_TTL_MS = 60 * 60 * 1000;
export const CHAT_CHANNELS = ['telegram', 'discord'];

/** One notification as chat text: title, body, and an absolute link. */
export function notificationText(type, payload, notificationId) {
	const p = pushPayloadFor(type, payload, notificationId);
	const url = p.url?.startsWith('/') ? `${appOrigin()}${p.url}` : p.url;
	return [p.title, p.body, url].filter(Boolean).join('\n');
}

async function targetChats(userId, platforms, legacyTelegramChatId) {
	const rows = await sql`
		SELECT id, platform, chat_id FROM gateway_links
		WHERE user_id = ${userId} AND revoked_at IS NULL AND notify = true
		  AND platform = ANY(${platforms})`;
	const out = rows.map((r) => ({ linkId: r.id, platform: r.platform, chatId: r.chat_id }));
	// A chat id saved in the notification settings before the gateway existed
	// still receives Telegram notifications, unless it is also a paired chat.
	if (legacyTelegramChatId && platforms.includes('telegram') && !out.some((t) => t.platform === 'telegram' && t.chatId === String(legacyTelegramChatId))) {
		out.push({ linkId: null, platform: 'telegram', chatId: String(legacyTelegramChatId) });
	}
	return out;
}

/**
 * Queue a notification for every chat channel the owner left on for its
 * category. Returns how many chats it was queued for, per platform.
 * @returns {Promise<Record<string, number>>}
 */
export async function queueChatNotifications({ userId, type, payload, notificationId, prefs }) {
	const platforms = CHAT_CHANNELS.filter((ch) => channelEnabled(prefs, type, ch));
	const queued = {};
	if (!platforms.length) return queued;
	const targets = await targetChats(userId, platforms, prefs?.telegram_chat_id);
	const text = notificationText(type, payload, notificationId);
	const ref = notificationId || `${type}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
	for (const t of targets) {
		const inserted = await enqueueInbox({
			platform: t.platform,
			dedupeKey: `notify:${ref}:${t.linkId || t.chatId}`,
			chatKey: `${t.platform}:${t.chatId}`,
			payload: { kind: 'notify', chatId: t.chatId, linkId: t.linkId, type, text, expiresAt: new Date(Date.now() + NOTIFY_TTL_MS).toISOString() },
		});
		if (inserted) queued[t.platform] = (queued[t.platform] || 0) + 1;
	}
	return queued;
}

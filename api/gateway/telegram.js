// POST /api/gateway/telegram: the Telegram webhook for the agent chat gateway.
//
// Telegram proves each delivery with the X-Telegram-Bot-Api-Secret-Token header
// it was given at setWebhook time (api/_lib/gateway/webhooks.js derives it). A
// verified update is queued in gateway_inbox and answered 200 at once; the
// gateway worker (workers/agent-gateway) runs the turn and replies. A retried
// update_id is deduplicated by the inbox's unique key, so Telegram's redelivery
// never produces a second reply. docs/chat-gateways.md has the full flow.

import { cors, json, method, error, readJson } from '../_lib/http.js';
import { verifyTelegramSecret, telegramInboxKeys } from '../_lib/gateway/webhooks.js';
import { enqueueInbox } from '../_lib/gateway/store.js';
import { sendPlatformText } from '../_lib/gateway/bots.js';
import { claimMagicToken, MAGIC_PREFIX } from '../_lib/account-link/telegram-login.js';

// A sign-in magic link (api/auth/telegram/[action].js, action=magic) opens the
// bot with `/start tl_<token>`. That is a login, not a conversation: it is
// claimed here, inline, so the browser polling for it sees the claim within a
// second instead of after a worker turn, and it never reaches the inbox.
const MAGIC_START = new RegExp(`^/start(?:@\\w+)?\\s+(${MAGIC_PREFIX}[A-Za-z0-9_-]{32,})\\s*$`);

export function magicTokenIn(update) {
	const m = update?.message;
	if (!m || typeof m.text !== 'string' || !m.from || m.from.is_bot) return null;
	const hit = m.text.match(MAGIC_START);
	return hit ? { token: hit[1], from: m.from, chat: m.chat } : null;
}

const MAGIC_REPLIES = {
	group: 'Sign-in links only work in a private chat with me. Open the link again from your own chat.',
	expired: 'That sign-in link has expired or was already used. Go back to three.ws and start again.',
	in_use: 'This Telegram account already signs in to a different three.ws account, so it cannot be linked to this one.',
	invalid: 'That is not a sign-in link I recognise. Go back to three.ws and start again.',
};

async function claimMagic(magic) {
	const result = await claimMagicToken(magic);
	const text = result.ok
		? (result.intent === 'link'
			? 'Got it. Go back to three.ws: your Telegram account is being linked there now.'
			: 'Got it. Go back to three.ws: you are being signed in there now.')
		: MAGIC_REPLIES[result.reason] || MAGIC_REPLIES.invalid;
	await sendPlatformText('telegram', magic.chat.id, text).catch((e) => console.error('[telegram] magic reply failed', e?.message));
	return result;
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['POST'])) return;

	if (!verifyTelegramSecret(req.headers['x-telegram-bot-api-secret-token'])) {
		return error(res, 401, 'unauthorized', 'invalid webhook secret');
	}
	let update;
	try {
		update = await readJson(req, 2_000_000);
	} catch (e) {
		return error(res, e?.status || 400, 'bad_request', e?.message || 'invalid body');
	}
	const keys = telegramInboxKeys(update);
	// Updates the gateway does not handle (channel posts, member changes) are
	// acknowledged so Telegram stops redelivering them.
	if (!keys) return json(res, 200, { ok: true, ignored: true });
	const magic = magicTokenIn(update);
	if (magic) {
		const result = await claimMagic(magic);
		return json(res, 200, { ok: true, magic: result.ok ? 'claimed' : result.reason });
	}
	await enqueueInbox({ platform: 'telegram', ...keys, payload: update });
	return json(res, 200, { ok: true });
}

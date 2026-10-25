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
import { sendPlatformText, sendTelegramButtons, answerTelegramCallback } from '../_lib/gateway/bots.js';
import { requestMagicApproval, claimMagicToken, declineMagicToken, MAGIC_PREFIX } from '../_lib/account-link/telegram-login.js';

// A sign-in magic link (api/auth/telegram/[action].js, action=magic) opens the
// bot with `/start tl_<token>`. That is a login, not a conversation: it never
// reaches the inbox. The /start only parks the sender on the token and asks
// them to approve, showing where the request came from; the token is claimed
// by the Approve button press (a callback_query), inline, so the browser
// polling for it sees the claim within a second. A deep link an attacker
// minted therefore signs nobody in on a bare Start tap.
const MAGIC_START = new RegExp(`^/start(?:@\\w+)?\\s+(${MAGIC_PREFIX}[A-Za-z0-9_-]{32,})\\s*$`);
const APPROVE = 'tla:';
const DECLINE = 'tld:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function magicTokenIn(update) {
	const m = update?.message;
	if (!m || typeof m.text !== 'string' || !m.from || m.from.is_bot) return null;
	const hit = m.text.match(MAGIC_START);
	return hit ? { token: hit[1], from: m.from, chat: m.chat } : null;
}

/** An Approve or Decline press on a sign-in request, or null for any other callback. */
export function magicDecisionIn(update) {
	const q = update?.callback_query;
	if (!q || !q.from || q.from.is_bot || typeof q.data !== 'string') return null;
	const approve = q.data.startsWith(APPROVE);
	if (!approve && !q.data.startsWith(DECLINE)) return null;
	const id = q.data.slice(APPROVE.length);
	if (!UUID.test(id)) return null;
	return { approve, id, queryId: q.id, from: q.from, chat: q.message?.chat };
}

const MAGIC_REPLIES = {
	group: 'Sign-in links only work in a private chat with me. Open the link again from your own chat.',
	expired: 'That sign-in link has expired or was already used. Go back to three.ws and start again.',
	in_use: 'This Telegram account already signs in to a different three.ws account, so it cannot be linked to this one.',
	invalid: 'That is not a sign-in link I recognise. Go back to three.ws and start again.',
};

function describeRequest(request) {
	const parts = [];
	if (request?.ip) parts.push(`IP address: ${request.ip}`);
	if (request?.ua) parts.push(`Browser: ${request.ua}`);
	if (request?.at) parts.push(`Requested: ${String(request.at).replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`);
	return parts.length ? `\n\n${parts.join('\n')}` : '';
}

async function requestMagic(magic) {
	const result = await requestMagicApproval(magic);
	if (!result.ok) {
		await sendPlatformText('telegram', magic.chat.id, MAGIC_REPLIES[result.reason] || MAGIC_REPLIES.invalid)
			.catch((e) => console.error('[telegram] magic reply failed', e?.message));
		return result;
	}
	const what = result.intent === 'link' ? 'link this Telegram account to a three.ws account' : 'sign in to three.ws with this Telegram account';
	const text = `Someone asked to ${what}.${describeRequest(result.request)}\n\nApprove only if this was you, on the device above. If not, press Decline and ignore it.`;
	await sendTelegramButtons(magic.chat.id, text, [
		{ text: 'Approve', data: `${APPROVE}${result.id}` },
		{ text: 'Decline', data: `${DECLINE}${result.id}` },
	]).catch((e) => console.error('[telegram] magic approval prompt failed', e?.message));
	return result;
}

async function decideMagic(decision) {
	const { approve, id, queryId, from, chat } = decision;
	let outcome;
	let toast;
	if (approve) {
		const result = await claimMagicToken({ id, from, chat });
		outcome = result.ok ? 'claimed' : result.reason;
		toast = result.ok
			? (result.intent === 'link' ? 'Approved. Go back to three.ws: your account is being linked.' : 'Approved. Go back to three.ws: you are being signed in.')
			: MAGIC_REPLIES[result.reason] || MAGIC_REPLIES.invalid;
	} else {
		await declineMagicToken({ id, from });
		outcome = 'declined';
		toast = 'Declined. Nothing was signed in.';
	}
	await answerTelegramCallback(queryId, toast).catch((e) => console.error('[telegram] magic answer failed', e?.message));
	if (chat?.id != null) await sendPlatformText('telegram', chat.id, toast).catch((e) => console.error('[telegram] magic reply failed', e?.message));
	return outcome;
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
	const decision = magicDecisionIn(update);
	if (decision) return json(res, 200, { ok: true, magic: await decideMagic(decision) });
	const keys = telegramInboxKeys(update);
	// Updates the gateway does not handle (channel posts, member changes) are
	// acknowledged so Telegram stops redelivering them.
	if (!keys) return json(res, 200, { ok: true, ignored: true });
	const magic = magicTokenIn(update);
	if (magic) {
		const result = await requestMagic(magic);
		return json(res, 200, { ok: true, magic: result.ok ? 'awaiting_approval' : result.reason });
	}
	await enqueueInbox({ platform: 'telegram', ...keys, payload: update });
	return json(res, 200, { ok: true });
}

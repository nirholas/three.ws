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
	await enqueueInbox({ platform: 'telegram', ...keys, payload: update });
	return json(res, 200, { ok: true });
}

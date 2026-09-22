// POST /api/gateway/discord: the Discord interactions endpoint for the agent
// chat gateway (slash commands and the Approve / Cancel buttons).
//
// Discord signs every interaction with Ed25519 over timestamp + raw body; an
// unverifiable request gets 401, which is also what Discord's endpoint check
// expects. Verified commands and button presses are queued in gateway_inbox and
// deferred inside Discord's three-second window; the gateway worker completes
// them through the interaction webhook. Plain messages (DMs, mentions) arrive
// over the worker's own Discord connection, not here.

import { cors, json, method, error, readBody } from '../_lib/http.js';
import { verifyDiscordSignature, discordImmediateResponse, discordInboxKeys, DISCORD_INTERACTION } from '../_lib/gateway/webhooks.js';
import { enqueueInbox } from '../_lib/gateway/store.js';

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['POST'])) return;

	const publicKey = process.env.DISCORD_PUBLIC_KEY;
	if (!publicKey) return error(res, 503, 'not_configured', 'the Discord gateway is not configured');

	let raw;
	try {
		raw = await readBody(req, 1_000_000);
	} catch (e) {
		return error(res, e?.status || 400, 'bad_request', e?.message || 'invalid body');
	}
	const ok = verifyDiscordSignature({
		rawBody: raw,
		signature: req.headers['x-signature-ed25519'],
		timestamp: req.headers['x-signature-timestamp'],
		publicKey,
	});
	if (!ok) return error(res, 401, 'unauthorized', 'invalid request signature');

	let interaction;
	try {
		interaction = JSON.parse(raw.toString('utf8'));
	} catch {
		return error(res, 400, 'bad_request', 'invalid JSON');
	}
	const immediate = discordImmediateResponse(interaction);
	if (!immediate) return error(res, 400, 'unsupported', 'unsupported interaction type');
	if (interaction.type !== DISCORD_INTERACTION.PING) {
		const keys = discordInboxKeys(interaction);
		if (keys) await enqueueInbox({ platform: 'discord', ...keys, payload: interaction });
	}
	return json(res, 200, immediate);
}

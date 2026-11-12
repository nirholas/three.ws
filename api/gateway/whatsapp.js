// /api/gateway/whatsapp: the Meta WhatsApp Cloud API webhook for the agent chat
// gateway.
//
//   GET   Meta's subscription handshake: echo hub.challenge when
//         hub.verify_token matches WHATSAPP_VERIFY_TOKEN.
//   POST  message deliveries. Meta signs the raw body with the app secret
//         (X-Hub-Signature-256); an unsigned or mis-signed delivery gets 401.
//         Each message in the batch becomes its own gateway_inbox row keyed by
//         its wamid, so Meta's redelivery never produces a second reply; status
//         receipts are dropped. The gateway worker
//         (workers/agent-gateway src/adapters/whatsapp.js) runs the turn.
//
// docs/gateways.md has the Meta app setup and env vars.

import { cors, json, method, error, readBody, text } from '../_lib/http.js';
import { verifyWhatsAppSignature, whatsappChallenge, whatsappInboxEntries } from '../_lib/gateway/webhooks.js';
import { enqueueInbox } from '../_lib/gateway/store.js';

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'GET') {
		const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
		const challenge = whatsappChallenge(q, process.env.WHATSAPP_VERIFY_TOKEN);
		if (!challenge) return error(res, 403, 'forbidden', 'verify token mismatch');
		return text(res, 200, challenge);
	}

	const appSecret = process.env.WHATSAPP_APP_SECRET;
	if (!appSecret) return error(res, 503, 'not_configured', 'the WhatsApp gateway is not configured');
	let raw;
	try {
		raw = await readBody(req, 2_000_000);
	} catch (e) {
		return error(res, e?.status || 400, 'bad_request', e?.message || 'invalid body');
	}
	if (!verifyWhatsAppSignature({ rawBody: raw, signature: req.headers['x-hub-signature-256'], appSecret })) {
		return error(res, 401, 'unauthorized', 'invalid request signature');
	}
	let body;
	try {
		body = JSON.parse(raw.toString('utf8'));
	} catch {
		return error(res, 400, 'bad_request', 'invalid JSON');
	}
	// Only the number this deployment serves: a Meta app can own several.
	const ours = process.env.WHATSAPP_PHONE_NUMBER_ID;
	let queued = 0;
	for (const entry of whatsappInboxEntries(body)) {
		if (ours && entry.payload.phone_number_id && entry.payload.phone_number_id !== ours) continue;
		if (await enqueueInbox({ platform: 'whatsapp', ...entry })) queued += 1;
	}
	return json(res, 200, { ok: true, queued });
}

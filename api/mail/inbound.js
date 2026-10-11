// POST /api/mail/inbound: the mail provider reporting in for agent mail.
//
// One endpoint takes both kinds of provider webhook:
//   • email.received: a message arrived on the agents domain. It is stored in
//     every addressed mailbox (api/_lib/mail/inbound.js ingestReceived), which
//     also scores spam, threads it, keeps attachments, notifies the owner and
//     runs the owner's mail rules.
//   • email.delivered / bounced / complained / delayed / failed: delivery
//     status for an outbound send (applyDeliveryEvent).
//
// The signature is verified against the exact bytes received before anything
// is parsed. Replays are harmless: ingestReceived skips a provider message id
// it already stored. A genuine delivery that fails to apply answers 5xx so the
// provider retries it.

import { error, json, method, readBody, wrap } from '../_lib/http.js';
import { mailProvider, ProviderError } from '../_lib/mail/provider.js';
import { applyDeliveryEvent, ingestReceived } from '../_lib/mail/inbound.js';

const MAX_BODY_BYTES = 512 * 1024;

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;

	const provider = mailProvider();
	const raw = await readBody(req, MAX_BODY_BYTES);
	let event;
	try {
		event = await provider.verifyWebhook({ rawBody: raw, headers: req.headers || {} });
	} catch (err) {
		if (err instanceof ProviderError) return error(res, err.status || 401, err.code, err.message);
		throw err;
	}
	if (typeof event === 'string') event = JSON.parse(event);

	if (event?.type === 'email.received') {
		const result = await ingestReceived({ provider, event });
		return json(res, 200, { ok: true, type: event.type, stored: result.stored.length, reason: result.reason || null });
	}
	const result = await applyDeliveryEvent(event);
	return json(res, 200, { ok: true, type: event?.type || null, updated: result.updated });
});

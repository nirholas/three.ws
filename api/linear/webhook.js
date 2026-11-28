// POST /api/linear/webhook: the three.ws agent's Linear webhook.
//
// Every delivery carries Linear-Signature, the hex HMAC-SHA256 of the raw body
// under LINEAR_WEBHOOK_SECRET, and a webhookTimestamp; anything unsigned, forged
// or older than a minute is refused. Handled:
//
//   AgentSessionEvent created/prompted   someone mentioned or delegated to the
//                                        app, or replied in its session
//                                        (api/_lib/linear-agent.js handleSessionEvent)
//   OAuthApp revoked                     the app was removed from a workspace
//
// Linear wants an answer within five seconds; the model itself is made by
// /api/linear/forge-run. Anything else Linear sends is acknowledged and ignored.

import { json, method, error, readBody, wrap } from '../_lib/http.js';
import { verifyLinearWebhook, revokeLinearInstall } from '../_lib/linear-installs.js';
import { handleSessionEvent } from '../_lib/linear-agent.js';
import { originFromReq } from '../_mcp-studio/gpt-forge-client.js';
import { selfOrigin } from '../_lib/self-origin.js';

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;
	const secret = process.env.LINEAR_WEBHOOK_SECRET;
	if (!secret) return error(res, 503, 'not_configured', 'the Linear agent is not configured');
	let raw;
	try {
		raw = await readBody(req, 1_000_000);
	} catch (err) {
		return error(res, err?.status || 400, 'bad_request', err?.message || 'invalid body');
	}
	if (!verifyLinearWebhook({ rawBody: raw, signature: req.headers['linear-signature'], secret })) {
		return error(res, 401, 'unauthorized', 'invalid or stale webhook signature');
	}
	const payload = JSON.parse(Buffer.from(raw).toString('utf8'));

	if (payload.type === 'OAuthApp' && payload.action === 'revoked') {
		if (payload.organizationId) await revokeLinearInstall(payload.organizationId);
		return json(res, 200, { ok: true, outcome: 'revoked' });
	}
	if (payload.type === 'AgentSessionEvent') {
		const outcome = await handleSessionEvent(payload, { origin: originFromReq(req), selfBase: selfOrigin(req) });
		return json(res, 200, { ok: true, outcome });
	}
	return json(res, 200, { ok: true, outcome: 'ignored' });
});

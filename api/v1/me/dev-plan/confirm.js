// POST /api/v1/me/dev-plan/confirm: finish a wallet checkout from its signature.
//
// Body: { checkout_id, tx_signature }
// Answers { status: 'paid', receipt } once the transfer has landed, or 202
// { status: 'pending', reason } while the chain is still confirming, in which
// case the client polls. Idempotent on the signature.

import { defineEndpoint, fail } from '../../../_lib/gateway.js';
import { checkCsrf } from '../../../_lib/csrf.js';
import { json, rateLimited } from '../../../_lib/http.js';
import { limits } from '../../../_lib/rate-limit.js';
import { isUuid } from '../../../_lib/validate.js';
import { confirmDevPlanCheckout } from '../../../_lib/dev-plans/billing.js';

export default defineEndpoint({
	name: 'v1.me.dev-plan.confirm',
	method: 'POST',
	auth: 'required',
	handler: async ({ req, res, principal, body }) => {
		if (principal.source !== 'session') fail(403, 'session_required', 'plan purchases are confirmed from the dashboard with a signed-in session');
		const csrf = await checkCsrf(req, principal.userId);
		if (!csrf.ok) fail(403, csrf.code, csrf.message);
		const rl = await limits.apiKeyManage(principal.userId);
		if (!rl.success) return rateLimited(res, rl);
		if (!isUuid(body.checkout_id)) fail(400, 'bad_checkout', 'checkout_id must be a UUID');
		const out = await confirmDevPlanCheckout({ userId: principal.userId, checkoutId: body.checkout_id, txSignature: String(body.tx_signature || ''), req });
		res.setHeader('cache-control', 'private, no-store');
		if (out.status === 'pending') return json(res, 202, { data: out });
		return out;
	},
});

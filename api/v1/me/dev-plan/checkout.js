// POST /api/v1/me/dev-plan/checkout: buy an upgrade or a renewal.
//
// Body: { plan, asset: 'credits'|'USDC'|'THREE', wallet? }
//   credits: settles now; the answer carries the receipt.
//   USDC / THREE: the answer carries the unsigned Solana transfer plus the
//   recipient, amount and asset it moves; the user's wallet signs it and the
//   client then calls /confirm with the signature. The server signs nothing.
//
// Browser session only, with a CSRF token: moving money is an owner action.

import { defineEndpoint, fail } from '../../../_lib/gateway.js';
import { checkCsrf } from '../../../_lib/csrf.js';
import { limits } from '../../../_lib/rate-limit.js';
import { rateLimited } from '../../../_lib/http.js';
import { createDevPlanCheckout } from '../../../_lib/dev-plans/billing.js';
import { DEV_PLAN_PAY_ASSETS } from '../../../_lib/dev-plans/config.js';

export default defineEndpoint({
	name: 'v1.me.dev-plan.checkout',
	method: 'POST',
	auth: 'required',
	handler: async ({ req, res, principal, body }) => {
		if (principal.source !== 'session') fail(403, 'session_required', 'plan purchases are made from the dashboard with a signed-in session, never with an API key');
		const csrf = await checkCsrf(req, principal.userId);
		if (!csrf.ok) fail(403, csrf.code, csrf.message);
		const rl = await limits.apiKeyManage(principal.userId);
		if (!rl.success) return rateLimited(res, rl);
		const planId = String(body.plan || '').toLowerCase();
		const asset = String(body.asset || 'credits');
		if (!DEV_PLAN_PAY_ASSETS.includes(asset)) fail(400, 'bad_asset', `asset must be one of: ${DEV_PLAN_PAY_ASSETS.join(', ')}`);
		const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : null;
		const out = await createDevPlanCheckout({ userId: principal.userId, planId, asset, wallet, req });
		res.setHeader('cache-control', 'private, no-store');
		return out;
	},
});

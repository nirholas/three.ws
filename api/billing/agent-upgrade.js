// POST /api/billing/agent-upgrade?plan=builder|scale
//
// An agent that signed itself up (POST /api/auth/agent-signup) buys a paid
// developer plan with one x402 payment, no human and no form.
//
//   1. Call with the account's API key. Without a payment header the answer is
//      402 with the exact price (USDC on Solana) for moving this account to the
//      plan today: the full price from Free, the pro-rata difference mid-period.
//   2. Pay that requirement and repeat the call with the x402 payment header.
//      The payment settles BEFORE the handler runs (settle-then-handler), so the
//      plan is granted only against a landed transaction, and the transaction
//      signature is unique in dev_plan_receipts: the same payment never funds
//      two plan changes.
//   3. The 200 body carries the receipt and a scoped API key for the upgraded
//      account (read, generate, agents, wallet:read; it can never spend).
//
// The price differs per account and moment, and paidEndpoint prices a route
// statically, so this dispatcher authenticates first, quotes, and delegates to
// a paidEndpoint cached per (plan, price). $THREE is not offered on this route:
// its x402 amount is a fixed env value, which would sell a variable-price plan
// at a flat token price. Pay in $THREE through the dev-plan checkout instead.

import { cors, method, wrap, error, json, rateLimited } from '../_lib/http.js';
import { extractBearer, authenticateBearer, hasScope } from '../_lib/auth.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { getDevSubscription } from '../_lib/dev-plans/subscription.js';
import { quoteDevPlanChange, recordX402DevPlanPayment } from '../_lib/dev-plans/billing.js';
import { listDevPlans } from '../_lib/dev-plans/config.js';
import { usdToUsdcAtomics } from '../_lib/subscription-pricing.js';
import { mintApiKey } from '../_lib/api-keys.js';

const ROUTE = '/api/billing/agent-upgrade';
const REQUIRED_SCOPE = 'agents:write';
const UPGRADED_KEY_SCOPES = ['read', 'generate', 'agents:read', 'agents:write', 'wallet:read'];

const OUTPUT_EXAMPLE = {
	ok: true,
	plan: 'builder',
	receipt: { plan: 'builder', tx_signature: '5Vx...', amount_usd: 29 },
	credentials: { api_key: 'sk_live_...', scope: UPGRADED_KEY_SCOPES.join(' ') },
};

const BAZAAR = {
	discoverable: false,
	info: {
		input: { type: 'http', method: 'POST', bodyType: 'json', body: {} },
		output: { type: 'json', example: OUTPUT_EXAMPLE },
	},
	schema: buildBazaarSchema({
		method: 'POST',
		bodySchema: { type: 'object' },
		outputSchema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: { ok: { type: 'boolean' }, plan: { type: 'string' }, receipt: { type: 'object' }, credentials: { type: 'object' } },
		},
	}),
};

const SELF_SERVE_PLANS = listDevPlans().filter((p) => p.purchasable && !p.contactSales).map((p) => p.id);

const endpoints = new Map();

function endpointFor(plan, atomics) {
	const key = `${plan}:${atomics}`;
	let ep = endpoints.get(key);
	if (ep) return ep;
	ep = paidEndpoint({
		route: ROUTE,
		method: 'POST',
		priceAtomics: String(atomics),
		networks: ['solana'],
		acceptThree: false,
		streaming: true,
		description: `three.ws developer plan upgrade (${plan}). Pay the quoted USDC on Solana to move the calling account to the ${plan} plan and receive a scoped API key.`,
		bazaar: BAZAAR,
		resourceUrlBuilder: () => `${ROUTE}?plan=${encodeURIComponent(plan)}`,
		async handler({ req, res, requirement, payer, settled }) {
			const { userId, apiKeyId } = req.agentUpgrade;
			const receipt = await recordX402DevPlanPayment({
				userId,
				planId: plan,
				payer,
				payTo: requirement?.payTo ?? null,
				txSignature: settled?.transaction ?? req.settledTransaction ?? null,
				amountAtomics: requirement?.amount ?? requirement?.maxAmountRequired ?? null,
				req,
			});
			const { row, secret } = await mintApiKey({
				userId,
				name: `agent-upgrade-${plan}`,
				scopes: UPGRADED_KEY_SCOPES,
				req,
				via: 'agent-upgrade',
			});
			return json(res, 200, {
				ok: true,
				plan,
				receipt,
				credentials: { api_key: secret, key_id: row.id, scope: row.scope, replaces: apiKeyId ?? null },
			});
		},
	});
	endpoints.set(key, ep);
	return ep;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const bearer = await authenticateBearer(extractBearer(req), { ip: clientIp(req) });
	if (!bearer) {
		res.setHeader('www-authenticate', 'Bearer realm="three.ws"');
		return error(res, 401, 'unauthorized', 'send the account API key from /api/auth/agent-signup as a Bearer token');
	}
	if (!hasScope(bearer.scope, REQUIRED_SCOPE)) {
		return error(res, 403, 'insufficient_scope', `this key needs the ${REQUIRED_SCOPE} scope`);
	}

	const limit = await limits.agentUpgradeKey(bearer.apiKeyId || bearer.userId);
	if (!limit.success) return rateLimited(res, limit, 'too many upgrade attempts for this key');

	const plan = String(req.query?.plan || '').toLowerCase();
	if (!SELF_SERVE_PLANS.includes(plan)) {
		return error(res, 400, 'validation_error', `plan must be one of ${SELF_SERVE_PLANS.join(' or ')}`, { plans: SELF_SERVE_PLANS });
	}

	let quote;
	try {
		const sub = await getDevSubscription(bearer.userId, { fresh: true });
		quote = quoteDevPlanChange(sub, plan, 'USDC');
	} catch (err) {
		if (err?.status && err.status < 500) return error(res, err.status, err.code || 'validation_error', err.message);
		throw err;
	}

	const atomics = usdToUsdcAtomics(quote.amountUsd);
	if (atomics <= 0n) return error(res, 400, 'nothing_to_pay', 'this account already holds that plan for the whole period');

	req.agentUpgrade = { userId: bearer.userId, apiKeyId: bearer.apiKeyId ?? null };
	return endpointFor(plan, atomics)(req, res);
});

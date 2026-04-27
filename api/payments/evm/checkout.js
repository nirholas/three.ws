// POST /api/payments/evm/checkout
// Creates a payment intent for an EVM USDC subscription payment.
// Returns the recipient address, exact USDC amount, and a nonce to include in calldata.
// The frontend completes the on-chain transfer, then calls /confirm with the tx hash.

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';
import { PLANS, EVM_USDC, getEvmRecipient, INTENT_TTL_MINUTES } from '../_config.js';

const bodySchema = z.object({
	plan:     z.enum(['pro', 'team', 'enterprise']),
	chain_id: z.number().int().positive(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const { plan, chain_id } = body;

	if (!EVM_USDC[chain_id]) {
		return error(res, 400, 'unsupported_chain', `chain ${chain_id} is not supported for payments`);
	}

	const recipient = getEvmRecipient(chain_id);
	if (!recipient) {
		return error(res, 503, 'not_configured', 'payment recipient not configured for this chain');
	}

	const planConfig  = PLANS[plan];
	const amountUsdc  = planConfig.price_usd; // USD = USDC 1:1
	const nonce       = await randomToken(16);
	const expiresAt   = new Date(Date.now() + INTENT_TTL_MINUTES * 60 * 1000);

	const [intent] = await sql`
		insert into plan_payment_intents
			(user_id, plan, chain_type, chain_id, amount_usdc, recipient, nonce, expires_at)
		values
			(${user.id}, ${plan}, 'evm', ${chain_id}, ${amountUsdc}, ${recipient.toLowerCase()}, ${nonce}, ${expiresAt})
		returning id, nonce, amount_usdc, recipient, expires_at
	`;

	return json(res, 201, {
		intent_id:    intent.id,
		plan,
		chain_id,
		usdc_address: EVM_USDC[chain_id],
		recipient:    recipient,
		amount_usdc:  amountUsdc,
		// amount in smallest unit (6 decimals) for the frontend to pass to the contract
		amount_atomics: String(BigInt(Math.round(amountUsdc * 1_000_000))),
		nonce,
		expires_at:   intent.expires_at,
		instructions: `Transfer exactly ${amountUsdc} USDC to ${recipient} on chain ${chain_id}. Include nonce "${nonce}" in memo/calldata if possible, then call /api/payments/evm/confirm.`,
	});
});

// POST /api/payments/solana/checkout
// Creates a Solana Pay payment request for USDC subscription.
// Returns a Solana Pay URL (solana:<recipient>?amount=X&spl-token=USDC&memo=<nonce>)
// and raw fields for the frontend to construct a transaction manually.

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';
import { PLANS, SOLANA_USDC_MINT, getSolanaRecipient, INTENT_TTL_MINUTES } from '../_config.js';

const bodySchema = z.object({
	plan:    z.enum(['pro', 'team', 'enterprise']),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const { plan, network } = body;

	const recipient = getSolanaRecipient();
	if (!recipient) {
		return error(res, 503, 'not_configured', 'Solana payment recipient not configured');
	}

	const planConfig  = PLANS[plan];
	const amountUsdc  = planConfig.price_usd;
	const nonce       = await randomToken(16);
	const expiresAt   = new Date(Date.now() + INTENT_TTL_MINUTES * 60 * 1000);
	const usdcMint    = network === 'devnet'
		? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
		: SOLANA_USDC_MINT;

	const [intent] = await sql`
		insert into plan_payment_intents
			(user_id, plan, chain_type, amount_usdc, recipient, nonce, memo, expires_at)
		values
			(${user.id}, ${plan}, 'solana', ${amountUsdc}, ${recipient}, ${nonce}, ${nonce}, ${expiresAt})
		returning id, nonce, amount_usdc, recipient, expires_at
	`;

	// Build Solana Pay URL per spec:
	// solana:<recipient>?amount=<usdc>&spl-token=<mint>&memo=<nonce>&label=three.ws&message=<plan>
	const solanaPay = new URL(`solana:${recipient}`);
	solanaPay.searchParams.set('amount',    String(amountUsdc));
	solanaPay.searchParams.set('spl-token', usdcMint);
	solanaPay.searchParams.set('memo',      nonce);
	solanaPay.searchParams.set('label',     'three.ws');
	solanaPay.searchParams.set('message',   `${planConfig.label} plan subscription`);

	return json(res, 201, {
		intent_id:    intent.id,
		plan,
		network,
		solana_pay_url: solanaPay.toString(),
		recipient,
		usdc_mint:    usdcMint,
		amount_usdc:  amountUsdc,
		nonce,
		expires_at:   intent.expires_at,
	});
});

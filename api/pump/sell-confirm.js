// POST /api/pump/sell-confirm
// Verify a sell tx (built via /api/pump/sell-prep) and persist to pump_agent_trades.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { verifySignature } from '../_lib/pump.js';

const bodySchema = z.object({
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	tx_signature: z.string().min(80).max(100),
	wallet_address: z.string().min(32).max(44),
	tokens: z.string().regex(/^\d+$/),
	route: z.enum(['bonding_curve', 'amm']),
	slippage_bps: z.number().int().min(0).max(5000).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	const [mintRow] = await sql`
		select id from pump_agent_mints where mint=${body.mint} and network=${body.network} limit 1
	`;
	const mintId = mintRow?.id ?? null;

	let tx;
	try {
		tx = await verifySignature({ network: body.network, signature: body.tx_signature });
	} catch (e) {
		return error(res, e.status || 422, e.code || 'tx_failed', e.message);
	}
	const accountKeys = tx.transaction.message.accountKeys.map((k) => (k.pubkey || k).toString());
	if (!accountKeys.includes(body.mint))
		return error(res, 422, 'mint_not_in_tx', 'mint not in tx');
	if (!accountKeys.includes(body.wallet_address))
		return error(res, 422, 'wallet_not_in_tx', 'wallet not in tx');

	if (mintId) {
		await sql`
			insert into pump_agent_trades
				(mint_id, user_id, wallet, direction, route, token_amount, slippage_bps, tx_signature, network)
			values
				(${mintId}, ${user.id}, ${body.wallet_address}, 'sell', ${body.route},
				 ${body.tokens}, ${body.slippage_bps ?? null}, ${body.tx_signature}, ${body.network})
			on conflict (tx_signature, network) do nothing
		`;
	}

	return json(res, 200, {
		ok: true,
		tracked: !!mintId,
		mint: body.mint,
		network: body.network,
		tx_signature: body.tx_signature,
	});
});

// POST /api/pump/withdraw-prep
// Builds an unsigned `withdraw` ix the agent owner signs to sweep withdrawVault.

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import {
	getPumpAgentOffline,
	buildUnsignedTxBase64,
	solanaPubkey,
} from '../_lib/pump.js';
import { SOLANA_USDC_MINT, SOLANA_USDC_MINT_DEVNET } from '../payments/_config.js';

const bodySchema = z.object({
	mint: z.string().min(32).max(44),
	authority_wallet: z.string().min(32).max(44),
	receiver_ata: z.string().min(32).max(44),
	currency_mint: z.string().min(32).max(44).optional(),
	currency_token_program: z.string().min(32).max(44).optional(),
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
	const authority = solanaPubkey(body.authority_wallet);
	const receiverAta = solanaPubkey(body.receiver_ata);
	if (!authority || !receiverAta)
		return error(res, 400, 'validation_error', 'invalid pubkeys');

	const [row] = await sql`
		select m.id, m.mint, m.user_id, m.agent_authority, m.network from pump_agent_mints m
		where m.mint=${body.mint} and m.network=${body.network} limit 1
	`;
	if (!row) return error(res, 404, 'not_found', 'agent mint not registered');
	if (row.user_id !== user.id) return error(res, 403, 'forbidden', 'not your agent');
	if (row.agent_authority && row.agent_authority !== body.authority_wallet) {
		return error(res, 403, 'forbidden', 'authority does not match');
	}

	const currencyStr =
		body.currency_mint ||
		(body.network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT);
	const currency = solanaPubkey(currencyStr);
	if (!currency) return error(res, 400, 'validation_error', 'invalid currency_mint');

	const { offline } = await getPumpAgentOffline({
		network: body.network,
		mint: body.mint,
	});

	const tokenProgram = body.currency_token_program
		? solanaPubkey(body.currency_token_program)
		: undefined;

	const ix = await offline.withdraw({
		authority,
		currencyMint: currency,
		receiverAta,
		...(tokenProgram ? { tokenProgram } : {}),
	});

	const txBase64 = await buildUnsignedTxBase64({
		network: body.network,
		payer: authority,
		instructions: [ix],
	});

	return json(res, 201, {
		mint: body.mint,
		network: body.network,
		currency_mint: currencyStr,
		tx_base64: txBase64,
	});
});

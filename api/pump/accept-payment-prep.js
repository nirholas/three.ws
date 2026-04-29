// POST /api/pump/accept-payment-prep
//
// Builds the unsigned tx for `acceptPayment` against an agent's
// pump-agent-payments PDA. Caller (the payer) signs + submits. Used as the
// pump-native settle step for X402-gated resources (see /.well-known/x402).

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { randomToken } from '../_lib/crypto.js';
import {
	getPumpAgentOffline,
	buildUnsignedTxBase64,
	solanaPubkey,
} from '../_lib/pump.js';
import {
	SOLANA_USDC_MINT,
	SOLANA_USDC_MINT_DEVNET,
	toUsdcAtomics,
} from '../payments/_config.js';

const bodySchema = z.object({
	mint: z.string().min(32).max(44), // pump.fun token mint = agent token
	payer_wallet: z.string().min(32).max(44),
	amount_usdc: z.number().positive().max(100_000),
	currency_mint: z.string().min(32).max(44).optional(), // defaults to USDC
	currency_token_program: z.string().min(32).max(44).optional(),
	user_token_account: z.string().min(32).max(44),         // payer ATA
	skill_id: z.string().max(100).optional(),
	tool_name: z.string().max(100).optional(),
	duration_seconds: z.number().int().positive().max(60 * 60 * 24 * 365).default(60),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

function bnFromBigint(BN, v) {
	return new BN(v.toString());
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Allow both session users (browser) and bearer (MCP / agent) callers.
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer)
		return error(res, 401, 'unauthorized', 'sign in or supply a bearer token');
	const userId = session?.id ?? bearer?.userId ?? null;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const payer = solanaPubkey(body.payer_wallet);
	const userAta = solanaPubkey(body.user_token_account);
	if (!payer) return error(res, 400, 'validation_error', 'invalid payer_wallet');
	if (!userAta) return error(res, 400, 'validation_error', 'invalid user_token_account');

	const [agent] = await sql`
		select id, mint, network, buyback_bps from pump_agent_mints
		where mint=${body.mint} and network=${body.network} limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent mint not registered');

	const currencyStr =
		body.currency_mint ||
		(body.network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT);
	const currency = solanaPubkey(currencyStr);
	if (!currency) return error(res, 400, 'validation_error', 'invalid currency_mint');

	const { offline, BN } = await getPumpAgentOffline({
		network: body.network,
		mint: body.mint,
	});

	// Invoice ID = random 64-bit unsigned (memo BN). Used as the PDA seed and
	// as the X402 receipt identifier downstream.
	const invoiceIdHex = (await randomToken(8)).slice(0, 16);
	const invoiceId = new BN(invoiceIdHex, 16);

	const startTime = Math.floor(Date.now() / 1000);
	const endTime = startTime + body.duration_seconds;

	const amountAtomics = toUsdcAtomics(body.amount_usdc); // bigint, USDC = 6 dp

	const tokenProgram = body.currency_token_program
		? solanaPubkey(body.currency_token_program)
		: undefined;

	const ix = await offline.acceptPayment({
		user: payer,
		userTokenAccount: userAta,
		currencyMint: currency,
		amount: bnFromBigint(BN, amountAtomics),
		memo: invoiceId,
		startTime: new BN(startTime),
		endTime: new BN(endTime),
		...(tokenProgram ? { tokenProgram } : {}),
	});

	const txBase64 = await buildUnsignedTxBase64({
		network: body.network,
		payer,
		instructions: [ix],
	});

	const [row] = await sql`
		insert into pump_agent_payments
			(mint_id, user_id, payer_wallet, currency_mint, amount_atomics,
			 invoice_id, start_time, end_time, status, skill_id, tool_name)
		values
			(${agent.id}, ${userId}, ${body.payer_wallet}, ${currencyStr},
			 ${amountAtomics.toString()}, ${invoiceId.toString()},
			 to_timestamp(${startTime}), to_timestamp(${endTime}),
			 'pending', ${body.skill_id || null}, ${body.tool_name || null})
		returning id, invoice_id, start_time, end_time, status
	`;

	return json(res, 201, {
		payment_id: row.id,
		mint: body.mint,
		invoice_id: invoiceId.toString(),
		amount_usdc: body.amount_usdc,
		amount_atomics: amountAtomics.toString(),
		currency_mint: currencyStr,
		start_time: row.start_time,
		end_time: row.end_time,
		network: body.network,
		tx_base64: txBase64,
		instructions:
			'Decode tx_base64, sign with payer wallet, submit, then call /api/pump/accept-payment-confirm with the tx_signature and payment_id.',
	});
});

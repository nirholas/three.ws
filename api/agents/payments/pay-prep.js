/**
 * POST /api/agents/payments/pay-prep
 *
 * Build an unsigned `agent_accept_payment` transaction for any signed-in user
 * to pay an agent. Caller signs with their own Solana wallet.
 *
 * Body:
 *   { agent_id, currency_mint, amount, memo?, wallet_address, cluster? }
 *
 *   - amount      raw token units as a numeric string (caller does decimals)
 *   - currency_mint mint of the token used to pay (e.g. USDC)
 *   - memo        optional u64-castable string (Pump.fun uses memo as the
 *                 invoice id seed; we synthesize one if not provided)
 */

import { z } from 'zod';
import {
	Connection,
	PublicKey,
	Transaction,
	ComputeBudgetProgram,
} from '@solana/web3.js';
import { PumpAgent } from '@pump-fun/agent-payments-sdk';
import BN from 'bn.js';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';

const bodySchema = z.object({
	agent_id: z.string().min(1).max(80),
	currency_mint: z.string().min(32).max(44),
	amount: z.string().regex(/^\d+$/),
	memo: z.string().regex(/^\d+$/).optional(),
	wallet_address: z.string().min(32).max(44),
	cluster: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

function rpcUrl(cluster) {
	return cluster === 'devnet'
		? process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
		: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	const [agent] = await sql`
		select id, name, meta from agent_identities
		where id = ${body.agent_id} and deleted_at is null limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (!agent.meta?.payments?.configured) {
		return error(res, 409, 'precondition_failed', 'agent has not enabled payments');
	}
	const tokenMint = agent.meta.payments.mint;

	const conn = new Connection(rpcUrl(body.cluster), 'confirmed');
	const pumpAgent = new PumpAgent(
		new PublicKey(tokenMint),
		body.cluster === 'devnet' ? 'devnet' : 'mainnet',
		conn,
	);

	const memo = body.memo || String(Math.floor(Date.now() / 1000));
	const startTime = Math.floor(Date.now() / 1000);
	const endTime = startTime + 60 * 60 * 24; // 24h validity window for the invoice

	const ixs = await pumpAgent.buildAcceptPaymentInstructions({
		user: new PublicKey(body.wallet_address),
		currencyMint: new PublicKey(body.currency_mint),
		amount: new BN(body.amount),
		memo: new BN(memo),
		startTime: new BN(startTime),
		endTime: new BN(endTime),
	});

	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	const tx = new Transaction({
		feePayer: new PublicKey(body.wallet_address),
		blockhash,
		lastValidBlockHeight,
	}).add(
		ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
		...ixs,
	);

	const txBase64 = tx
		.serialize({ requireAllSignatures: false, verifySignatures: false })
		.toString('base64');

	const intentId = await randomToken(24);
	const expiresAt = new Date(endTime * 1000);

	await sql`
		insert into agent_payment_intents
			(id, payer_user_id, agent_id, currency_mint, amount, memo, start_time, end_time,
			 status, cluster, payload, expires_at)
		values (
			${intentId}, ${user.id}, ${agent.id}, ${body.currency_mint}, ${body.amount},
			${memo}, ${new Date(startTime * 1000)}, ${new Date(endTime * 1000)},
			'pending', ${body.cluster},
			${JSON.stringify({
				wallet_address: body.wallet_address,
				token_mint: tokenMint,
			})}::jsonb,
			${expiresAt}
		)
	`;

	return json(res, 201, {
		intent_id: intentId,
		tx_base64: txBase64,
		memo,
		start_time: startTime,
		end_time: endTime,
		expires_at: expiresAt.toISOString(),
	});
});

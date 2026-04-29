/**
 * POST /api/agents/payments/pay-confirm
 *
 * Verify the user paid via PumpAgentPayments. Marks the intent as paid and
 * surfaces a credit row the runtime can consume.
 *
 * The PumpAgent SDK exposes `validateInvoicePayment` which checks the on-chain
 * receipt by event log + invoice PDA. We call it for canonical verification.
 */

import { z } from 'zod';
import { Connection, PublicKey } from '@solana/web3.js';
import { PumpAgent } from '@pump-fun/agent-payments-sdk';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';

const bodySchema = z.object({
	intent_id: z.string().min(8).max(80),
	tx_signature: z.string().min(40).max(120),
	wallet_address: z.string().min(32).max(44),
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

	const [intent] = await sql`
		select id, payer_user_id, agent_id, currency_mint, amount, memo,
		       extract(epoch from start_time)::bigint as start_time,
		       extract(epoch from end_time)::bigint   as end_time,
		       status, cluster, payload
		from agent_payment_intents
		where id = ${body.intent_id} and payer_user_id = ${user.id} limit 1
	`;
	if (!intent) return error(res, 404, 'not_found', 'intent not found');
	if (intent.status === 'paid') return json(res, 200, { ok: true, intent_id: intent.id, status: 'paid' });
	if (intent.payload?.wallet_address !== body.wallet_address) {
		return error(res, 400, 'validation_error', 'wallet mismatch');
	}

	const conn = new Connection(rpcUrl(intent.cluster), 'confirmed');
	const pumpAgent = new PumpAgent(
		new PublicKey(intent.payload.token_mint),
		intent.cluster === 'devnet' ? 'devnet' : 'mainnet',
		conn,
	);

	// Wait briefly for the tx to land before SDK lookup.
	const deadline = Date.now() + 30_000;
	let tx;
	while (Date.now() < deadline) {
		tx = await conn.getParsedTransaction(body.tx_signature, {
			maxSupportedTransactionVersion: 0,
			commitment: 'confirmed',
		});
		if (tx) break;
		await new Promise((r) => setTimeout(r, 1500));
	}
	if (!tx) return error(res, 422, 'tx_not_found', 'tx not found');
	if (tx.meta?.err) return error(res, 422, 'tx_failed', 'tx failed on-chain');

	const ok = await pumpAgent.validateInvoicePayment({
		user: new PublicKey(body.wallet_address),
		currencyMint: new PublicKey(intent.currency_mint),
		amount: Number(intent.amount),
		memo: Number(intent.memo),
		startTime: Number(intent.start_time),
		endTime: Number(intent.end_time),
	});
	if (!ok) {
		return error(res, 422, 'invoice_not_found', 'on-chain invoice not found for this intent');
	}

	const [updated] = await sql`
		update agent_payment_intents
		set status = 'paid', tx_signature = ${body.tx_signature}, paid_at = now()
		where id = ${intent.id}
		returning id, agent_id, amount, currency_mint, paid_at
	`;

	return json(res, 200, { ok: true, intent: updated });
});

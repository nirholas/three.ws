/**
 * POST /api/agents/payments/create-confirm
 *
 * Verify the PumpAgentPayments create tx landed and write meta.payments on
 * the agent so the UI can flip into "Pay agent" mode.
 */

import { z } from 'zod';
import { Connection, PublicKey } from '@solana/web3.js';
import { getTokenAgentPaymentsPDA } from '@pump-fun/agent-payments-sdk';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';

const bodySchema = z.object({
	prep_id: z.string().min(8).max(80),
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

	const [prep] = await sql`
		select id, agent_id, mint, cluster, payload
		from payment_configs_pending
		where id = ${body.prep_id} and user_id = ${user.id} and expires_at > now()
		limit 1
	`;
	if (!prep) return error(res, 404, 'not_found', 'prep expired or not found');
	if (prep.payload?.wallet_address !== body.wallet_address) {
		return error(res, 400, 'validation_error', 'wallet mismatch with prep');
	}

	const conn = new Connection(rpcUrl(prep.cluster), 'confirmed');
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
	if (!tx) return error(res, 422, 'tx_not_found', 'tx not found on Solana RPC');
	if (tx.meta?.err) return error(res, 422, 'tx_failed', 'tx failed on-chain');

	const accounts = tx.transaction.message.accountKeys.map((k) => k.pubkey?.toString());
	const [pda] = getTokenAgentPaymentsPDA(new PublicKey(prep.mint));
	if (!accounts.includes(pda.toString())) {
		return error(res, 422, 'pda_not_in_tx', 'expected agent payments PDA not in tx');
	}
	if (!accounts.includes(body.wallet_address)) {
		return error(res, 422, 'wrong_signer', 'wallet not in tx signers');
	}

	const [agent] = await sql`
		select id, meta from agent_identities
		where id = ${prep.agent_id} and user_id = ${user.id} and deleted_at is null
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const payments = {
		configured: true,
		provider: 'pumpfun',
		mint: prep.mint,
		token_agent_pda: pda.toString(),
		receiver: body.wallet_address,
		cluster: prep.cluster,
		tx_signature: body.tx_signature,
		configured_at: new Date().toISOString(),
		accepted_tokens: [], // reserved — populate via updateBuybackBps later
	};

	const mergedMeta = { ...(agent.meta || {}), payments };
	const [updated] = await sql`
		update agent_identities
		set meta = ${JSON.stringify(mergedMeta)}::jsonb,
		    updated_at = now()
		where id = ${agent.id}
		returning id, name, meta
	`;
	await sql`delete from payment_configs_pending where id = ${prep.id}`;

	return json(res, 201, { ok: true, agent: updated, payments });
});

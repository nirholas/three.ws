/**
 * POST /api/agents/payments/create-prep
 *
 * Build the unsigned PumpAgentPayments `create` transaction that registers
 * an agent's launched token to accept payments. Owner-only. Pre-conditions:
 *   • Agent must already have meta.token.mint set (Pump.fun token launched).
 *   • Caller must own the agent and the wallet they're using.
 *
 * Returns a base64 partially-built tx the user signs in their wallet. The
 * confirm endpoint persists `meta.payments` once the tx lands on-chain.
 */

import { z } from 'zod';
import {
	Connection,
	PublicKey,
	Transaction,
	ComputeBudgetProgram,
} from '@solana/web3.js';
import { PumpAgentOffline, PUMP_AGENT_PAYMENTS_PROGRAM_ID } from '@pump-fun/agent-payments-sdk';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';

const bodySchema = z.object({
	agent_id: z.string().min(1).max(80),
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
		select id, user_id, meta
		from agent_identities
		where id = ${body.agent_id} and user_id = ${user.id} and deleted_at is null
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const tokenMint = agent.meta?.token?.mint;
	if (!tokenMint) {
		return error(res, 409, 'precondition_failed', 'agent has no launched token yet');
	}
	if (agent.meta?.payments?.configured) {
		return error(res, 409, 'conflict', 'payments already configured for this agent');
	}
	if (agent.meta?.onchain?.wallet !== body.wallet_address) {
		return error(res, 403, 'forbidden', 'wallet does not match agent owner');
	}

	const conn = new Connection(rpcUrl(body.cluster), 'confirmed');
	const mint = new PublicKey(tokenMint);
	const owner = new PublicKey(body.wallet_address);
	const offline = PumpAgentOffline.load(mint, conn);

	// `create` registers the TokenAgentPayments PDA. Authority defaults to the
	// caller (owner). Buyback bps + sharing config can be configured later via
	// updateBuybackBps; for the initial config we accept defaults so a single
	// click enables payments.
	const createIx = await offline.create({
		user: owner,
		authority: owner,
	});

	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(
		ComputeBudgetProgram.setComputeUnitLimit({
			units: PumpAgentOffline.DEFAULT_COMPUTE_UNIT_LIMIT_FOR_AGENT_PAYMENTS,
		}),
		ComputeBudgetProgram.setComputeUnitPrice({
			microLamports: PumpAgentOffline.DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS,
		}),
		createIx,
	);

	const txBase64 = tx
		.serialize({ requireAllSignatures: false, verifySignatures: false })
		.toString('base64');

	const prepId = await randomToken(24);
	const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

	await sql`
		insert into payment_configs_pending
			(id, user_id, agent_id, cluster, mint, payload, expires_at)
		values (
			${prepId},
			${user.id},
			${agent.id},
			${body.cluster},
			${tokenMint},
			${JSON.stringify({
				wallet_address: body.wallet_address,
				program_id: PUMP_AGENT_PAYMENTS_PROGRAM_ID.toString(),
			})}::jsonb,
			${expiresAt}
		)
		on conflict (id) do nothing
	`;

	return json(res, 201, {
		prep_id: prepId,
		mint: tokenMint,
		tx_base64: txBase64,
		cluster: body.cluster,
		expires_at: expiresAt.toISOString(),
	});
});

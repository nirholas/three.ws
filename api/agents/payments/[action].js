/**
 * Agent Payments Dispatcher
 * -------------------------
 * POST /api/agents/payments/create-prep
 * POST /api/agents/payments/create-confirm
 * POST /api/agents/payments/pay-prep
 * POST /api/agents/payments/pay-confirm
 *
 * Single Vercel function that dispatches on req.query.action (auto-populated
 * from the [action] filename). Consolidated to reduce function count and
 * avoid bundling heavy Solana/Anchor SDKs four times.
 */

import { z } from 'zod';
import {
	Connection,
	PublicKey,
	Transaction,
	ComputeBudgetProgram,
} from '@solana/web3.js';
import {
	PumpAgentOffline,
	PumpAgent,
	PUMP_AGENT_PAYMENTS_PROGRAM_ID,
	getTokenAgentPaymentsPDA,
} from '@pump-fun/agent-payments-sdk';
import BN from 'bn.js';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { randomToken } from '../../_lib/crypto.js';

function rpcUrl(cluster) {
	return cluster === 'devnet'
		? process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
		: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

export default wrap(async (req, res) => {
	const action = req.query?.action;
	switch (action) {
		case 'create-prep':
			return handleCreatePrep(req, res);
		case 'create-confirm':
			return handleCreateConfirm(req, res);
		case 'pay-prep':
			return handlePayPrep(req, res);
		case 'pay-confirm':
			return handlePayConfirm(req, res);
		default:
			return error(res, 404, 'not_found', 'unknown payments action');
	}
});

// ── create-prep ──────────────────────────────────────────────────────────────

const createPrepSchema = z.object({
	agent_id: z.string().min(1).max(80),
	wallet_address: z.string().min(32).max(44),
	cluster: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handleCreatePrep(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(createPrepSchema, await readJson(req));

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
}

// ── create-confirm ───────────────────────────────────────────────────────────

const createConfirmSchema = z.object({
	prep_id: z.string().min(8).max(80),
	tx_signature: z.string().min(40).max(120),
	wallet_address: z.string().min(32).max(44),
});

async function handleCreateConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(createConfirmSchema, await readJson(req));

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
}

// ── pay-prep ─────────────────────────────────────────────────────────────────

const payPrepSchema = z.object({
	agent_id: z.string().min(1).max(80),
	currency_mint: z.string().min(32).max(44),
	amount: z.string().regex(/^\d+$/),
	memo: z.string().regex(/^\d+$/).optional(),
	wallet_address: z.string().min(32).max(44),
	cluster: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handlePayPrep(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(payPrepSchema, await readJson(req));

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
}

// ── pay-confirm ──────────────────────────────────────────────────────────────

const payConfirmSchema = z.object({
	intent_id: z.string().min(8).max(80),
	tx_signature: z.string().min(40).max(120),
	wallet_address: z.string().min(32).max(44),
});

async function handlePayConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(payConfirmSchema, await readJson(req));

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
}

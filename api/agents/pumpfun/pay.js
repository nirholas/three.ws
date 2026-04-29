// POST /api/agents/:id/pumpfun/pay
// Wraps @pump-fun/agent-payments-sdk.
//
// Body: { action, tokenMint, currencyMint, ...params, network? }
//   action='accept' — pay an agent token (the agent IS the user paying);
//     params: amount (string raw units), memo, startTime, endTime
//   action='withdraw' — agent withdraws collected payments for the token
//     it is the agent-authority of; params: receiverAta
//   action='balances' — read-only; returns vault balances for currencyMint
//
// Server signs with the agent's wallet.

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { loadAgentForSigning, solanaConnection } from '../../_lib/agent-pumpfun.js';
import { PublicKey, Transaction } from '@solana/web3.js';
import { z } from 'zod';

const bodySchema = z.object({
	action: z.enum(['accept', 'withdraw', 'balances']),
	tokenMint: z.string().min(32).max(64),
	currencyMint: z.string().min(32).max(64),
	amount: z.string().regex(/^\d+$/).optional(),
	memo: z.string().regex(/^\d+$/).optional(),
	startTime: z.number().int().nonnegative().optional(),
	endTime: z.number().int().nonnegative().optional(),
	receiverAta: z.string().min(32).max(64).optional(),
	userTokenAccount: z.string().min(32).max(64).optional(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default async function handler(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = bodySchema.parse(await readJson(req));
	} catch (e) {
		return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
	}

	const loaded = await loadAgentForSigning(id, auth.userId);
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair } = loaded;

	const conn = solanaConnection(body.network);
	const tokenMint = new PublicKey(body.tokenMint);
	const currencyMint = new PublicKey(body.currencyMint);
	const { PumpAgent } = await import('@pump-fun/agent-payments-sdk');
	const agent = new PumpAgent(tokenMint, body.network, conn);

	if (body.action === 'balances') {
		const balances = await agent.getBalances(currencyMint);
		return json(res, 200, {
			data: {
				balances: Object.fromEntries(
					Object.entries(balances).map(([k, v]) => [
						k,
						v && typeof v === 'object'
							? { ...v, balance: v.balance?.toString?.() ?? String(v.balance) }
							: v,
					]),
				),
			},
		});
	}

	let instructions;
	if (body.action === 'accept') {
		if (!body.userTokenAccount || !body.amount || !body.memo || body.startTime == null || body.endTime == null)
			return error(res, 400, 'validation_error', 'accept requires userTokenAccount, amount, memo, startTime, endTime');
		instructions = await agent.buildAcceptPaymentInstructions({
			user: keypair.publicKey,
			currencyMint,
			amount: body.amount,
			memo: body.memo,
			startTime: body.startTime,
			endTime: body.endTime,
		});
	} else {
		if (!body.receiverAta) return error(res, 400, 'validation_error', 'withdraw requires receiverAta');
		const ix = await agent.withdraw({
			authority: keypair.publicKey,
			currencyMint,
			receiverAta: new PublicKey(body.receiverAta),
		});
		instructions = [ix];
	}

	const tx = new Transaction().add(...instructions);
	tx.feePayer = keypair.publicKey;
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.sign(keypair);

	let signature;
	try {
		signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		console.error('[pumpfun/pay] send failed', err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	return json(res, 200, {
		data: {
			signature,
			action: body.action,
			tokenMint: body.tokenMint,
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
		},
	});
}

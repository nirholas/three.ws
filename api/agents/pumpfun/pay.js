// POST /api/agents/:id/pumpfun/pay
//
// Full @pump-fun/agent-payments-sdk surface, signed by the agent's wallet.
//
// Body: { action, tokenMint, currencyMint, ...params, network? }
//
// Actions (all return { signature, action, ... } except `balances`):
//   create            — register the agent's wallet as authority for tokenMint.
//                       Requires: buybackBps (0–10_000).
//                       The agent must already be the bonding-curve creator
//                       of `tokenMint`; otherwise the program rejects.
//   accept            — agent pays the token's payment vault for an invoice.
//                       Requires: amount (raw units, string), memo (string),
//                       startTime, endTime (unix seconds).
//   withdraw          — agent withdraws collected payments for tokenMint.
//                       Requires: receiverAta. The ATA must already exist;
//                       create it client-side or via /accept-payment first.
//   distribute        — permissionless distribution from payment vault to the
//                       buyback + withdraw vaults. Anyone can call.
//   extend_account    — pay rent to extend a program account.
//                       Requires: account.
//   update_authority  — rotate the agent authority. Requires: newAuthority.
//   update_buyback    — change buyback bps. Requires: buybackBps.
//   balances          — read-only; returns vault balances for currencyMint.
//
// Spend-policy is enforced on `accept` (it spends agent SOL/SPL).

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { loadAgentForSigning, solanaConnection } from '../../_lib/agent-pumpfun.js';
import { sql } from '../../_lib/db.js';
import { PublicKey, Transaction } from '@solana/web3.js';
import { z } from 'zod';

const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

const bodySchema = z.object({
	action: z.enum([
		'create',
		'accept',
		'withdraw',
		'distribute',
		'extend_account',
		'update_authority',
		'update_buyback',
		'balances',
	]),
	tokenMint: z.string().min(32).max(64),
	currencyMint: z.string().min(32).max(64).default(NATIVE_SOL_MINT),
	amount: z.string().regex(/^\d+$/).optional(),
	memo: z.string().regex(/^\d+$/).optional(),
	startTime: z.number().int().nonnegative().optional(),
	endTime: z.number().int().nonnegative().optional(),
	receiverAta: z.string().min(32).max(64).optional(),
	userTokenAccount: z.string().min(32).max(64).optional(),
	account: z.string().min(32).max(64).optional(),
	newAuthority: z.string().min(32).max(64).optional(),
	buybackBps: z.number().int().min(0).max(10_000).optional(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

function need(body, ...fields) {
	const missing = fields.filter((f) => body[f] == null || body[f] === '');
	if (missing.length)
		return { status: 400, code: 'validation_error', msg: `missing: ${missing.join(', ')}` };
	return null;
}

function explorerUrl(sig, network) {
	return `https://solscan.io/tx/${sig}${network === 'devnet' ? '?cluster=devnet' : ''}`;
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

	const loaded = await loadAgentForSigning(id, auth.userId, {
		reason: `pumpfun.pay.${body.action}`,
		meta: { tokenMint: body.tokenMint, network: body.network },
	});
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair } = loaded;

	const conn = solanaConnection(body.network);
	const tokenMint = new PublicKey(body.tokenMint);
	const currencyMint = new PublicKey(body.currencyMint);
	const { PumpAgent } = await import('@pump-fun/agent-payments-sdk');
	const agent = new PumpAgent(tokenMint, body.network, conn);

	// ── Read-only ──────────────────────────────────────────────────────────
	if (body.action === 'balances') {
		try {
			const balances = await agent.getBalances(currencyMint);
			return json(res, 200, {
				data: {
					tokenMint: body.tokenMint,
					currencyMint: body.currencyMint,
					balances: {
						paymentVault: {
							address: balances.paymentVault.address.toBase58(),
							balance: balances.paymentVault.balance.toString(),
						},
						buybackVault: {
							address: balances.buybackVault.address.toBase58(),
							balance: balances.buybackVault.balance.toString(),
						},
						withdrawVault: {
							address: balances.withdrawVault.address.toBase58(),
							balance: balances.withdrawVault.balance.toString(),
						},
					},
				},
			});
		} catch (err) {
			console.error('[pumpfun/pay] balances failed', err);
			return error(res, 502, 'rpc_error', err.message || 'balance fetch failed');
		}
	}

	// ── Build instructions per action ──────────────────────────────────────
	let instructions;
	let extra = {};
	try {
		switch (body.action) {
			case 'create': {
				const miss = need(body, 'buybackBps');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.create({
					authority: keypair.publicKey,
					mint: tokenMint,
					agentAuthority: keypair.publicKey,
					buybackBps: body.buybackBps,
				});
				instructions = [ix];
				extra = { buybackBps: body.buybackBps };
				break;
			}
			case 'accept': {
				const miss = need(body, 'amount', 'memo', 'startTime', 'endTime');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				instructions = await agent.buildAcceptPaymentInstructions({
					user: keypair.publicKey,
					currencyMint,
					amount: body.amount,
					memo: body.memo,
					startTime: body.startTime,
					endTime: body.endTime,
				});
				extra = {
					amount: body.amount,
					memo: body.memo,
					startTime: body.startTime,
					endTime: body.endTime,
				};
				break;
			}
			case 'withdraw': {
				const miss = need(body, 'receiverAta');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.withdraw({
					authority: keypair.publicKey,
					currencyMint,
					receiverAta: new PublicKey(body.receiverAta),
				});
				instructions = [ix];
				extra = { receiverAta: body.receiverAta };
				break;
			}
			case 'distribute': {
				instructions = await agent.distributePayments({
					user: keypair.publicKey,
					currencyMint,
				});
				break;
			}
			case 'extend_account': {
				const miss = need(body, 'account');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.extendAccount({
					account: new PublicKey(body.account),
					user: keypair.publicKey,
				});
				instructions = [ix];
				extra = { account: body.account };
				break;
			}
			case 'update_authority': {
				const miss = need(body, 'newAuthority');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.updateAuthority({
					authority: keypair.publicKey,
					newAuthority: new PublicKey(body.newAuthority),
				});
				instructions = [ix];
				extra = { newAuthority: body.newAuthority };
				break;
			}
			case 'update_buyback': {
				const miss = need(body, 'buybackBps');
				if (miss) return error(res, miss.status, miss.code, miss.msg);
				const ix = await agent.updateBuybackBps({
					authority: keypair.publicKey,
					buybackBps: body.buybackBps,
				});
				instructions = [ix];
				extra = { buybackBps: body.buybackBps };
				break;
			}
		}
	} catch (err) {
		console.error(`[pumpfun/pay] ${body.action} build failed`, err);
		return error(res, 422, 'build_failed', err.message || 'could not build instruction');
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
		console.error(`[pumpfun/pay] ${body.action} send failed`, err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${`pumpfun.pay.${body.action}`},
			${JSON.stringify({
				tokenMint: body.tokenMint,
				currencyMint: body.currencyMint,
				signature,
				network: body.network,
				...extra,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/pay] log failed', e));

	return json(res, 200, {
		data: {
			signature,
			action: body.action,
			tokenMint: body.tokenMint,
			currencyMint: body.currencyMint,
			explorer: explorerUrl(signature, body.network),
			...extra,
		},
	});
}

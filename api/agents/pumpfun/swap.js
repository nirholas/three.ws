// POST /api/agents/:id/pumpfun/swap
// AMM swap for graduated pump.fun tokens via @pump-fun/pump-swap-sdk.
// If the requested mint has not graduated yet, the request is auto-routed
// to the bonding-curve buy/sell endpoint so callers don't need to know.
//
// Body: { mint, side: 'buy'|'sell', solAmount?, tokenAmount?, slippageBps?, network? }
//   side='buy'  → spend `solAmount` SOL (decimal) for `mint`
//   side='sell' → sell `tokenAmount` (base-unit integer string) for SOL
//   slippageBps: 0–10_000 (default 500 = 5%)

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { loadAgentForSigning, solanaConnection } from '../../_lib/agent-pumpfun.js';
import { checkBuyAllowed } from '../../_lib/agent-spend-policy.js';
import { sql } from '../../_lib/db.js';
import { Transaction, PublicKey } from '@solana/web3.js';
import { z } from 'zod';

const bodySchema = z.object({
	mint: z.string().min(32).max(64),
	side: z.enum(['buy', 'sell']),
	solAmount: z.number().nonnegative().max(1000).optional(),
	tokenAmount: z.string().regex(/^\d+$/).optional(),
	slippageBps: z.number().int().min(0).max(10_000).default(500),
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
	if (body.side === 'buy' && !body.solAmount)
		return error(res, 400, 'validation_error', 'side=buy requires solAmount');
	if (body.side === 'sell' && !body.tokenAmount)
		return error(res, 400, 'validation_error', 'side=sell requires tokenAmount');

	const loaded = await loadAgentForSigning(id, auth.userId, {
		reason: `pumpfun.swap.${body.side}`,
		meta: { mint: body.mint, network: body.network },
	});
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair, meta } = loaded;

	if (body.side === 'buy') {
		const blocked = await checkBuyAllowed({
			agentId: id, meta, mint: body.mint, solAmount: body.solAmount,
		});
		if (blocked) return error(res, blocked.status, blocked.code, blocked.msg);
	}

	const conn = solanaConnection(body.network);
	const mint = new PublicKey(body.mint);

	// Detect graduation. If still on bonding curve, delegate to /buy or /sell.
	const { PumpSdk, bondingCurvePda } = await import('@pump-fun/pump-sdk');
	const pumpSdk = new PumpSdk();
	const bcInfo = await conn.getAccountInfo(bondingCurvePda(mint));
	const bc = bcInfo ? pumpSdk.decodeBondingCurveNullable(bcInfo) : null;
	const graduated = !bc || bc.complete;

	if (!graduated) {
		return error(
			res,
			409,
			'not_graduated',
			`mint is still on the bonding curve — use /api/agents/${id}/pumpfun/${body.side} instead`,
		);
	}

	// AMM path.
	const { PumpAmmSdk, OnlinePumpAmmSdk, canonicalPumpPoolPda } = await import(
		'@pump-fun/pump-swap-sdk'
	);
	const BN = (await import('bn.js')).default;
	const amm = new PumpAmmSdk();
	const online = new OnlinePumpAmmSdk(conn);

	const poolKey = canonicalPumpPoolPda(mint);
	const swapState = await online.swapSolanaState(poolKey, keypair.publicKey).catch(async (err) => {
		// Fall back: pool account may not be initialized (race after graduation).
		console.error('[pumpfun/swap] swapSolanaState failed', err);
		return online.swapSolanaStateNoPool(poolKey, keypair.publicKey);
	});

	const slippage = body.slippageBps / 10_000;

	let instructions;
	let quotedAmount;
	try {
		if (body.side === 'buy') {
			const quoteLamports = new BN(Math.floor(body.solAmount * 1e9));
			instructions = await amm.buyQuoteInput(swapState, quoteLamports, slippage);
			quotedAmount = { quote_lamports: quoteLamports.toString() };
		} else {
			const baseAmount = new BN(body.tokenAmount);
			instructions = await amm.sellBaseInput(swapState, baseAmount, slippage);
			quotedAmount = { base_amount: baseAmount.toString() };
			// Best-effort expected-SOL-out via constant-product on pool reserves.
			try {
				const pool = swapState.pool || {};
				const baseReserve = pool.baseReserve || pool.virtualBaseReserves;
				const quoteReserve = pool.quoteReserve || pool.virtualQuoteReserves;
				if (baseReserve && quoteReserve) {
					const out = baseAmount.mul(quoteReserve).div(baseReserve.add(baseAmount));
					quotedAmount.expectedSolLamports = out.toString();
				}
			} catch (e) {
				console.error('[pumpfun/swap] sell quote failed', e);
			}
		}
	} catch (err) {
		console.error('[pumpfun/swap] build failed', err);
		return error(res, 422, 'build_failed', err.message || 'could not build swap ix');
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
		console.error('[pumpfun/swap] send failed', err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${`pumpfun.swap.${body.side}`},
			${JSON.stringify({
				mint: body.mint,
				side: body.side,
				...(body.side === 'buy'
					? { solAmount: body.solAmount }
					: { tokenAmount: body.tokenAmount }),
				slippageBps: body.slippageBps,
				signature,
				network: body.network,
				venue: 'amm',
				...quotedAmount,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/swap] log failed', e));

	return json(res, 200, {
		data: {
			signature,
			mint: body.mint,
			side: body.side,
			venue: 'amm',
			pool: poolKey.toBase58(),
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
		},
	});
}

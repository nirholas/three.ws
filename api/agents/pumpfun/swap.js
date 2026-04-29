// POST /api/agents/:id/pumpfun/swap
// Buy or sell a pump.fun token from the agent's Solana wallet.
// While the token is on the bonding curve, uses @pump-fun/pump-sdk.
// After graduation (AMM), uses @pump-fun/pump-swap-sdk.
//
// Body: { mint, side: 'buy'|'sell', solAmount?, tokenAmount?, slippageBps?, network? }
//   - For buy: provide solAmount (SOL to spend). tokenAmount can be 0 (sdk computes).
//   - For sell: provide tokenAmount (raw smallest-units). solAmount is min-out.
//   - slippageBps: 0–10000 (default 500 = 5%)

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { loadAgentForSigning, solanaConnection } from '../../_lib/agent-pumpfun.js';
import { PublicKey, Transaction } from '@solana/web3.js';
import { z } from 'zod';

const bodySchema = z.object({
	mint: z.string().trim().min(32).max(64),
	side: z.enum(['buy', 'sell']),
	solAmount: z.number().nonnegative().optional(),
	tokenAmount: z.string().regex(/^\d+$/).optional(),
	slippageBps: z.number().int().min(0).max(10000).default(500),
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
	const mint = new PublicKey(body.mint);
	const BN = (await import('bn.js')).default;
	const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token').catch(() => ({}));
	const tokenProgram = TOKEN_PROGRAM_ID || new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

	const { PumpSdk } = await import('@pump-fun/pump-sdk');
	const sdk = new PumpSdk();

	// Read bonding curve to decide bonding-curve vs AMM path.
	const { bondingCurvePda } = await import('@pump-fun/pump-sdk');
	const bcInfo = await conn.getAccountInfo(bondingCurvePda(mint));

	let instructions;
	if (bcInfo && !sdk.decodeBondingCurveNullable(bcInfo)?.complete) {
		const { OnlinePumpSdk } = await import('@pump-fun/pump-sdk');
		const online = new OnlinePumpSdk(conn);
		const global = await online.fetchGlobal();
		const bondingCurve = sdk.decodeBondingCurve(bcInfo);
		const slip = body.slippageBps / 100; // sdk takes a percentage

		if (body.side === 'buy') {
			const { associatedUserAccountInfo } = await online.fetchBuyState(mint, keypair.publicKey, tokenProgram);
			instructions = await sdk.buyInstructions({
				global,
				bondingCurveAccountInfo: bcInfo,
				bondingCurve,
				associatedUserAccountInfo,
				mint,
				user: keypair.publicKey,
				amount: new BN(body.tokenAmount || '0'),
				solAmount: new BN(Math.floor((body.solAmount || 0) * 1e9)),
				slippage: slip,
				tokenProgram,
			});
		} else {
			instructions = await sdk.sellInstructions({
				global,
				bondingCurveAccountInfo: bcInfo,
				bondingCurve,
				mint,
				user: keypair.publicKey,
				amount: new BN(body.tokenAmount || '0'),
				solAmount: new BN(Math.floor((body.solAmount || 0) * 1e9)),
				slippage: slip,
				tokenProgram,
				mayhemMode: false,
			});
		}
	} else {
		// Graduated → AMM swap via pump-swap-sdk.
		const swap = await import('@pump-fun/pump-swap-sdk');
		const { OnlinePumpAmmSdk } = swap;
		const amm = new OnlinePumpAmmSdk(conn);
		if (body.side === 'buy') {
			instructions = await swap.buyQuoteInput({
				amm,
				baseMint: mint,
				user: keypair.publicKey,
				quoteAmount: new BN(Math.floor((body.solAmount || 0) * 1e9)),
				slippageBps: body.slippageBps,
			});
		} else {
			instructions = await swap.sellBaseInput({
				amm,
				baseMint: mint,
				user: keypair.publicKey,
				baseAmount: new BN(body.tokenAmount || '0'),
				slippageBps: body.slippageBps,
			});
		}
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

	return json(res, 200, {
		data: {
			signature,
			mint: body.mint,
			side: body.side,
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
		},
	});
}

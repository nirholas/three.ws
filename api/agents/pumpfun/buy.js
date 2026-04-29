// POST /api/agents/:id/pumpfun/buy
// Bonding-curve buy: agent's Solana wallet spends SOL to acquire `mint`.
// Reverts if the token has graduated — use the AMM swap endpoint after that.
//
// Body: { mint, solAmount, slippageBps?, network? }

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
	solAmount: z.number().positive().max(1000),
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

	const loaded = await loadAgentForSigning(id, auth.userId);
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair, meta } = loaded;

	const blocked = await checkBuyAllowed({
		agentId: id,
		meta,
		mint: body.mint,
		solAmount: body.solAmount,
	});
	if (blocked) return error(res, blocked.status, blocked.code, blocked.msg);

	const [{ PumpSdk, OnlinePumpSdk, getBuyTokenAmountFromSolAmount }, BN, splToken] =
		await Promise.all([
			import('@pump-fun/pump-sdk'),
			import('bn.js').then((m) => m.default || m),
			import('@solana/spl-token'),
		]);

	const conn = solanaConnection(body.network);
	const online = new OnlinePumpSdk(conn);
	const sdk = new PumpSdk();
	const mint = new PublicKey(body.mint);
	const solLamports = new BN(Math.floor(body.solAmount * 1e9));

	let instructions;
	try {
		const [global, state] = await Promise.all([
			online.fetchGlobal(),
			online.fetchBuyState(mint, keypair.publicKey),
		]);
		const expected = getBuyTokenAmountFromSolAmount({
			global,
			feeConfig: null,
			mintSupply: state.bondingCurve.tokenTotalSupply,
			bondingCurve: state.bondingCurve,
			amount: solLamports,
		});
		instructions = await sdk.buyInstructions({
			global,
			bondingCurveAccountInfo: state.bondingCurveAccountInfo,
			bondingCurve: state.bondingCurve,
			associatedUserAccountInfo: state.associatedUserAccountInfo,
			mint,
			user: keypair.publicKey,
			amount: expected,
			solAmount: solLamports,
			slippage: body.slippageBps / 10_000,
			tokenProgram: splToken.TOKEN_PROGRAM_ID,
		});
	} catch (err) {
		console.error('[pumpfun/buy] build failed', err);
		return error(res, 422, 'build_failed', err.message || 'could not build buy ix');
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
		console.error('[pumpfun/buy] send failed', err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${'pumpfun.buy'},
			${JSON.stringify({
				mint: body.mint,
				solAmount: body.solAmount,
				slippageBps: body.slippageBps,
				signature,
				network: body.network,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/buy] log failed', e));

	return json(res, 200, {
		data: {
			signature,
			mint: body.mint,
			solAmount: body.solAmount,
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
		},
	});
}

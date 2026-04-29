/**
 * GET /api/agents/tokens/launch-quote?initial_buy_sol=0.5&cluster=mainnet
 *
 * Pre-flight cost estimate for a Pump.fun coin launch. Returned to the UI
 * before the user clicks "Launch" so they can see what the transaction will
 * cost from their wallet.
 *
 * Costs:
 *   • Mint account rent      ~ 0.00146 SOL  (fixed; SystemProgram.createAccount)
 *   • Bonding curve PDA rent ~ 0.00203 SOL  (Pump.fun create instruction)
 *   • Metadata account       ~ 0.00561 SOL  (Metaplex CPI inside create)
 *   • Tx fee (1 sig)         ~ 0.000005 SOL
 *   • Initial buy            user-provided lamports + ~1% protocol fee
 *
 * The exact rent numbers come from Pump.fun's program; we use conservative
 * upper bounds rather than fetching them per-request — they don't change.
 */

import { z } from 'zod';
import BN from 'bn.js';
import { Connection } from '@solana/web3.js';
import { PumpSdk, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';

import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';

const querySchema = z.object({
	initial_buy_sol: z.coerce.number().min(0).max(50).default(0),
	cluster: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

// Conservative upper bounds, in SOL.
const FIXED_LAUNCH_COST = {
	mintRent: 0.00146,
	bondingCurveRent: 0.00203,
	metadataRent: 0.00561,
	txFee: 0.000005,
};
const FIXED_LAUNCH_TOTAL =
	FIXED_LAUNCH_COST.mintRent +
	FIXED_LAUNCH_COST.bondingCurveRent +
	FIXED_LAUNCH_COST.metadataRent +
	FIXED_LAUNCH_COST.txFee;

function rpcUrl(cluster) {
	return cluster === 'devnet'
		? process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com'
		: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const q = querySchema.parse({
		initial_buy_sol: url.searchParams.get('initial_buy_sol'),
		cluster: url.searchParams.get('cluster') || undefined,
	});

	let buyEstimate = null;
	if (q.initial_buy_sol > 0) {
		try {
			const conn = new Connection(rpcUrl(q.cluster), 'confirmed');
			const sdk = new PumpSdk(conn);
			const global = await sdk.fetchGlobal();
			const lamports = new BN(Math.floor(q.initial_buy_sol * 1_000_000_000));
			const tokensOut = getBuyTokenAmountFromSolAmount({
				global,
				feeConfig: null,
				mintSupply: null,
				bondingCurve: null,
				amount: lamports,
			});
			// Pump.fun protocol fee on initial buy is ~1%; surface as a separate
			// line so the user sees what's spent vs what funds the curve.
			buyEstimate = {
				sol: q.initial_buy_sol,
				tokens_out: tokensOut.toString(),
				protocol_fee_sol: q.initial_buy_sol * 0.01,
			};
		} catch (e) {
			// If RPC is unhealthy, return the structural estimate without the
			// curve quote — the UI can still show launch costs.
			console.warn('[launch-quote] RPC fetch failed:', e.message);
		}
	}

	const totalSol =
		FIXED_LAUNCH_TOTAL + q.initial_buy_sol + (buyEstimate?.protocol_fee_sol || 0);

	return json(res, 200, {
		cluster: q.cluster,
		fixed: FIXED_LAUNCH_COST,
		fixed_total_sol: FIXED_LAUNCH_TOTAL,
		initial_buy: buyEstimate,
		total_sol: totalSol,
	});
});

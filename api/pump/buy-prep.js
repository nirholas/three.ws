// POST /api/pump/buy-prep
//
// Auto-routes between bonding-curve buy (pre-graduation) and AMM buy
// (post-graduation), returning an unsigned tx the wallet signs and submits.
// Body: { mint, network, sol, slippage_bps?, wallet_address }

import { z } from 'zod';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import {
	getConnection,
	getPumpSdk,
	getAmmPoolState,
	buildUnsignedTxBase64,
	solanaPubkey,
} from '../_lib/pump.js';

const bodySchema = z.object({
	mint: z.string().min(32).max(44),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
	sol: z.number().positive().max(50),
	slippage_bps: z.number().int().min(0).max(5000).default(100),
	wallet_address: z.string().min(32).max(44),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const userPk = solanaPubkey(body.wallet_address);
	const mintPk = solanaPubkey(body.mint);
	if (!userPk || !mintPk) return error(res, 400, 'validation_error', 'invalid pubkeys');

	try {
		const { sdk, BN, web3 } = await getPumpSdk({ network: body.network });
		const lamports = new BN(Math.floor(body.sol * web3.LAMPORTS_PER_SOL));
		const slippage = body.slippage_bps / 10_000;

		// Try bonding curve.
		let buyState = null;
		try {
			if (sdk.fetchBuyState) buyState = await sdk.fetchBuyState(mintPk, userPk);
		} catch {
			buyState = null;
		}

		if (buyState && buyState.bondingCurve && !buyState.bondingCurve.complete) {
			const global = await sdk.fetchGlobal();
			const ixs = await sdk.buyInstructions({
				global,
				bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
				bondingCurve: buyState.bondingCurve,
				associatedUserAccountInfo: buyState.associatedUserAccountInfo,
				mint: mintPk,
				user: userPk,
				amount: new BN(0),
				solAmount: lamports,
				slippage,
			});
			const tx_base64 = await buildUnsignedTxBase64({
				network: body.network,
				payer: userPk,
				instructions: ixs,
			});
			return json(res, 201, {
				route: 'bonding_curve',
				mint: body.mint,
				network: body.network,
				sol_in: body.sol,
				slippage_bps: body.slippage_bps,
				tx_base64,
			});
		}

		// AMM
		const amm = await getAmmPoolState({ network: body.network, mint: mintPk });
		const ammMod = await import('@pump-fun/pump-swap-sdk');
		const offline = new ammMod.PumpAmmSdk();
		const onlineAmm = new ammMod.OnlinePumpAmmSdk(getConnection({ network: body.network }));
		const swapState = await onlineAmm.swapSolanaState(amm.poolKey, userPk);
		const ixs = await offline.buyQuoteInput(swapState, lamports, slippage);
		const tx_base64 = await buildUnsignedTxBase64({
			network: body.network,
			payer: userPk,
			instructions: ixs,
		});
		return json(res, 201, {
			route: 'amm',
			pool: amm.poolKey.toString(),
			mint: body.mint,
			network: body.network,
			sol_in: body.sol,
			slippage_bps: body.slippage_bps,
			tx_base64,
		});
	} catch (e) {
		return error(
			res,
			e.status || 502,
			e.code || 'pump_sdk_error',
			e.message || 'failed to build buy tx',
		);
	}
});

// GET /api/pump/quote?mint=<pubkey>&network=mainnet|devnet&sol=<amount>&direction=buy|sell
//
// Read-only price/quote for a pump.fun token. Auto-routes between bonding-curve
// (pre-graduation) via @pump-fun/pump-sdk and AMM (post-graduation) via
// @pump-fun/pump-swap-sdk. No wallet, no signing.

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getPumpSdk, getAmmPoolState, solanaPubkey } from '../_lib/pump.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const mintStr = url.searchParams.get('mint');
	const network = url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	const direction = url.searchParams.get('direction') === 'sell' ? 'sell' : 'buy';
	const solRaw = url.searchParams.get('sol');
	const tokenRaw = url.searchParams.get('token');
	const slippageRaw = url.searchParams.get('slippage_bps');
	const slippageBps = Number.isFinite(Number(slippageRaw))
		? Math.max(0, Math.min(5000, Number(slippageRaw)))
		: 100;
	const slippage = slippageBps / 10_000;

	const mint = solanaPubkey(mintStr);
	if (!mint) return error(res, 400, 'validation_error', 'invalid mint');

	try {
		// Try bonding curve first.
		const { sdk, BN, web3 } = await getPumpSdk({ network });
		const LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL || 1_000_000_000;

		let curve = null;
		try {
			if (sdk.fetchBuyState) {
				const state = await sdk.fetchBuyState(mint, mint); // any pubkey works for read
				curve = state.bondingCurve;
			} else if (sdk.fetchBondingCurve) {
				curve = await sdk.fetchBondingCurve(mint);
			}
		} catch {
			curve = null;
		}

		if (curve && !curve.complete) {
			const global =
				typeof sdk.fetchGlobal === 'function' ? await sdk.fetchGlobal() : null;
			const pumpSdk = await import('@pump-fun/pump-sdk');
			let quote = null;

			if (direction === 'buy' && solRaw) {
				const sol = Number(solRaw);
				if (!(sol > 0)) return error(res, 400, 'validation_error', 'sol must be > 0');
				const lamports = new BN(Math.floor(sol * LAMPORTS_PER_SOL));
				const tokens = pumpSdk.getBuyTokenAmountFromSolAmount(global, curve, lamports);
				quote = { sol_in: sol, tokens_out: tokens.toString(), source: 'bonding_curve' };
			} else if (direction === 'sell' && tokenRaw) {
				const tokens = new BN(tokenRaw);
				const lamports = pumpSdk.getSellSolAmountFromTokenAmount(global, curve, tokens);
				quote = {
					tokens_in: tokenRaw,
					sol_out: Number(lamports.toString()) / LAMPORTS_PER_SOL,
					source: 'bonding_curve',
				};
			}

			return json(res, 200, {
				mint: mintStr,
				network,
				graduated: false,
				bonding_curve: {
					real_sol_reserves: curve.realSolReserves?.toString?.() ?? null,
					real_token_reserves: curve.realTokenReserves?.toString?.() ?? null,
					virtual_sol_reserves: curve.virtualSolReserves?.toString?.() ?? null,
					virtual_token_reserves: curve.virtualTokenReserves?.toString?.() ?? null,
					complete: curve.complete ?? false,
				},
				quote,
			});
		}

		// Post-graduation: AMM via canonical pump.fun pool (quote = WSOL).
		let amm;
		try {
			amm = await getAmmPoolState({ network, mint });
		} catch (e) {
			if (e.code === 'pool_not_found') {
				return json(res, 200, {
					mint: mintStr,
					network,
					graduated: true,
					pool: null,
					quote: null,
					note: 'No bonding curve and no canonical AMM pool — token may not be a pump.fun mint or has not graduated yet',
				});
			}
			throw e;
		}

		const { pool, poolKey, baseReserve, quoteReserve, baseMintAccount, globalConfig, feeConfig } = amm;
		const LAMPORTS_PER_SOL_AMM = 1_000_000_000;
		const ammSdk = await import('@pump-fun/pump-swap-sdk');
		let quote = null;

		if (direction === 'buy' && solRaw) {
			const sol = Number(solRaw);
			if (!(sol > 0)) return error(res, 400, 'validation_error', 'sol must be > 0');
			const lamports = new BN(Math.floor(sol * LAMPORTS_PER_SOL_AMM));
			const r = ammSdk.buyQuoteInput({
				quote: lamports,
				slippage,
				baseReserve,
				quoteReserve,
				globalConfig,
				baseMintAccount,
				baseMint: pool.baseMint,
				coinCreator: pool.coinCreator,
				creator: pool.creator,
				feeConfig,
			});
			quote = {
				sol_in: sol,
				tokens_out: r.base?.toString?.() ?? null,
				min_tokens_out: r.uiBase?.toString?.() ?? r.minBase?.toString?.() ?? null,
				slippage_bps: slippageBps,
				source: 'amm',
			};
		} else if (direction === 'sell' && tokenRaw) {
			const tokens = new BN(tokenRaw);
			const r = ammSdk.sellBaseInput({
				base: tokens,
				slippage,
				baseReserve,
				quoteReserve,
				globalConfig,
				baseMintAccount,
				baseMint: pool.baseMint,
				coinCreator: pool.coinCreator,
				creator: pool.creator,
				feeConfig,
			});
			const lamportsOut = r.quote ?? r.uiQuote ?? r.minQuote;
			quote = {
				tokens_in: tokenRaw,
				sol_out:
					lamportsOut != null ? Number(lamportsOut.toString()) / LAMPORTS_PER_SOL_AMM : null,
				min_sol_out:
					(r.minQuote ?? r.uiQuote)?.toString
						? Number((r.minQuote ?? r.uiQuote).toString()) / LAMPORTS_PER_SOL_AMM
						: null,
				slippage_bps: slippageBps,
				source: 'amm',
			};
		}

		return json(res, 200, {
			mint: mintStr,
			network,
			graduated: true,
			pool: {
				address: poolKey.toString(),
				base: pool.baseMint.toString(),
				quote: pool.quoteMint.toString(),
				base_reserve: baseReserve.toString(),
				quote_reserve: quoteReserve.toString(),
				lp_supply: pool.lpSupply?.toString?.() ?? null,
			},
			quote,
		});
	} catch (err) {
		return error(res, err.status || 502, err.code || 'pump_sdk_error', err.message || 'pump.fun SDK error');
	}
});

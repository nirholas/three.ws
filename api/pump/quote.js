// GET /api/pump/quote?mint=<pubkey>&network=mainnet|devnet&sol=<amount>&direction=buy|sell
//
// Read-only price/quote for a pump.fun token. Auto-routes between bonding-curve
// (pre-graduation) via @pump-fun/pump-sdk and AMM (post-graduation) via
// @pump-fun/pump-swap-sdk. No wallet, no signing.

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getPumpSdk, getPumpSwapSdk, solanaPubkey } from '../_lib/pump.js';

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

		// Post-graduation: AMM
		const { sdk: ammSdk, BN: BN2 } = await getPumpSwapSdk({ network });
		// Find pool for this mint vs WSOL (or USDC). Pool discovery is left to
		// caller for now — if not implemented, return graduated:true with no quote.
		let pool = null;
		try {
			if (ammSdk.findPoolByMint) {
				pool = await ammSdk.findPoolByMint(mint);
			}
		} catch {
			pool = null;
		}

		return json(res, 200, {
			mint: mintStr,
			network,
			graduated: true,
			pool: pool
				? {
						address: pool.address?.toString?.() ?? String(pool.address),
						base: pool.baseMint?.toString?.() ?? null,
						quote: pool.quoteMint?.toString?.() ?? null,
					}
				: null,
			quote: null,
			note: pool ? null : 'Post-graduation pool lookup requires explicit pool key',
		});
	} catch (err) {
		return error(res, 502, 'pump_sdk_error', err.message || 'pump.fun SDK error');
	}
});

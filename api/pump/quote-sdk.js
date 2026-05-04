// GET /api/pump/quote-sdk?mint=<mint>&side=buy|sell&amount=<n>[&network=]
// ----------------------------------------------------------------------
// Public, read-only quote endpoint backed by @nirholas/pump-sdk via the
// sdk-bridge helpers. Returns deterministic SDK math instead of the dashboard's
// previous "use the SDK for precise quote calculation" placeholder.
//
//   side=buy    amount = SOL (decimal, e.g. 0.5)
//   side=sell   amount = tokens (UI units, e.g. 100000)
//
// Edge-cached for 5s — bonding curves move per-trade so a few seconds of
// staleness keeps RPC cost down without misleading users.

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { getRpcFallback } from '../_lib/pump.js';
import { getBuyQuote, getSellQuote, getTokenPrice } from '../_lib/solana/index.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
// Pump bonding-curve tokens use 6 decimals.
const PUMP_TOKEN_DECIMALS = 6;
const TOKEN_BASE = 10 ** PUMP_TOKEN_DECIMALS;

function isPlausibleMint(s) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); }

function readQuery(req) {
	try {
		const u = new URL(req.url, 'http://x');
		return {
			mint: (u.searchParams.get('mint') || '').trim(),
			side: (u.searchParams.get('side') || 'buy').toLowerCase(),
			amount: u.searchParams.get('amount'),
			network: u.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet',
		};
	} catch {
		return { mint: '', side: 'buy', amount: null, network: 'mainnet' };
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const { mint, side, amount, network } = readQuery(req);
	if (!mint || !isPlausibleMint(mint)) {
		return error(res, 400, 'bad_mint', 'mint query param must be a base58 Solana address');
	}
	if (side !== 'buy' && side !== 'sell') {
		return error(res, 400, 'bad_side', 'side must be "buy" or "sell"');
	}
	const amt = Number(amount);
	if (!Number.isFinite(amt) || amt <= 0) {
		return error(res, 400, 'bad_amount', 'amount must be a positive number');
	}

	const rpc = getRpcFallback({ network });

	// Convert UI units → on-chain integer base units expected by the SDK.
	const baseUnits = side === 'buy'
		? BigInt(Math.floor(amt * LAMPORTS_PER_SOL)).toString()
		: BigInt(Math.floor(amt * TOKEN_BASE)).toString();

	const result = await rpc.withFallback(async (connection) => {
		const [quote, price] = await Promise.all([
			side === 'buy'
				? getBuyQuote(connection, mint, baseUnits)
				: getSellQuote(connection, mint, baseUnits),
			getTokenPrice(connection, mint),
		]);
		return { quote, price };
	});

	if (!result.quote) {
		return error(res, 404, 'no_curve', 'no bonding curve found for that mint (graduated?)');
	}

	const out = {
		mint,
		network,
		side,
		input: side === 'buy'
			? { sol: amt, lamports: baseUnits }
			: { tokens: amt, baseUnits },
		output: side === 'buy'
			? { tokens: result.quote.tokens.toString(), tokensUi: Number(result.quote.tokens.toString()) / TOKEN_BASE }
			: { lamports: result.quote.sol.toString(), sol: Number(result.quote.sol.toString()) / LAMPORTS_PER_SOL },
		priceImpactPct: result.quote.priceImpact,
		marketContext: result.price ? serializeBNs(result.price) : null,
	};

	return json(res, 200, out, { 'cache-control': 'public, max-age=2, s-maxage=5, stale-while-revalidate=15' });
});

function serializeBNs(obj) {
	if (obj == null || typeof obj !== 'object') return obj;
	const out = Array.isArray(obj) ? [] : {};
	for (const [k, v] of Object.entries(obj)) {
		if (v && typeof v === 'object' && typeof v.toString === 'function' && (v.constructor?.name === 'BN' || typeof v.toNumber === 'function')) {
			out[k] = v.toString();
		} else if (v && typeof v === 'object') {
			out[k] = serializeBNs(v);
		} else {
			out[k] = v;
		}
	}
	return out;
}

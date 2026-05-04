// GET /api/pump/curve?mint=<mint>[&network=mainnet|devnet]
// ----------------------------------------------------------
// Public, read-only bonding-curve view. Combines @nirholas/pump-sdk reads via
// our RpcFallback + sdk-bridge helpers and returns:
//   - bonding curve raw state
//   - current price + market cap
//   - graduation progress
//
// Cached at the edge for 10s — the curve only changes per trade so a few
// seconds of staleness is acceptable and keeps RPC cost down on hot mints.

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { rpcFallbackFromEnv, getBondingCurveState, getTokenPrice, getGraduationProgress } from '../_lib/solana/index.js';

function readMint(req) {
	try {
		const u = new URL(req.url, 'http://x');
		return {
			mint: (u.searchParams.get('mint') || '').trim(),
			network: u.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet',
		};
	} catch {
		return { mint: '', network: 'mainnet' };
	}
}

function isPlausibleMint(s) {
	return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const { mint, network } = readMint(req);
	if (!mint || !isPlausibleMint(mint)) {
		return error(res, 400, 'bad_mint', 'mint query param must be a base58 Solana address');
	}

	const rpc = rpcFallbackFromEnv({ network });
	const result = await rpc.withFallback(async (connection) => {
		const [curve, price, grad] = await Promise.all([
			getBondingCurveState(connection, mint),
			getTokenPrice(connection, mint),
			getGraduationProgress(connection, mint),
		]);
		return { curve, price, graduation: grad };
	});

	if (!result.curve) {
		return error(res, 404, 'no_curve', 'no bonding curve found for that mint');
	}

	return json(res, 200, {
		mint,
		network,
		...result,
		// price/graduation values from the SDK contain BNs — stringify them for JSON wire safety
		price: result.price ? serializeBNs(result.price) : null,
		graduation: result.graduation ? serializeBNs(result.graduation) : null,
	}, { 'cache-control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=30' });
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

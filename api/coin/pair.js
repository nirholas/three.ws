// GET /api/coin/pair?address=<pool-address>&network=<geckoterminal-network>
// ---------------------------------------------------------------------------
// The inverse of /api/coin/pool: hand it the PAIR address a chart terminal uses
// to name a market, get back the token that pair trades.
//
// Every DEX terminal (DEXTools, DexScreener, GeckoTerminal) keys a market by its
// pool account, so a link, a widget parameter or an embed arriving from one
// carries a pair and no mint. three.ws keys everything by mint. This endpoint is
// the bridge, which is what lets /coin3d be embedded straight into a pair page
// with the identifier that page already has.
//
// Keyless and CORS-open on purpose: a partner's page calls it from the browser.
// Real data only: GeckoTerminal first, DexScreener for a pair GeckoTerminal has
// not indexed yet (which is every young pump.fun pair), and a last-good tier
// behind both. A pool nobody knows is a 404, never an invented token.

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { tokenForPool } from '../_lib/market/ohlcv.js';

// Same network set /api/coin/pool accepts, so the two directions stay symmetric.
const NETWORKS = new Set(['solana', 'eth', 'base', 'bsc', 'polygon_pos', 'arbitrum', 'optimism', 'avax']);

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.marketDataIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, 'http://x').searchParams;
	const address = (params.get('address') || '').trim();
	const network = (params.get('network') || 'solana').trim();

	if (!NETWORKS.has(network)) {
		return error(res, 400, 'bad_network', 'network must be a supported GeckoTerminal network id');
	}
	// A pool account is addressed exactly like a token on the same chain, so the
	// same shape check applies and a malformed value never reaches upstream.
	const wellFormed = network === 'solana' ? SOL_RE.test(address) : EVM_RE.test(address);
	if (!wellFormed) {
		return error(res, 400, 'bad_address', 'address is not a valid pool address for the network');
	}

	try {
		const { pool, ...market } = await tokenForPool(address, network);
		return json(
			res,
			200,
			{ network, pair: pool || address, ...market },
			{ 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' },
		);
	} catch (err) {
		// A pair no source has indexed is a normal outcome, not a fault: the
		// caller shows "we can't render this market yet" rather than a dead frame.
		if (err?.status === 404) return error(res, 404, 'no_pair', 'no indexed market found for this pool address');
		if (err?.status === 429) return error(res, 429, 'rate_limited', 'pair source is throttled, retry shortly');
		return error(res, 502, 'upstream_error', 'pair source is temporarily unavailable');
	}
});

// GET /api/papertrade?view=markets|protocol|quote|account
// ---------------------------------------------------------------------------
// Read-only window onto Papertrade, the synthetic-perps exchange on HyperEVM.
//
//   view=markets   (default) BTC/ETH markets: live mid, limits, open interest
//   view=protocol  TVL, LP, payout queue, fees, relayer readiness
//   view=quote     exact open quote: &symbol=BTC&side=long&margin_usd=100&leverage=100
//   view=account   any wallet's balances and valued positions: &address=0x...
//
// Every figure comes from Papertrade's public API, the exchange contract and
// Hyperliquid's live BBO, priced by api/_lib/papertrade/math.js at contract
// scale. Nothing here signs or trades. Guide: docs/papertrade.md.

import { cors, json, method, wrap, error, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { markets, protocol, quote, account, PapertradeError } from './_lib/papertrade/index.js';

const VIEWS = {
	markets: { run: () => markets(), cache: 'public, max-age=5, s-maxage=5, stale-while-revalidate=30' },
	protocol: { run: () => protocol(), cache: 'public, max-age=15, s-maxage=30, stale-while-revalidate=120' },
	quote: {
		run: (q) => quote({ symbol: q.get('symbol'), side: q.get('side'), marginUsd: q.get('margin_usd'), leverage: q.get('leverage') }),
		cache: 'no-store',
	},
	account: { run: (q) => account(q.get('address')), cache: 'private, max-age=5' },
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.marketDataIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const q = new URL(req.url, 'http://x').searchParams;
	const name = q.get('view') || 'markets';
	const view = VIEWS[name];
	if (!view) return error(res, 400, 'invalid_view', `view must be one of: ${Object.keys(VIEWS).join(', ')}.`);

	try {
		return json(res, 200, await view.run(q), { 'cache-control': view.cache });
	} catch (err) {
		if (err instanceof PapertradeError) {
			return error(res, err.status, err.code, err.message, err.detail ? { detail: err.detail } : {});
		}
		throw err;
	}
});

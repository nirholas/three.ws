// GET /api/v1/robinhood/paired-coins-detail?address=0x…[&interval=1h] — one paired coin.
//
// Free, keyless. The coin's pools read live from the launchpad and priced in
// dollars, its verified descriptor, the three.ws agent that launched it (when
// one did), the latest trades from the launchpad's Swap events, and OHLCV
// candles per pool in that pool's own quote units.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { asOf } from '../../_lib/robinhood.js';
import { pairedCoinDetail } from '../../_lib/paired-directory.js';

const CACHE_CONTROL = 'public, max-age=10, s-maxage=10, stale-while-revalidate=20';
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export default defineEndpoint({
	name: 'v1.robinhood.paired-coins-detail',
	method: 'GET',
	auth: 'public',
	handler: async ({ res, query, ip }) => {
		const rl = await limits.robinhoodRead(ip);
		if (!rl.success) return rateLimited(res, rl, 'Robinhood Chain data is capped at 60 requests/min per IP');

		const address = String(query.address || '').trim();
		if (!ADDR_RE.test(address)) fail(400, 'validation_error', 'pass ?address=<0x… paired coin address>');
		const coin = await pairedCoinDetail(address, { interval: String(query.interval || '1h') });
		if (!coin) fail(404, 'not_found', 'that address is not a coin on the paired launchpad');

		res.setHeader('cache-control', CACHE_CONTROL);
		return { ...coin, asOf: asOf() };
	},
});

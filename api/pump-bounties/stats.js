// GET /api/pump-bounties/stats — headline totals for the bounty board.
//
// Walks the public pump.fun GO list (cursor-paginated) and aggregates the open
// board: how many live bounties, total reward USD on offer, and total
// submissions. Bounded by a page cap and cached for a couple of minutes, so the
// walk runs at most once per window no matter how many visitors load the page.
//
// pump.fun's Cloudflare anti-bot challenge can reject the underlying list call
// for hours at a time (see api/pump-bounties.js); cacheWrapLastGood mirrors
// every real walk into a 24h last-known-good copy and serves that (flagged
// with an x-pump-stale header) instead of a 502 when that happens. The whole
// paginated walk is one cache unit, same as before: a mid-walk failure is
// never partially cached or served.

import { cors, json, error, wrap, method } from './../_lib/http.js';
import { cacheWrapLastGood } from './../_lib/cache.js';
import { listBounties, PumpGoError } from './../_lib/pump-go.js';

const PAGE = 50;
const MAX_PAGES = 20; // hard ceiling: ≤1000 bounties scanned per refresh
const CACHE_TTL_S = 120;
const CACHE_KEY = 'pumpgo:stats:v1';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	let value, stale;
	try {
		({ value, stale } = await cacheWrapLastGood(
			CACHE_KEY,
			CACHE_TTL_S,
			async () => {
				let count = 0;
				let totalRewardUsd = 0;
				let totalSubmissions = 0;
				let totalLikes = 0;
				let cursor = null;
				let pages = 0;
				let truncated = false;

				do {
					const { items, nextCursor } = await listBounties({ limit: PAGE, cursor });
					for (const b of items) {
						count += 1;
						totalRewardUsd += Number(b.reward.totalUsd) || 0;
						totalSubmissions += b.counts.submissions || 0;
						totalLikes += b.likeCount || 0;
					}
					cursor = nextCursor;
					pages += 1;
					if (pages >= MAX_PAGES && cursor) {
						truncated = true;
						break;
					}
				} while (cursor);

				return {
					count,
					totalRewardUsd: Math.round(totalRewardUsd * 100) / 100,
					totalSubmissions,
					totalLikes,
					truncated, // true → the board is larger than what we scanned
					updatedAt: new Date().toISOString(),
				};
			},
			{ withMeta: true },
		));
	} catch (e) {
		if (!(e instanceof PumpGoError)) throw e;
		return error(res, e.status, e.code, e.message);
	}

	if (stale) res.setHeader('x-pump-stale', '1');
	res.setHeader('cache-control', 'public, s-maxage=120, stale-while-revalidate=300');
	return json(res, 200, value);
});

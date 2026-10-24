// GET /api/pump-bounties/stats — headline totals for the bounty board.
//
// Walks the public pump.fun GO list (cursor-paginated) and aggregates the open
// board: how many live bounties, total reward USD on offer, and total
// submissions. Bounded by a page cap and cached for a couple of minutes, so the
// walk runs at most once per window no matter how many visitors load the page.
//
// pump.fun's Cloudflare anti-bot challenge can reject the underlying list call
// for hours at a time (see api/pump-bounties.js); a long-lived last-known-good
// copy, written on every real success, is served (marked stale) instead of a
// 502 when that happens.

import { cors, json, error, wrap, method } from './../_lib/http.js';
import { cacheGet, cacheSet } from './../_lib/cache.js';
import { listBounties, PumpGoError } from './../_lib/pump-go.js';

const PAGE = 50;
const MAX_PAGES = 20; // hard ceiling: ≤1000 bounties scanned per refresh
const CACHE_TTL_S = 120;
const CACHE_KEY = 'pumpgo:stats:v1';
const LKG_KEY = 'pumpgo:stats:v1:lkg';
const LKG_TTL_S = 1800;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const cached = await cacheGet(CACHE_KEY).catch(() => null);
	if (cached) {
		res.setHeader('cache-control', 'public, s-maxage=120, stale-while-revalidate=300');
		return json(res, 200, cached);
	}

	let count = 0;
	let totalRewardUsd = 0;
	let totalSubmissions = 0;
	let totalLikes = 0;
	let cursor = null;
	let pages = 0;
	let truncated = false;

	try {
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
	} catch (e) {
		if (!(e instanceof PumpGoError)) throw e;
		const stale = await cacheGet(LKG_KEY).catch(() => null);
		if (stale) {
			res.setHeader('cache-control', 'public, s-maxage=120, stale-while-revalidate=300');
			return json(res, 200, { ...stale, stale: true });
		}
		return error(res, e.status, e.code, e.message);
	}

	const payload = {
		count,
		totalRewardUsd: Math.round(totalRewardUsd * 100) / 100,
		totalSubmissions,
		totalLikes,
		truncated, // true → the board is larger than what we scanned
		updatedAt: new Date().toISOString(),
	};
	await cacheSet(CACHE_KEY, payload, CACHE_TTL_S).catch(() => {});
	await cacheSet(LKG_KEY, payload, LKG_TTL_S).catch(() => {});
	res.setHeader('cache-control', 'public, s-maxage=120, stale-while-revalidate=300');
	return json(res, 200, payload);
});

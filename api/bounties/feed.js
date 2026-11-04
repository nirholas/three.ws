// GET /api/bounties/feed - the aggregated bounty, hackathon and grant feed.
//
//   ?source=devpost|devfolio|github|three-build   one source
//   ?kind=bounty|project|hackathon|grant|task      one kind
//   ?status=open|closed                            default open
//   ?q=text                                        title, summary, sponsor or skill
//   ?category=...  ?minUsd=500  ?sort=reward|deadline|new  ?limit=30  ?cursor=...
//
// The response carries `sources`, one entry per source with an ok, stale or
// empty status, so a page can say which source is unavailable instead of
// silently showing a shorter list. A source being down never fails the feed.

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { parseLimit } from '../_lib/http-params.js';
import { queryFeed, feedStats } from '../_lib/bounties/store.js';
import { SOURCES, SOURCE_IDS } from '../_lib/bounties/sources/index.js';
import { KINDS } from '../_lib/bounties/normalize.js';
import { dedupeByUrl, serializeListing, encodeCursor, decodeCursor, sourceHealth } from '../_lib/bounties/feed.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://localhost');
	const p = url.searchParams;
	const source = p.get('source');
	if (source && !SOURCE_IDS.includes(source)) return error(res, 400, 'validation_error', `source must be one of ${SOURCE_IDS.join(', ')}`);
	const kind = p.get('kind');
	if (kind && !KINDS.includes(kind)) return error(res, 400, 'validation_error', `kind must be one of ${KINDS.join(', ')}`);
	const status = p.get('status') || 'open';
	if (status !== 'open' && status !== 'closed') return error(res, 400, 'validation_error', 'status must be open or closed');
	const minUsdRaw = p.get('minUsd');
	const minUsd = minUsdRaw == null || minUsdRaw === '' ? null : Number(minUsdRaw);
	if (minUsd != null && (!Number.isFinite(minUsd) || minUsd < 0)) return error(res, 400, 'validation_error', 'minUsd must be a non-negative number');

	const limit = parseLimit(p, { fallback: 30, max: 100 });
	const offset = decodeCursor(p.get('cursor'));

	const [{ rows, total }, stats] = await Promise.all([
		queryFeed({ q: p.get('q') || '', source, kind, category: p.get('category'), minUsd, sort: p.get('sort') || 'reward', limit, offset, status }),
		feedStats(),
	]);
	const listings = dedupeByUrl(rows.map(serializeListing));
	const next = offset + rows.length < total ? encodeCursor(offset + rows.length) : null;

	res.setHeader('cache-control', 'public, max-age=60, stale-while-revalidate=300');
	json(res, 200, {
		listings,
		total,
		nextCursor: next,
		sources: sourceHealth(SOURCES, stats.bySource),
		categories: stats.categories,
		refreshedAt: stats.totals?.refreshed_at ? new Date(stats.totals.refreshed_at).toISOString() : null,
	});
});

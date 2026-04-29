// GET /api/pump/channel-feed?limit=50&kinds=mint,whale,claim
//
// Returns a normalized, deduped, newest-first array of recent pump.fun signals:
//   { items: [{ kind, mint, signature, ts, summary, refs }] }
//
// kinds: comma-separated subset of mint|whale|claim (default: all three)
// limit: max items returned (default 50, max 200)
//
// Read-through — no persistence. Data comes from Upstash Redis lists populated
// by the pumpkit worker. Missing/unconfigured Redis returns empty arrays.

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getMints, getWhales, getClaims } from '../_lib/channel-feed-sources.js';
import { buildFeed } from '../../src/pump/channel-feed.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit') || 50)), 200);
	const kinds = url.searchParams.get('kinds') || null;

	const [mints, whales, claims] = await Promise.all([
		getMints(limit),
		getWhales(limit),
		getClaims(limit),
	]);

	const items = buildFeed(
		[
			{ kind: 'mint', items: mints },
			{ kind: 'whale', items: whales },
			{ kind: 'claim', items: claims },
		],
		{ limit, kinds },
	);

	return json(res, 200, { items });
});

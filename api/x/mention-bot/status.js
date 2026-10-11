// @ts-check
// GET /api/x/mention-bot/status
//
// Public status for the X @-mention reply bot: mode, how many handles it has
// replied on, how many replies it sent in the last day, and how fast. No
// private data: no mention text, no author identities, no budget caps, no
// row-level ledger content. Anyone can call this; it only ever aggregates.
//
// Cached 60s (cacheGet/cacheSet, matching api/status.js's own subsystem
// snapshot) so a page load never pays for its own DB aggregate query twice.

import { cors, json, method, rateLimited, wrap } from '../../_lib/http.js';
import { clientIp, limits } from '../../_lib/rate-limit.js';
import { cacheGet, cacheSet } from '../../_lib/cache.js';
import { publicMentionBotStatus } from '../../_lib/x-mention-health.js';

const CACHE_KEY = 'x:mention-bot:public-status';
const CACHE_TTL_S = 60;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let body = await cacheGet(CACHE_KEY);
	if (!body) {
		body = await publicMentionBotStatus();
		await cacheSet(CACHE_KEY, body, CACHE_TTL_S);
	}

	return json(res, 200, { ...body, note: 'aggregate counts only, no private data' });
});

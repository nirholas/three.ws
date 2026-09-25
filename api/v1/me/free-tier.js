// GET /api/v1/me/free-tier: today's free-model allowance for the caller.
//
// A signed-in caller (session cookie or API key) sees its account allowance; a
// signed-out caller sees the per-IP anonymous allowance it is metered on. The
// answer is read-only: nothing is consumed by asking. Counts come from
// free_tier_usage and the limits from app_settings['free_tier']
// (api/_lib/free-tier.js), the same numbers every message surface enforces.
//
// Response:
//   { limit, used, remaining, reset_at, anonymous, signed_in_limit, models }

import { cors, json, method, wrap } from '../../_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { clientIp } from '../../_lib/rate-limit.js';
import { getFreeTierStatus } from '../../_lib/free-tier.js';
import { freeRosterIds } from '../../_lib/model-roster.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET, OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id ?? bearer?.userId ?? null;

	const status = await getFreeTierStatus({ userId, ip: userId ? null : clientIp(req) });
	res.setHeader('cache-control', 'private, no-store');
	return json(res, 200, {
		limit: status.limit,
		used: status.used,
		remaining: status.remaining,
		reset_at: status.resetAt,
		anonymous: status.anonymous,
		signed_in_limit: status.signedInLimit,
		models: freeRosterIds(),
	});
});

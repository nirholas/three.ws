// POST /api/ops/event-market-override: an admin corrects or supplies a market result.
//
// Body: { market_id, action: 'set_winner' | 'void', winner_outcome_id?, reason }
// `reason` (20 to 1000 characters) is mandatory, logged in event_market_overrides and
// shown on the market page. After the override the rollup re-scores the market's
// picks from the new result. The default resolution path never needs this route.
// Points only: nothing here moves funds.

import { cors, json, method, wrap, error, rateLimited, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireAdmin } from '../_lib/admin.js';
import { isSameSiteOrigin } from '../_lib/auth.js';
import { applyOverride } from '../_lib/event-markets/override.js';
import { runRollup } from '../_lib/event-markets/rollup.js';
import { EventMarketError } from '../_lib/event-markets/errors.js';

export const maxDuration = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const admin = await requireAdmin(req, res);
	if (!admin) return;
	if (!isSameSiteOrigin(req)) return error(res, 403, 'forbidden', 'cross-site requests are not allowed');

	const body = await readJson(req);
	const marketId = String(body?.market_id || '').toLowerCase();
	if (!UUID_RE.test(marketId)) return error(res, 400, 'validation_error', 'market_id must be a market uuid.');

	try {
		const result = await applyOverride(marketId, admin.id, body);
		const rollup = await runRollup({ full: true });
		return json(res, 200, { ok: true, ...result, rollup });
	} catch (err) {
		if (err instanceof EventMarketError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});

/**
 * POST /api/growth/touch: record a browser's first marketing-campaign touch.
 *
 * Body {anon_id, campaign, source?, medium?, landing_path}. public/campaign-attribution.js
 * sends it once per browser when a page loads with a valid campaign tag. No auth,
 * rate limited per IP. The IP is used for the limiter only and is never stored.
 * A browser that already carries the tws_ct cookie keeps its first touch: a later
 * visit tagged with a different campaign is acknowledged and ignored.
 */

import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { validateTouch } from '../../public/campaign-attribution.js';
import { recordTouch, touchCookie, touchForRequest } from '../_lib/campaign-ledger.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.campaignTouchIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'too many campaign touches, slow down');

	const body = await readJson(req, 4_000).catch(() => null);
	const checked = validateTouch(body);
	if (!checked.ok) return error(res, 400, 'validation_error', checked.error);

	const existing = await touchForRequest(req);
	if (existing) return json(res, 200, { ok: true, recorded: false, campaign: existing.campaign });

	const touch = await recordTouch(checked.touch);
	res.setHeader('Set-Cookie', touchCookie(touch.anon_id));
	return json(res, 200, { ok: true, recorded: touch.created, campaign: touch.campaign });
});

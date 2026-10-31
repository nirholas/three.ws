// GET  /api/drops/:id  the drop, its gifts and live phase; plus `claim` for a signed-in viewer.
// POST /api/drops/:id  claim it (session cookie, same-site only). Idempotent.
//
// Rules live in api/_lib/seasonal-drops.js; this file is only the HTTP boundary.

import { getSessionUser, isSameSiteOrigin } from '../_lib/auth.js';
import { cors, json, error, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getDrop, publicDrop, claimedAt, claimDrop } from '../_lib/seasonal-drops.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const drop = getDrop(req.query?.id);
	if (!drop) return error(res, 404, 'not_found', 'no such drop');

	const now = Date.now();
	const session = await getSessionUser(req, res);

	if (req.method === 'GET') {
		const rl = await limits.authedReadIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		const body = publicDrop(drop, now);
		if (session) {
			const at = await claimedAt(session.id, drop);
			body.claim = { signedIn: true, claimed: !!at, claimedAt: at, username: session.username || null };
		} else {
			body.claim = { signedIn: false, claimed: false, claimedAt: null, username: null };
		}
		// Per-viewer when signed in; the phase also flips at a fixed instant.
		res.setHeader('cache-control', 'private, no-store');
		return json(res, 200, body);
	}

	if (!session) return error(res, 401, 'unauthorized', 'sign in to claim these gifts');
	if (!isSameSiteOrigin(req)) return error(res, 403, 'forbidden', 'cross-site request blocked');

	const rl = await limits.dropClaimUser(session.id);
	if (!rl.success) return rateLimited(res, rl);

	const result = await claimDrop(session.id, drop, now);
	if (!result.ok) {
		return result.reason === 'upcoming'
			? error(res, 409, 'drop_not_open', `This drop opens ${drop.startsAt}.`)
			: error(res, 410, 'drop_closed', 'This drop has closed. Its gifts were only claimable during the window.');
	}
	res.setHeader('cache-control', 'no-store');
	return json(res, 200, {
		...publicDrop(drop, now),
		claim: {
			signedIn: true,
			claimed: true,
			claimedAt: result.claimedAt,
			newlyClaimed: result.newlyClaimed,
			wearablesSynced: result.wearablesSynced,
			username: session.username || null,
		},
	});
});

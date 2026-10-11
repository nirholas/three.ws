// GET  /api/x/claim: what the X mention bot made for the signed-in user's linked X account
// POST /api/x/claim: move those creations into the user's library
//
// Only creations still owned by the system bot whose x_author_id equals the
// X id this user verified through OAuth are ever listed or moved
// (api/_lib/x-creation-claim.js).

import { getSessionUser } from '../_lib/auth.js';
import { cors, method, wrap, error, json } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { env } from '../_lib/env.js';
import { claimForUser, linkedXUid, listClaimable } from '../_lib/x-creation-claim.js';

function shape(row) {
	return {
		id: String(row.id),
		prompt: row.prompt,
		status: row.status,
		glb_url: row.glb_url || null,
		preview_image_url: row.preview_image_url || null,
		created_at: row.created_at,
		url: `/m/${row.id}`,
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'POST') {
		if (!(await requireCsrf(req, res, user.id))) return;
		const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 200) : null;
		const claimed = await claimForUser(user.id, { source: 'claim_page', ids });
		return json(res, 200, { claimed });
	}

	const link = await linkedXUid(user.id);
	const creations = link ? (await listClaimable(user.id)).map(shape) : [];
	return json(res, 200, {
		linked: Boolean(link),
		username: link?.username || null,
		x_configured: Boolean(env.X_OAUTH_CLIENT_ID && env.X_OAUTH_CLIENT_SECRET),
		creations,
	});
});

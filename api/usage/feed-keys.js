// /api/usage/feed-keys: manage the read-only keys for the OData usage feed
// (api/odata/v1.js) that Power BI and Excel connect with.
//
//   GET    /api/usage/feed-keys            { keys, teams, feed_url, max_keys }
//   POST   /api/usage/feed-keys            { name, team_id? } -> 201 { key, token }
//                                          token is shown once and never stored
//   DELETE /api/usage/feed-keys?id=<uuid>  revoke a key, effective on its next request
//
// A browser session is required (minting a credential is a person's action,
// not a script's), plus a CSRF token on writes. `teams` lists the teams the
// caller owns, the only teams a key can be bound to.

import { cors, method, json, error, wrap, readJson, rateLimited } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import {
	FeedKeyError, MAX_ACTIVE_KEYS, listFeedKeys, listOwnedTeams, createFeedKey, revokeFeedKey,
} from '../_lib/usage-feed.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		const [keys, teams] = await Promise.all([listFeedKeys(user.id), listOwnedTeams(user.id)]);
		return json(res, 200, {
			keys,
			teams,
			feed_url: `${env.APP_ORIGIN}/api/odata/v1/`,
			max_keys: MAX_ACTIVE_KEYS,
		}, { 'cache-control': 'no-store' });
	}

	const body = req.method === 'POST' ? await readJson(req) : null;
	if (!(await requireCsrf(req, res, user.id))) return;

	try {
		if (req.method === 'POST') {
			const rl = await limits.usageFeedKeyWrite(user.id);
			if (!rl.success) return rateLimited(res, rl, 'too many feed keys created: try again later');
			const { key, token } = await createFeedKey({ userId: user.id, name: body?.name, teamId: body?.team_id ?? null, req });
			return json(res, 201, { key, token }, { 'cache-control': 'no-store' });
		}
		const id = new URL(req.url, 'http://local').searchParams.get('id');
		await revokeFeedKey({ userId: user.id, id, req });
		return json(res, 200, { ok: true });
	} catch (e) {
		if (e instanceof FeedKeyError) return error(res, e.status, e.code, e.message);
		throw e;
	}
});

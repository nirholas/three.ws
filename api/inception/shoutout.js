// POST /api/inception/shoutout { program?, url }
//
// An approved member submits the link to a public post about three.ws on X or
// LinkedIn. A reviewer confirms it is live, public and about the product, then
// pays the bonus (scripts/inception-review.mjs). The credit is never paid from
// this endpoint: submitting only queues the post for review.

import { getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, wrap, readJson, rateLimited, respondError } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { submitShoutout, resolveProgram } from '../_lib/inception.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'Sign in to submit a shoutout.');

	const body = await readJson(req).catch(() => null);
	if (!body || typeof body !== 'object') return error(res, 400, 'bad_request', 'Send a JSON body.');

	const program = resolveProgram(body.program);
	if (!program) return error(res, 400, 'unknown_program', 'Unknown program.');

	try {
		const row = await submitShoutout(user.id, program.id, body.url);
		return json(res, 201, { shoutout: { status: row.shoutout_status, url: row.shoutout_url } });
	} catch (err) {
		return respondError(res, err.status || 500, err.code || 'shoutout_failed', err);
	}
});

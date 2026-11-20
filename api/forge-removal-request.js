/**
 * POST /api/forge-removal-request: ask for a published 3D model to be taken down.
 *
 *   { creation_id, reason, details?, contact? }  →  201 { ok, id }
 *
 *   reason   my_content | copyright | likeness | harmful | other
 *   details  required (10+ chars) for every reason but my_content
 *   contact  optional email for the reviewer's reply; never shown publicly
 *
 * For the cases an owner credential cannot cover (issue #639): a maker who lost
 * the browser id and the manage token, a rights holder whose character someone
 * else uploaded, a person whose likeness became a model. Owners with a
 * credential delete directly with DELETE /api/forge-creation instead.
 *
 * Open to anonymous callers on purpose: the person asking is often not the one
 * who forged the model. An operator reviews every request from a workstation
 * with `npm run forge:removals` (there is no admin endpoint to attack). A
 * second request from the same person on the same model answers 200
 * { duplicate: true } and keeps the first.
 */

import { cors, error, json, method, rateLimited, readJson, wrap } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { getSessionUser } from './_lib/auth.js';
import { isDbUnavailableError } from './_lib/db.js';
import { fileRemovalRequest, normalizeRemovalRequest, reporterKey } from './_lib/forge-removal-requests.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req, res).catch(() => null);
	const ip = clientIp(req);
	const rl = await limits.forgeRemovalWrite(user?.id || ip);
	if (!rl.success) return rateLimited(res, rl, 'Too many removal requests from here. Try again in an hour.');

	const body = await readJson(req, 16_000).catch(() => null);
	const parsed = normalizeRemovalRequest(body);
	if (!parsed.ok) return error(res, 400, 'validation_error', parsed.message, { field: parsed.field });

	try {
		const out = await fileRemovalRequest({
			creationId: parsed.creationId,
			reason: parsed.reason,
			details: parsed.details,
			contact: parsed.contact,
			reporterUserId: user?.id ?? null,
			reporterKey: reporterKey(user?.id ? `user:${user.id}` : `ip:${ip}`),
		});
		if (out.notFound) return error(res, 404, 'not_found', 'No model with that id. It may already have been removed.');
		if (out.duplicate) return json(res, 200, { ok: true, duplicate: true, message: 'Your earlier request on this model is still open. A reviewer will act on it.' });
		return json(res, 201, { ok: true, id: out.request.id, message: 'Request received. A reviewer will look at it soon.' });
	} catch (err) {
		if (isDbUnavailableError(err)) {
			return error(res, 503, 'store_unavailable', 'We could not file that just now. Try again in a moment.');
		}
		throw err;
	}
});

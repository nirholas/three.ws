// /api/inception/apply: the NVIDIA Inception member perk intake.
//
//   GET   the caller's latest application (or { application: null })
//   POST  { company, website, contact_email, inception_ref?, use_case }
//
// Signed-in only (the grant lands in the account's prepaid wallet). Approval is a
// manual review (scripts/inception-review.mjs); see api/_lib/inception.js.

import { getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, wrap, readJson, rateLimited, respondError } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import {
	validateApplication,
	submitApplication,
	latestApplication,
	DEFAULT_GRANT_USD,
} from '../_lib/inception.js';

function publicApplication(row) {
	if (!row) return null;
	return {
		id: row.id,
		company: row.company,
		status: row.status,
		grant_usd: row.grant_usd == null ? null : Number(row.grant_usd),
		reviewer_note: row.reviewer_note || null,
		created_at: row.created_at,
		reviewed_at: row.reviewed_at || null,
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'Sign in to apply for the Inception perk.');

	if (req.method === 'GET') {
		const row = await latestApplication(user.id);
		return json(res, 200, { application: publicApplication(row), default_grant_usd: DEFAULT_GRANT_USD });
	}

	const body = await readJson(req).catch(() => null);
	if (!body || typeof body !== 'object') return error(res, 400, 'bad_request', 'Send a JSON body.');

	const parsed = validateApplication(body);
	if (parsed.errors) {
		return error(res, 422, 'validation_failed', 'Fix the highlighted fields and submit again.', {
			fields: parsed.errors,
		});
	}

	try {
		const row = await submitApplication(user.id, parsed.value);
		return json(res, 201, { application: publicApplication({ ...row, company: parsed.value.company }) });
	} catch (err) {
		return respondError(res, err.status || 500, err.code || 'apply_failed', err);
	}
});

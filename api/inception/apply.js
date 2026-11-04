// /api/inception/apply: the partner startup-program perk intake.
//
//   GET   ?program=<id>  the caller's latest application for that program, the
//                        program's grant and bonus, and the pre-filled post text
//   POST  { program?, company, website, contact_email, inception_ref?, use_case }
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
	resolveProgram,
	shoutoutDraft,
} from '../_lib/inception.js';

function num(value) {
	return value == null ? null : Number(value);
}

function publicApplication(row) {
	if (!row) return null;
	return {
		id: row.id,
		program: row.program,
		company: row.company,
		status: row.status,
		grant_usd: num(row.grant_usd),
		reviewer_note: row.reviewer_note || null,
		created_at: row.created_at,
		reviewed_at: row.reviewed_at || null,
		shoutout: {
			status: row.shoutout_status || 'none',
			url: row.shoutout_url || null,
			bonus_usd: num(row.shoutout_bonus_usd),
			note: row.shoutout_note || null,
		},
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'Sign in to apply.');

	const query = new URL(req.url, 'http://x').searchParams;

	if (req.method === 'GET') {
		const program = resolveProgram(query.get('program'));
		if (!program) return error(res, 400, 'unknown_program', 'Unknown program.');
		const row = await latestApplication(user.id, program.id);
		return json(res, 200, {
			program: {
				id: program.id,
				label: program.label,
				grant_usd: program.grantUsd,
				shoutout_bonus_usd: program.shoutoutBonusUsd,
			},
			application: publicApplication(row),
			shoutout_draft: shoutoutDraft(program.id),
		});
	}

	const body = await readJson(req).catch(() => null);
	if (!body || typeof body !== 'object') return error(res, 400, 'bad_request', 'Send a JSON body.');

	const program = resolveProgram(body.program);
	if (!program) return error(res, 400, 'unknown_program', 'Unknown program.');

	const parsed = validateApplication(body);
	if (parsed.errors) {
		return error(res, 422, 'validation_failed', 'Fix the highlighted fields and submit again.', {
			fields: parsed.errors,
		});
	}

	try {
		const row = await submitApplication(user.id, parsed.value, program.id);
		return json(res, 201, {
			application: publicApplication({ ...row, company: parsed.value.company }),
		});
	} catch (err) {
		return respondError(res, err.status || 500, err.code || 'apply_failed', err);
	}
});

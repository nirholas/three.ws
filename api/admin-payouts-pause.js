// @ts-check
// Payout kill switch: GET /api/admin-payouts-pause, POST /api/admin-payouts-pause
//
//   GET  -> { paused, reason, source }            current state
//   POST { paused: boolean, reason?: string }     flip it, audited
//
// Admin only (requireAdmin runs before anything else), and the mutation also
// needs the double-submit CSRF token. Every flip lands in audit_log as
// payouts.pause or payouts.resume with the operator and reason. Runbook:
// docs/financial-controls.md "Payout kill switch".

import { cors, error, json, method, readJson, wrap } from './_lib/http.js';
import { requireAdmin } from './_lib/admin.js';
import { requireCsrf } from './_lib/csrf.js';
import { payoutsPauseState, setPayoutsPaused } from './_lib/payout-kill-switch.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const admin = await requireAdmin(req, res);
	if (!admin) return;

	if (req.method === 'GET') return json(res, 200, await payoutsPauseState());

	if (!(await requireCsrf(req, res, admin.id))) return;
	const body = await readJson(req);
	if (typeof body.paused !== 'boolean') {
		return error(res, 400, 'validation_error', 'paused must be a boolean');
	}
	if (body.reason != null && typeof body.reason !== 'string') {
		return error(res, 400, 'validation_error', 'reason must be a string');
	}
	if (body.paused && !String(body.reason || '').trim()) {
		return error(res, 400, 'validation_error', 'a reason is required when pausing payouts');
	}
	const out = await setPayoutsPaused({
		paused: body.paused,
		reason: body.reason ? body.reason.trim() : null,
		userId: admin.id,
		req,
	});
	return json(res, 200, { ...out, source: 'flag' });
});

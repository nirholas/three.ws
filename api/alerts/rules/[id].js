// PATCH  /api/alerts/rules/:id — update a rule.
// DELETE /api/alerts/rules/:id — delete a rule (cascades fires + delivery log).
//
// Part of the server-side multi-rule alert model (Task 04). Ownership is
// enforced on every operation: a user can only touch their own rules.

import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { limits } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { updateAlertRule, deleteAlertRule, AlertRuleError } from '../../_lib/pump-alert-rules.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'PATCH,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['PATCH', 'DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const id = req.query?.id;
	if (!id || !isUuid(id)) return error(res, 400, 'validation_error', 'valid rule id required');

	const rl = await limits.prefsWrite(user.id);
	if (!rl.success) return rateLimited(res, rl);
	if (!(await requireCsrf(req, res, user.id))) return;

	if (req.method === 'DELETE') {
		const deleted = await deleteAlertRule(user.id, id);
		if (!deleted) return error(res, 404, 'not_found', 'rule not found');
		return json(res, 200, { ok: true, id: deleted });
	}

	try {
		const rule = await updateAlertRule(user.id, id, await readJson(req));
		if (!rule) return error(res, 404, 'not_found', 'rule not found');
		return json(res, 200, { rule });
	} catch (err) {
		if (err instanceof AlertRuleError) return error(res, err.status, err.code, err.message, err.issues ? { issues: err.issues } : undefined);
		throw err;
	}
});

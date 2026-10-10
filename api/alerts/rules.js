// GET  /api/alerts/rules — list the signed-in user's pump alert rules.
// POST /api/alerts/rules — create a new rule.
//
// Server-persisted, multi-rule alert model (Task 04). Rules are evaluated by the
// pumpfun-monitor cron against the live pump.fun event stream, so they fire
// across devices even with no dashboard tab open. The frontend treats
// localStorage as a render cache only; these endpoints are the source of truth.

import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { listAlertRules, createAlertRule, AlertRuleError } from '../_lib/pump-alert-rules.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		const rl = await limits.notificationsRead(user.id);
		if (!rl.success) return rateLimited(res, rl);
		return json(res, 200, { rules: await listAlertRules(user.id) });
	}

	// POST: create
	const rl = await limits.prefsWrite(user.id);
	if (!rl.success) return rateLimited(res, rl);
	if (!(await requireCsrf(req, res, user.id))) return;

	try {
		return json(res, 201, { rule: await createAlertRule(user.id, await readJson(req)) });
	} catch (err) {
		if (err instanceof AlertRuleError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});

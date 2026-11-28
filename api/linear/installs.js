// The Linear workspaces the signed-in account installed the agent into.
//
//   GET    /api/linear/installs                 -> { installs: [...] }  newest first, removed ones included
//   DELETE /api/linear/installs?org=<org id>    -> { ok, installs }     revoke at Linear and remove
//
// Rendered on /integrations/linear (src/integrations-linear.js).

import { getRequestUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { listLinearInstalls, disconnectLinearInstall } from '../_lib/linear-installs.js';

const ORG_ID = /^[0-9a-f-]{36}$/i;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'DELETE'])) return;
	const user = await getRequestUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') return json(res, 200, { installs: await listLinearInstalls(user.id) }, { 'cache-control': 'no-store' });

	if (!(await requireCsrf(req, res, user.id))) return;
	const rl = await limits.linearInstallWrite(user.id);
	if (!rl.success) return rateLimited(res, rl);
	const org = String(req.query?.org || '');
	if (!ORG_ID.test(org)) return error(res, 400, 'validation_error', 'a Linear workspace id is required');
	if (!(await disconnectLinearInstall(user.id, org))) return error(res, 404, 'not_found', 'That workspace is not connected to your account, or was already removed.');
	return json(res, 200, { ok: true, installs: await listLinearInstalls(user.id) });
});

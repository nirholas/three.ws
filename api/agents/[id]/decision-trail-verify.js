// GET /api/agents/:id/decision-trail/verify - re-walk an agent's hash-chained
// decision trail and report the first broken index. Public, no-store. Same report
// as /api/ledger/verify/:agentId, addressed under the agent.

import { json, method, wrap, error } from '../../_lib/http.js';
import { buildVerifyReport } from '../../_lib/ledger-verify.js';
import { isUuid } from '../../_lib/validate.js';

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	const id = String(req.query?.id || '');
	if (!isUuid(id)) return error(res, 400, 'bad_request', 'a valid agent id is required');
	return json(res, 200, await buildVerifyReport(id), { 'cache-control': 'no-store' });
});

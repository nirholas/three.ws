// GET /api/ledger/verify/:agentId - independently re-verify an agent's reasoning
// ledger. Public. This is the whole point of the feature: anyone can prove the
// history wasn't backdated or quietly edited. See api/_lib/ledger-verify.js for
// how the chain and the on-chain anchor are checked.

import { json, method, wrap, error } from '../../_lib/http.js';
import { buildVerifyReport } from '../../_lib/ledger-verify.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function paramAgentId(req) {
	if (req.query?.agentId) return String(req.query.agentId);
	const m = String(req.url || '').match(/\/api\/ledger\/verify\/([^/?]+)/);
	return m ? decodeURIComponent(m[1]) : null;
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	const agentId = paramAgentId(req);
	if (!agentId || !UUID_RE.test(agentId)) {
		return error(res, 400, 'bad_request', 'a valid agent id is required');
	}
	return json(res, 200, await buildVerifyReport(agentId), { 'cache-control': 'no-store' });
});

// @ts-check
// GET /api/ops/growth-programs: the dry-run board for the trading growth
// programs (docs/growth-programs.md).
//
// Shows, on live data, exactly what each disarmed program would do right now:
// the big win the X lane would post and its exact text, every account the
// first-rug softener evaluated with the criteria each one failed, and the
// early-leader standings with the slot assignment. Read-only: this endpoint
// never posts, never writes a ledger row, never signs.
//
// Auth: authorizeOps (admin session, or x-ops-secret), the same gate as the
// other /api/ops boards. It names wallets and per-account outcomes, so it is
// never public.

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { respondMfaRequired } from '../_lib/admin-mfa.js';
import { growthProgramsReport } from '../_lib/growth-programs/index.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const auth = await authorizeOps(req);
	if (auth.mfaRequired) return respondMfaRequired(res);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'ops access required');

	const report = await growthProgramsReport();
	return json(res, 200, { ok: true, actor: auth.actor, ...report }, { 'cache-control': 'no-store' });
});

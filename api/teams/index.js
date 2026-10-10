// /api/teams: the caller's specialist teams.
//
// GET  /api/teams                         teams the caller owns (not archived)
// POST /api/teams { name, description?, network?, policy?, is_public? }
//      creates a team and provisions its four role agents (Researcher, Entry,
//      Trader, Launcher), each a full three.ws agent with a 3D body, wallet and
//      public page. A provisioning failure answers with the team id so the
//      owner can repair it from /teams/:id.
//
// Creating a team moves no funds, so it needs a signed-in account, a CSRF token
// for cookie sessions, and the team write budget, but no real-funds agreement.

import { cors, method, json, error, wrap, readJson, rateLimited } from '../_lib/http.js';
import { resolveAccount } from '../_lib/account-auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { TeamError } from '../_lib/teams/roles.js';
import { createTeam, listTeamsForUser, loadTeamFor, getTeamView } from '../_lib/teams/runtime.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = await resolveAccount(req, res);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		const data = await listTeamsForUser(auth.userId);
		return json(res, 200, { data }, { 'cache-control': 'no-store' });
	}

	const body = await readJson(req);
	if (!(await requireCsrf(req, res, auth.userId))) return;
	const rl = await limits.teamWrite(auth.userId);
	if (!rl.success) return rateLimited(res, rl, 'too many team changes: slow down');

	try {
		const row = await createTeam({
			userId: auth.userId,
			name: body?.name,
			description: body?.description ?? null,
			network: body?.network,
			policy: body?.policy || {},
			isPublic: body?.is_public === true,
		});
		const { team, isOwner } = await loadTeamFor(row.id, auth.userId);
		return json(res, 201, { data: await getTeamView(team, { isOwner }) });
	} catch (e) {
		if (e instanceof TeamError) return error(res, e.status, e.code, e.message, e.detail ? { detail: e.detail } : {});
		throw e;
	}
});

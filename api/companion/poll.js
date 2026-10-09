// POST /api/companion/poll - "check now" for every connected source.
//
// The cron already sweeps on a schedule (api/cron/companion-poll.js); this is
// the button on the setup page, so a user who just connected something sees it
// work in the same breath rather than waiting for the next tick.

import { cors, json, method, wrap, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { pollUser } from '../_lib/companion/poll.js';
import { companionCaller, needsCsrf } from '../_lib/companion/caller.js';

export const maxDuration = 60;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// The bridge token reaches this route: it is the credential the desktop app,
	// the CLI and the MCP server hold. It resolves to its owner only.
	const user = await companionCaller(req, res, { bridge: true });
	if (!user) return;
	if (needsCsrf(user) && !(await requireCsrf(req, res, user.id))) return;

	const rl = await limits.companionPoll(user.id);
	if (!rl.success) return rateLimited(res, rl);

	return json(res, 200, await pollUser(user.id));
});

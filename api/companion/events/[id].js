// PATCH /api/companion/events/:id { delivered?, dismissed? }
//
// The companion marks an event delivered once it has actually said it out loud,
// so a message spoken on a laptop is not repeated by the phone an hour later.

import { z } from 'zod';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { limits } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { markEvent } from '../../_lib/companion/store.js';
import { companionCaller, needsCsrf } from '../../_lib/companion/caller.js';

const patchBody = z.object({
	delivered: z.boolean().optional(),
	dismissed: z.boolean().optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'PATCH,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['PATCH'])) return;

	// The bridge token reaches this route: it is the credential the desktop app,
	// the CLI and the MCP server hold. It resolves to its owner only.
	const user = await companionCaller(req, res, { bridge: true });
	if (!user) return;
	if (needsCsrf(user) && !(await requireCsrf(req, res, user.id))) return;

	const rl = await limits.companionRead(user.id);
	if (!rl.success) return rateLimited(res, rl);

	const id = String(req.query?.id || '').trim();
	if (!/^[0-9a-f-]{36}$/i.test(id)) return error(res, 400, 'validation_error', 'invalid event id');

	const body = parse(patchBody, await readJson(req));
	const row = await markEvent(user.id, id, { delivered: body.delivered === true, dismissed: body.dismissed === true });
	if (!row) return error(res, 404, 'not_found', 'no such event');
	return json(res, 200, { event: row });
});

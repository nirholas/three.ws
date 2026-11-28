// Basecamp chatbot command URLs for the signed-in account.
//
//   GET    /api/basecamp/chatbots              → { chatbots: [...] }  newest first, revoked included
//   POST   /api/basecamp/chatbots  { label }   → { chatbot, command_url }  the URL is shown this once
//   DELETE /api/basecamp/chatbots?id=<uuid>    → { ok, chatbots }  revoke one
//
// The dashboard panel is src/dashboard-next/pages/settings-basecamp.js; the
// command URL itself is served by api/basecamp/command.js.

import { z } from 'zod';
import { getRequestUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { selfOrigin } from '../_lib/self-origin.js';
import { ChatbotLimitError, LABEL_MAX, commandUrl, createChatbot, listChatbots, revokeChatbot } from '../_lib/basecamp-chatbots.js';

const postBody = z.object({ label: z.string().max(LABEL_MAX * 4).optional() });
const UUID = z.string().uuid();

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const user = await getRequestUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') return json(res, 200, { chatbots: await listChatbots(user.id) }, { 'cache-control': 'no-store' });

	if (!(await requireCsrf(req, res, user.id))) return;
	const rl = await limits.basecampChatbotWrite(user.id);
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'DELETE') {
		const id = UUID.safeParse(String(req.query?.id || ''));
		if (!id.success) return error(res, 400, 'validation_error', 'a chatbot id is required');
		if (!(await revokeChatbot(user.id, id.data))) return error(res, 404, 'not_found', 'That command URL does not exist or was already revoked.');
		return json(res, 200, { ok: true, chatbots: await listChatbots(user.id) });
	}

	const { label } = parse(postBody, (await readJson(req)) || {});
	try {
		const { chatbot, token } = await createChatbot(user.id, { label });
		return json(res, 201, { chatbot, command_url: commandUrl(selfOrigin(req), token) }, { 'cache-control': 'no-store' });
	} catch (err) {
		if (err instanceof ChatbotLimitError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});

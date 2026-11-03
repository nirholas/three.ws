// GET /api/mcp-connections/callback: the OAuth redirect target for external MCP
// servers. The authorization server sends the owner's browser here with
// `code` and `state`. The state finds the connection (single use, ten minutes),
// the signed-in session must be the connection's owner, and the browser is sent
// back to the page that started the flow with `mcp_connected` or `mcp_error`.

import { getSessionUser } from '../_lib/auth.js';
import { method, redirect, wrap } from '../_lib/http.js';
import { completeAuth } from '../_lib/mcp-connections/service.js';

export default wrap(async function handler(req, res) {
	if (!method(req, res, ['GET'])) return;
	const q = new URL(req.url, 'http://internal').searchParams;
	const session = await getSessionUser(req);
	const to = await completeAuth({
		state: q.get('state'),
		code: q.get('code'),
		error: q.get('error'),
		sessionUserId: session?.id || null,
	});
	res.setHeader('cache-control', 'no-store');
	res.setHeader('referrer-policy', 'no-referrer');
	return redirect(res, to);
});

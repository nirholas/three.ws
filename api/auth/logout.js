import { destroySession, sessionCookie } from '../_lib/auth.js';
import { cors, json, method, wrap } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	await destroySession(req);
	res.setHeader('set-cookie', sessionCookie('', { clear: true }));
	return json(res, 200, { ok: true });
});

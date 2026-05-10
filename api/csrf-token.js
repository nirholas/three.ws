// GET /api/csrf-token — issue a single-use CSRF token bound to the session user.
import { authenticateBearer, extractBearer, getSessionUser } from './_lib/auth.js';
import { cors, error, json, method, wrap } from './_lib/http.js';
import { issueCsrf } from './_lib/csrf.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id || bearer?.userId;
	if (!userId) return error(res, 401, 'unauthorized', 'sign in required');

	const { token, expiresIn } = await issueCsrf(userId);
	return json(res, 200, { data: { token, expires_in: expiresIn } });
});

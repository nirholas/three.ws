// /api/build/submissions - the signed-in user's Build entries.
//
//   GET  ?round=<slug>   your submissions
//   POST                  { roundId, trackId, agentId, title, summary, repoUrl?, demoUrl?, launchMint? }
//
// One live submission per user per round; the agent must be yours; a launch
// mint must be a coin that agent launched through three.ws. Cookie sessions
// need the CSRF token, bearer callers are exempt.

import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { BuildError, createSubmission, listMySubmissions, resolveRound, submissionSchema } from '../_lib/build-program.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	return bearer ? { userId: bearer.userId } : null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'Sign in to enter the Build program.');

	if (req.method === 'GET') {
		const ref = new URL(req.url, 'http://localhost').searchParams.get('round');
		const round = ref ? await resolveRound(ref) : null;
		if (ref && !round) return error(res, 404, 'round_not_found', 'That round does not exist.');
		return json(res, 200, { submissions: await listMySubmissions(auth.userId, round?.id ?? null) });
	}

	if (!(await requireCsrf(req, res, auth.userId))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = await readJson(req).catch(() => null);
	const parsed = submissionSchema.safeParse(body);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return error(res, 400, 'validation_error', `${first.path.join('.') || 'body'}: ${first.message}`);
	}
	try {
		json(res, 201, { submission: await createSubmission(auth.userId, parsed.data) });
	} catch (err) {
		if (err instanceof BuildError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});

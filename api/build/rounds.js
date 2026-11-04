// GET /api/build/rounds - three.ws Build program rounds.
//
//   (no params)     every published round, the open one first
//   ?round=<slug>   one round with its public submissions

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { listRounds, resolveRound, listPublicSubmissions } from '../_lib/build-program.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const ref = new URL(req.url, 'http://localhost').searchParams.get('round');
	res.setHeader('cache-control', 'public, max-age=30, stale-while-revalidate=120');
	if (!ref) return json(res, 200, { rounds: await listRounds() });

	const round = await resolveRound(ref);
	if (!round) return error(res, 404, 'round_not_found', 'That round does not exist.');
	json(res, 200, { round, submissions: await listPublicSubmissions(round.id) });
});

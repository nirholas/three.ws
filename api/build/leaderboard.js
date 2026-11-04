// GET /api/build/leaderboard?round=<slug> - activity ranking for a Build round
// (volume, calls served, launches), recomputed by /api/cron/build-leaderboard.
// Without `round` it ranks the open round, or the latest one.

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { parseLimit } from '../_lib/http-params.js';
import { resolveRound, leaderboardFor } from '../_lib/build-program.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const p = new URL(req.url, 'http://localhost').searchParams;
	const round = await resolveRound(p.get('round'));
	if (!round) return error(res, 404, 'round_not_found', p.get('round') ? 'That round does not exist.' : 'There are no Build rounds yet.');

	const entries = await leaderboardFor(round.id, { limit: parseLimit(p, { fallback: 50, max: 200 }) });
	res.setHeader('cache-control', 'public, max-age=30, stale-while-revalidate=120');
	json(res, 200, {
		round: { id: round.id, slug: round.slug, title: round.title, status: round.status, endsAt: round.endsAt },
		formula: 'score = volume in USDC + 5 per paid call served + 25 per coin launched, counted inside the round window',
		computedAt: round.statsComputedAt,
		entries,
	});
});

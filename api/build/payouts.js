// GET /api/build/payouts?round=<slug> - the prize and buyback ledger for a
// round. Read-only: a payout row records the exact recipient, amount and token
// and nothing is signed until the owner confirms that row. Confirm tokens and
// full recipient addresses are never returned.

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { resolveRound, listPayouts } from '../_lib/build-program.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const round = await resolveRound(new URL(req.url, 'http://localhost').searchParams.get('round'));
	if (!round) return error(res, 404, 'round_not_found', 'There is no such Build round.');
	res.setHeader('cache-control', 'public, max-age=30');
	json(res, 200, { round: { id: round.id, slug: round.slug, title: round.title }, buybackBps: round.buybackBps, payouts: await listPayouts(round.id) });
});

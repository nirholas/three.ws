// GET /api/pump/pairs: the quote assets a pump.fun launch can pair with.
//
// Public read. Every pair carries its live status (SOL is native; a stable or
// exotic mint is `live` only while the program admits it), the fee schedule a
// fresh curve on that quote pays, and the creator-fee range the creator may
// pick from (platform config intersected with what the program allows). The
// numbers come from chain state via api/_lib/pump-launch-pairs.js, never from a
// constant in this file.
//
//   GET /api/pump/pairs?network=mainnet|devnet   (default mainnet)
//   GET /api/pump/pairs?fresh=1                  bypass the one-minute cache
//   GET /api/pump/pairs?creator_fee_bps=250      add an earnings projection per pair

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { listLaunchPairs, earningsProjection } from '../_lib/pump-launch-pairs.js';

export default wrap(async (req, res) => {
	cors(req, res, { methods: 'GET,OPTIONS' });
	if (req.method === 'OPTIONS') return res.end();
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const network = String(req.query?.network || 'mainnet').toLowerCase();
	if (network !== 'mainnet' && network !== 'devnet') return error(res, 400, 'validation_error', 'network must be mainnet or devnet');
	const fresh = req.query?.fresh === '1' || req.query?.fresh === 'true';

	let projectBps = null;
	if (req.query?.creator_fee_bps != null && req.query.creator_fee_bps !== '') {
		projectBps = Number(req.query.creator_fee_bps);
		if (!Number.isInteger(projectBps) || projectBps < 0 || projectBps > 10_000) return error(res, 400, 'validation_error', 'creator_fee_bps must be an integer between 0 and 10000');
	}

	const listing = await listLaunchPairs({ network, fresh });
	const pairs = listing.pairs.map((pair) => {
		const rule = pair.creator_fee || {};
		const bps = projectBps ?? (rule.configurable ? rule.default_bps : rule.fixed_bps);
		return {
			...pair,
			earnings: bps == null ? null : earningsProjection({ bps, quoteSymbol: pair.symbol, kind: pair.kind }),
		};
	});

	return json(
		res,
		200,
		{ ...listing, pairs, intents_api: '/api/pump/launch-intents', page: '/launch/intents' },
		{ 'cache-control': listing.status === 'ok' ? 'public, max-age=30, s-maxage=30' : 'no-store' },
	);
});

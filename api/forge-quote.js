/**
 * /api/forge-quote: what a Forge generation would cost, before any spend.
 *
 *   GET /api/forge-quote?tier=high&path=image&backend=trellis2&images=1&gameready=1
 *     -> one quote (see api/_lib/forge-quote.js)
 *   GET /api/forge-quote?table=1&path=image
 *     -> { quotes: [draft, standard, high] } for the composer's tier picker
 *
 * Public, read-only and spend-free: it signs nothing, charges nothing and touches
 * no wallet. Every price is read from the tables the generation endpoint enforces
 * (forge-tiers.js, pricing/catalog.js), so a quote cannot drift from the charge.
 * `keep.enabled` reports whether pay-to-keep (api/forge-keep.js) is switched on.
 */

import { cors, json, method, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { requestTerritory } from './_lib/forge-territory.js';
import { buildForgeQuote, buildForgeQuoteTable } from './_lib/forge-quote.js';
import { PATHS, TIER_IDS, BACKENDS } from './_lib/forge-tiers.js';

const FLAG = new Set(['1', 'true', 'yes', 'on']);

function flag(sp, name) {
	return FLAG.has((sp.get(name) || '').toLowerCase());
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const sp = new URL(req.url, 'http://localhost').searchParams;
	const path = sp.get('path') || undefined;
	const tier = sp.get('tier') || undefined;
	const backend = sp.get('backend') || undefined;

	if (path && !PATHS.includes(path)) {
		return json(res, 400, { error: 'invalid_path', message: `path must be one of ${PATHS.join(', ')}.` });
	}
	if (tier && !TIER_IDS.includes(tier)) {
		return json(res, 400, { error: 'invalid_tier', message: `tier must be one of ${TIER_IDS.join(', ')}.` });
	}
	if (backend && !BACKENDS[backend]) {
		return json(res, 400, {
			error: 'invalid_backend',
			message: 'Unknown engine. GET /api/forge?catalog lists the engine ids.',
		});
	}

	const opts = {
		path,
		backend,
		userImages: flag(sp, 'images'),
		ownKey: flag(sp, 'own_key'),
		gameready: flag(sp, 'gameready'),
		country: requestTerritory(req),
	};

	// The answer depends on the caller's region (territory routing) and on live env,
	// so it is cacheable by the browser only, never by a shared edge.
	const headers = { 'cache-control': 'private, max-age=30' };
	if (flag(sp, 'table')) {
		return json(res, 200, { quotes: buildForgeQuoteTable(opts) }, headers);
	}
	return json(res, 200, buildForgeQuote({ ...opts, tier }), headers);
});

/**
 * GET /api/event-market-og?m=<slug or id>[&pick=<outcome id>]
 *
 * The Event Markets share card: SVG 1200x630 rendered from the live market, so the
 * picture that unfurls on X shows the odds the page is showing right now. With
 * `pick`, the headline becomes "Pick <Name> to win" for challenge links.
 * Modeled on api/arena-og.js. An unknown market still returns a branded card.
 */

import { cors, wrap } from './_lib/http.js';
import { getMarket } from './_lib/event-markets/index.js';
import { cardSvg, fallbackSvg } from './_lib/event-market-card.js';

const CACHE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=600';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
	const ref = (url.searchParams.get('m') || '').trim().slice(0, 100);
	const pickId = (url.searchParams.get('pick') || '').trim().slice(0, 40) || null;

	const view = ref ? await getMarket(ref).catch(() => null) : null;
	res.statusCode = 200;
	res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
	if (!view) {
		res.setHeader('cache-control', 'public, max-age=300, s-maxage=3600');
		return res.end(fallbackSvg());
	}
	res.setHeader('cache-control', CACHE);
	res.end(cardSvg(view, { pickId }));
});

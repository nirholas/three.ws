// GET /api/trenches?view=overview|tokens|launches|wallets|health
// ---------------------------------------------------------------------------
// Read-only proxy to the standalone `services/pulse` market-intelligence
// service (launch firehose, runners, wallet scores for the Solana and
// Robinhood Chain trenches). Pulse holds long-lived Solana WebSockets and a
// Postgres archive, so it runs as its own always-on service; set `PULSE_URL`
// to it. Views are an allowlist and only whitelisted query params are
// forwarded. No fabricated fallback: unconfigured or unreachable upstream with
// no earlier real answer is a 503 `pulse_offline` and the UI renders its
// offline state.
//
// Last-known-good: every real answer is mirrored in the shared cache. When
// Pulse fails, or is still working after REFRESH_BUDGET_MS (2026-11-25: one
// instance stalled for ~50s and the whole page went offline), the mirror is
// served marked `x-trenches-stale: 1` with its `x-trenches-as-of` time and
// `no-store`, while the slow refresh keeps running and updates the mirror when
// it lands. Mirrors expire after STALE_TTL_S, so an outage longer than that
// still reads as offline instead of as old numbers.

import { cors, json, method, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { cacheWrapLastGood } from './_lib/cache.js';

// Upper bound on one Pulse request. Generous so a slow answer still lands and
// refreshes the mirror; callers with a mirror are released at the budget.
const TIMEOUT_MS = 15_000;
const REFRESH_BUDGET_MS = 4_000;
const STALE_TTL_S = 3600;

const VIEWS = {
	overview: { path: '/api/overview', params: [], ttl: 15 },
	health: { path: '/api/health', params: [], ttl: 10 },
	tokens: {
		path: '/api/tokens',
		params: ['chain', 'status', 'category', 'launchpad', 'tech', 'minMcap', 'minVolume', 'q', 'sort', 'limit', 'offset'],
		ttl: 30,
	},
	launches: { path: '/api/launches', params: ['chain', 'kind', 'limit'], ttl: 10 },
	wallets: { path: '/api/wallets', params: ['kind'], ttl: 60 },
};

const offline = (res, description) =>
	json(res, 503, { error: 'pulse_offline', error_description: description }, { 'cache-control': 'no-store' });

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.marketDataIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://local');
	const view = VIEWS[url.searchParams.get('view') || 'overview'];
	if (!view) {
		return json(res, 400, { error: 'invalid_view', error_description: `view must be one of ${Object.keys(VIEWS).join(', ')}` });
	}

	const base = process.env.PULSE_URL;
	if (!base) return offline(res, 'Pulse is not configured on this deployment');

	const upstream = new URL(view.path, base);
	for (const p of view.params) {
		const v = url.searchParams.get(p);
		if (v !== null && v.length <= 80) upstream.searchParams.set(p, v);
	}

	let result;
	try {
		result = await cacheWrapLastGood(
			`trenches:v1:${upstream.pathname}${upstream.search}`,
			view.ttl,
			async () => {
				const resp = await fetch(upstream, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
				if (!resp.ok) throw Object.assign(new Error(`Pulse responded ${resp.status}`), { upstreamStatus: resp.status });
				return { body: await resp.json(), at: Date.now() };
			},
			{ staleTtlSeconds: STALE_TTL_S, withMeta: true, refreshBudgetMs: REFRESH_BUDGET_MS },
		);
	} catch (err) {
		return offline(res, err?.upstreamStatus ? err.message : 'Pulse is unreachable right now');
	}

	const { value, stale } = result;
	if (stale) {
		return json(res, 200, value.body, {
			'cache-control': 'no-store',
			'x-trenches-stale': '1',
			'x-trenches-as-of': new Date(value.at).toISOString(),
		});
	}
	return json(res, 200, value.body, {
		'cache-control': `public, s-maxage=${view.ttl}, stale-while-revalidate=60`,
	});
});

// GET /api/coin/dextools-stats?days=<1-90>[&token=<token-address>]
// ---------------------------------------------------------------------------
// How many visits three.ws has sent to DEXTools pair pages, read from the
// aggregate counter /api/coin/dextools bumps on every redirect.
//
// DEXTools Social Boost ranks tokens by visits to their pair page, so this is
// the number the DEXTools partnership is measured in, and it is public on
// purpose: the /dextools hub renders it, and anyone (DEXTools included) can
// check the traffic claim instead of taking it on faith.
//
// Aggregate only. The table holds a count per (UTC day, network, token,
// surface) and nothing about who clicked. `token` narrows every breakdown to
// one coin, which is what a project embedding the boost card wants to see.

import { cors, method, wrap, json, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const TOP_TOKENS = 20;

/** Every UTC day from `since` through today, so a quiet day reads as 0, not a gap. */
function dayRange(days) {
	const out = [];
	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);
	for (let i = days - 1; i >= 0; i--) {
		out.push(new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10));
	}
	return out;
}

const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function readStats(days, token) {
	const since = dayRange(days)[0];
	const tok = token || null;
	const [byDay, bySurface, topTokens, totals] = await Promise.all([
		sql`
			select day, sum(visits)::int as visits
			from dextools_referrals
			where day >= ${since}::date and (${tok}::text is null or token = ${tok})
			group by day
		`,
		sql`
			select surface, sum(visits)::int as visits
			from dextools_referrals
			where day >= ${since}::date and (${tok}::text is null or token = ${tok})
			group by surface
			order by visits desc
		`,
		sql`
			select r.network, r.token, sum(r.visits)::int as visits, m.name, m.symbol
			from dextools_referrals r
			left join pump_agent_mints m
				on m.mint = r.token and m.network = 'mainnet' and r.network = 'solana'
			where r.day >= ${since}::date and (${tok}::text is null or r.token = ${tok})
			group by r.network, r.token, m.name, m.symbol
			order by visits desc
			limit ${TOP_TOKENS}
		`,
		sql`
			select coalesce(sum(visits), 0)::int as visits,
			       count(distinct token)::int as tokens,
			       max(last_at) as last_at
			from dextools_referrals
			where day >= ${since}::date and (${tok}::text is null or token = ${tok})
		`,
	]);
	return { since, byDay, bySurface, topTokens, totals: totals[0] };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.marketDataIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, 'http://x').searchParams;
	const daysRaw = Number.parseInt(params.get('days') || '', 10);
	const days = Number.isFinite(daysRaw) ? Math.min(MAX_DAYS, Math.max(1, daysRaw)) : DEFAULT_DAYS;
	const token = (params.get('token') || '').trim();
	if (token && !SOL_RE.test(token) && !EVM_RE.test(token)) {
		return error(res, 400, 'bad_token', 'token is not a valid Solana or EVM token address');
	}

	let stats;
	try {
		stats = await readStats(days, token);
	} catch (err) {
		// The counter table ships in its own migration. Before it is applied no
		// visit has been counted, which is exactly what zero rows say.
		if (err?.code !== '42P01') throw err;
		stats = { since: dayRange(days)[0], byDay: [], bySurface: [], topTokens: [], totals: { visits: 0, tokens: 0, last_at: null } };
	}

	const counts = new Map(stats.byDay.map((r) => [isoDay(r.day), r.visits]));
	const threeMint = env.THREE_TOKEN_MINT;

	return json(
		res,
		200,
		{
			days,
			since: stats.since,
			token: token || null,
			visits: stats.totals.visits,
			tokens: stats.totals.tokens,
			lastVisitAt: stats.totals.last_at ? new Date(stats.totals.last_at).toISOString() : null,
			byDay: dayRange(days).map((day) => ({ day, visits: counts.get(day) || 0 })),
			bySurface: stats.bySurface.map((r) => ({ surface: r.surface, visits: r.visits })),
			topTokens: stats.topTokens.map((r) => ({
				network: r.network,
				token: r.token,
				visits: r.visits,
				name: r.token === threeMint ? 'three.ws' : r.name || null,
				symbol: r.token === threeMint ? 'THREE' : r.symbol || null,
				launchedOnThreeWs: r.name != null,
			})),
		},
		{ 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' },
	);
});

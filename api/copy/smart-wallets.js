/**
 * GET /api/copy/smart-wallets - the Smart Money directory for /dashboard/copy.
 *
 *   ?category=smart_money|strong|fresh   filter by reputation label (default: all ranked)
 *   ?sort=score|winrate|multiple|trades  (default: score)
 *   ?q=<text>             match wallet address
 *   ?limit=1..100         page size              (default: 30)
 *   ?offset=0..           page offset            (default: 0)
 *
 * Ranked from the platform's own wallet reputation graph
 * (smart_wallet_reputation, folded from observed pump.fun buys joined to real
 * outcomes by workers/agent-sniper/recompute-wallet-graph.js). Solana only.
 * Wallet address plus realized track record: no names, no social handles, no
 * third-party data. Public, IP rate-limited, cached at the edge: the ranking
 * shifts as the recompute job runs, not by the second.
 */

import { cors, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';

const CATEGORIES = new Set(['smart_money', 'strong', 'fresh']);
const SORTS = new Set(['score', 'winrate', 'multiple', 'trades']);
// Labels that rank a wallet in the directory; sybil and rugger wallets are never listed.
const RANKED = ['smart_money', 'strong', 'fresh'];
const MIN_TRADES = 3;

function clampInt(value, min, max, fallback) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(n, min), max);
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function publicRow(r) {
	const labels = Array.isArray(r.labels) ? r.labels : [];
	const categories = labels.filter((l) => CATEGORIES.has(l));
	return {
		address: r.address,
		chain: 'sol',
		category: categories[0] || 'smart_money',
		categories: categories.length ? categories : ['smart_money'],
		score: num(r.realized_score),
		win_rate: num(r.win_rate),
		avg_ath_multiple: num(r.avg_ath_multiple),
		trades_seen: num(r.trades_seen),
		winners: num(r.winners),
		losers: num(r.losers),
		last_seen: r.last_seen || null,
	};
}

async function page({ category, sort, q, limit, offset }) {
	const cat = category || null;
	const like = q ? `%${q}%` : null;
	// Whole statements per ranking: the sql tag does not compose fragments, and
	// an ORDER BY must never be built from request text.
	const total = (
		await sql`
			select count(*)::int as n from smart_wallet_reputation
			where network = 'mainnet' and trades_seen >= ${MIN_TRADES}
			  and labels && ${RANKED}::text[]
			  and not (labels && array['sybil','rugger']::text[])
			  and (${cat}::text is null or ${cat}::text = any(labels))
			  and (${like}::text is null or address ilike ${like}::text)`
	)[0]?.n ?? 0;
	let rows;
	if (sort === 'winrate') {
		rows = await sql`
			select address, realized_score, win_rate, avg_ath_multiple, trades_seen, winners, losers, labels, last_seen
			from smart_wallet_reputation
			where network = 'mainnet' and trades_seen >= ${MIN_TRADES}
			  and labels && ${RANKED}::text[]
			  and not (labels && array['sybil','rugger']::text[])
			  and (${cat}::text is null or ${cat}::text = any(labels))
			  and (${like}::text is null or address ilike ${like}::text)
			order by win_rate desc, trades_seen desc limit ${limit} offset ${offset}`;
	} else if (sort === 'multiple') {
		rows = await sql`
			select address, realized_score, win_rate, avg_ath_multiple, trades_seen, winners, losers, labels, last_seen
			from smart_wallet_reputation
			where network = 'mainnet' and trades_seen >= ${MIN_TRADES}
			  and labels && ${RANKED}::text[]
			  and not (labels && array['sybil','rugger']::text[])
			  and (${cat}::text is null or ${cat}::text = any(labels))
			  and (${like}::text is null or address ilike ${like}::text)
			order by avg_ath_multiple desc, trades_seen desc limit ${limit} offset ${offset}`;
	} else if (sort === 'trades') {
		rows = await sql`
			select address, realized_score, win_rate, avg_ath_multiple, trades_seen, winners, losers, labels, last_seen
			from smart_wallet_reputation
			where network = 'mainnet' and trades_seen >= ${MIN_TRADES}
			  and labels && ${RANKED}::text[]
			  and not (labels && array['sybil','rugger']::text[])
			  and (${cat}::text is null or ${cat}::text = any(labels))
			  and (${like}::text is null or address ilike ${like}::text)
			order by trades_seen desc, realized_score desc limit ${limit} offset ${offset}`;
	} else {
		rows = await sql`
			select address, realized_score, win_rate, avg_ath_multiple, trades_seen, winners, losers, labels, last_seen
			from smart_wallet_reputation
			where network = 'mainnet' and trades_seen >= ${MIN_TRADES}
			  and labels && ${RANKED}::text[]
			  and not (labels && array['sybil','rugger']::text[])
			  and (${cat}::text is null or ${cat}::text = any(labels))
			  and (${like}::text is null or address ilike ${like}::text)
			order by realized_score desc, trades_seen desc limit ${limit} offset ${offset}`;
	}
	return { total, rows };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, `http://${req.headers.host || 'x'}`).searchParams;
	const category = CATEGORIES.has(params.get('category')) ? params.get('category') : null;
	// Set membership only: ?sort=__proto__ / valueOf must fall back to the score ranking.
	const sortParam = params.get('sort') || '';
	const sort = SORTS.has(sortParam) ? sortParam : 'score';
	const q = (params.get('q') || '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 44);
	const limit = clampInt(params.get('limit'), 1, 100, 30);
	const offset = clampInt(params.get('offset'), 0, 100000, 0);

	let result;
	try {
		result = await page({ category, sort, q, limit, offset });
	} catch (err) {
		console.warn('[copy/smart-wallets] reputation graph query failed:', err?.message || err);
		return json(res, 200, {
			wallets: [],
			total: 0,
			offset,
			limit,
			has_more: false,
			facets: { byChain: {}, byCategory: {} },
			source: 'three.ws wallet reputation graph',
			generated_at: null,
			unavailable: true,
		});
	}

	const wallets = result.rows.map(publicRow);
	return json(res, 200, {
		wallets,
		total: result.total,
		offset,
		limit,
		has_more: offset + wallets.length < result.total,
		facets: { byChain: { sol: result.total }, byCategory: {} },
		source: 'three.ws wallet reputation graph',
		generated_at: new Date().toISOString(),
	}, { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' });
});

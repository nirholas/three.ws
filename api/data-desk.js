// GET /api/data-desk: the public feed behind the /data-desk page.
//
// Every dataset here was BOUGHT: a brand-new agent wallet, minted minutes
// earlier by the fresh-wallet workers lane, paid a three.ws x402 market-data
// or intel endpoint in real USDC on Solana, and the response was stored with
// its receipt (the paying wallet, the price, the settlement signature). The
// feed returns the newest purchase of every dataset, the most recent
// purchases as a ledger, and the lane's own statistics. No synthetic rows: if
// nothing has been bought yet the feed is honestly empty.
//
// Views:
//   GET /api/data-desk               : latest row per dataset + recent purchases + stats
//   GET /api/data-desk?slug=market-gas: history for one dataset (newest first)
//   GET /api/data-desk?limit=50      : ledger page size (max 100)

import { sql, isDbUnavailableError } from './_lib/db.js';
import { cors, json, method, serverError, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { cacheGet, cacheSet } from './_lib/cache.js';
import { explorerTxUrl } from './_lib/avatar-wallet.js';
import { DATA_JOBS, DATA_JOB_SLUGS } from './_lib/x402/fresh-workers/jobs.js';
import { laneStats } from './_lib/x402/fresh-workers/wallets.js';

const FEED_TTL_S = 15;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const SLUGS = new Set(DATA_JOB_SLUGS);

function shortAddr(a) {
	if (!a || typeof a !== 'string') return null;
	return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function toItem(row, { withPayload }) {
	const meta = DATA_JOBS.find((j) => j.slug === row.slug);
	return {
		id: Number(row.id),
		ts: row.ts,
		slug: row.slug,
		title: row.title || meta?.title || row.slug,
		blurb: meta?.blurb || null,
		endpoint_path: row.endpoint_path,
		price_usdc: row.amount_atomic != null ? Number(row.amount_atomic) / 1e6 : null,
		payer: row.payer,
		payer_short: shortAddr(row.payer),
		tx_sig: row.tx_sig,
		explorer_url: row.tx_sig ? explorerTxUrl(row.tx_sig) : null,
		...(withPayload ? { payload: row.payload } : {}),
	};
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://localhost');
	const slug = url.searchParams.get('slug');
	const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
	if (slug && !SLUGS.has(slug)) {
		return json(res, 400, { error: 'invalid_slug', error_description: `slug must be one of: ${DATA_JOB_SLUGS.join(', ')}` });
	}

	const cacheKey = `data-desk:${slug || 'all'}:${limit}`;
	const cached = await cacheGet(cacheKey);
	if (cached) return json(res, 200, cached, { 'cache-control': `public, max-age=${FEED_TTL_S}` });

	try {
		let payload;
		if (slug) {
			const rows = await sql`
				SELECT id, ts, slug, title, endpoint_path, payload, payer, tx_sig, amount_atomic
				FROM x402_data_desk WHERE slug = ${slug} ORDER BY ts DESC LIMIT ${limit}`;
			payload = { slug, items: rows.map((r) => toItem(r, { withPayload: true })) };
		} else {
			const [latest, recent, stats] = await Promise.all([
				sql`
					SELECT DISTINCT ON (slug) id, ts, slug, title, endpoint_path, payload, payer, tx_sig, amount_atomic
					FROM x402_data_desk ORDER BY slug, ts DESC`,
				sql`
					SELECT id, ts, slug, title, endpoint_path, payer, tx_sig, amount_atomic
					FROM x402_data_desk ORDER BY ts DESC LIMIT ${limit}`,
				laneStats(sql),
			]);
			const order = new Map(DATA_JOB_SLUGS.map((s, i) => [s, i]));
			const datasets = latest
				.map((r) => toItem(r, { withPayload: true }))
				.sort((a, b) => (order.get(a.slug) ?? 999) - (order.get(b.slug) ?? 999));
			const [desk] = await sql`
				SELECT count(*)::int AS purchases_24h, coalesce(sum(amount_atomic), 0)::bigint AS spent_atomic_24h,
				       count(distinct payer)::int AS payers_24h, max(ts) AS latest_ts
				FROM x402_data_desk WHERE ts > now() - interval '24 hours'`;
			payload = {
				datasets,
				recent: recent.map((r) => toItem(r, { withPayload: false })),
				catalog: DATA_JOBS.map((j) => ({ slug: j.slug, title: j.title, blurb: j.blurb })),
				stats: {
					datasets_live: datasets.length,
					purchases_24h: desk?.purchases_24h ?? 0,
					payers_24h: desk?.payers_24h ?? 0,
					spent_usdc_24h: Number(desk?.spent_atomic_24h ?? 0) / 1e6,
					latest_ts: desk?.latest_ts ?? null,
					lane: stats,
				},
			};
		}
		await cacheSet(cacheKey, payload, FEED_TTL_S);
		return json(res, 200, payload, { 'cache-control': `public, max-age=${FEED_TTL_S}` });
	} catch (err) {
		if (isDbUnavailableError(err)) {
			return json(res, 503, { error: 'db_unavailable', error_description: 'The data desk database is briefly unavailable. Retry shortly.' }, { 'cache-control': 'no-store', 'retry-after': '5' });
		}
		return serverError(res, 500, 'data_desk_feed_error', err);
	}
}

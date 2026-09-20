// GET /api/coin/derivative?venue=<exchange-id>&symbol=<venue-symbol>
// ---------------------------------------------------------------------------
// One perpetual contract in full, powering the /derivative/:venue/:symbol
// detail page that the /derivatives table now links into. The table row is a
// summary (price, funding, open interest, volume); this endpoint answers the
// questions the row raises: is this contract trading above or below its own
// index, what does its funding cost annualized, how big is it next to the rest
// of the venue, and where does the same underlying fund cheaper somewhere
// else.
//
// Four upstream reads, all shared with pages that already ran them, so a warm
// instance usually serves this from cache:
//   1. /derivatives/exchanges/{venue}?include_tickers=unexpired
//      The contract itself plus every other contract on the venue, and the
//      venue profile (country, year, description, open interest).
//   2. /derivatives?include_tickers=unexpired
//      Same feed /derivatives renders, reused here to price the SAME index on
//      every other venue: the cross-venue funding table.
//   3. The venue directory (api/_lib/derivative-venues.js) for display-name to
//      id resolution, so each peer row links to its own detail page.
//   4. /coins/markets for the underlying asset (spot price, market cap, rank),
//      which links the contract back to /coin/:id.
//
// Only read 1 is load-bearing. Reads 2 to 4 fail soft to null/empty: a
// cross-venue outage must not take down the contract page.

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { geckoFetch, htmlToText } from '../_lib/coingecko.js';
import { fetchDerivativeVenues, venueNameKey } from '../_lib/derivative-venues.js';
import { VENUE_ID_RE, SYMBOL_RE, contractSlug } from '../_lib/derivative-slug.js';

const VENUE_TTL_MS = 120_000;
const FEED_TTL_MS = 60_000;
const ASSET_TTL_MS = 120_000;

// Most venues settle funding three times a day (every 8h). CoinGecko does not
// publish the interval, so the annualized figure is an 8h-interval estimate and
// every surface that shows it says so.
const FUNDING_PERIODS_PER_YEAR = 3 * 365;

// How many rows each secondary table carries. Both are ranked by 24h volume,
// so the cut keeps the liquid end.
const MAX_PEERS = 40;
const MAX_VENUE_CONTRACTS = 12;

const num = (v) => {
	if (v == null || v === '') return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
};
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const httpUrl = (v) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v : null);

// CoinGecko funding_rate is a percentage for one funding interval (0.01 means
// 0.01%, not 1%). Annualizing assumes the 8h schedule above.
function fundingApr(rate) {
	return rate == null ? null : rate * FUNDING_PERIODS_PER_YEAR;
}

// bid_ask_spread on the derivatives namespace is a ratio, not a percentage.
function spreadPct(v) {
	const n = num(v);
	return n == null ? null : n * 100;
}

// CoinGecko reports `index_basis_percentage` as the INDEX's premium over the
// contract ((index - last) / last). Traders read basis the other way round: a
// contract trading above the thing it settles against is a positive basis, and
// that is the sign that agrees with funding. So the value is derived straight
// from the two prices when both are present, and the upstream field is negated
// as the fallback.
function contractBasisPct(t) {
	const last = num(t.last);
	const index = num(t.index);
	if (last != null && index != null && index !== 0) return ((last - index) / index) * 100;
	const upstream = num(t.index_basis_percentage);
	return upstream == null ? null : -upstream;
}

function shapeContract(t, venueId) {
	const symbol = str(t.symbol);
	const base = str(t.base);
	const target = str(t.target);
	const funding = num(t.funding_rate);
	return {
		symbol,
		slug: symbol ? contractSlug(symbol) : null,
		base,
		target,
		pair: base && target ? `${base}/${target}` : symbol,
		venue_id: venueId,
		contract_type: str(t.contract_type) || 'perpetual',
		coin_id: str(t.coin_id),
		price: num(t.last),
		index: num(t.index),
		basis_pct: contractBasisPct(t),
		change_24h: num(t.h24_percentage_change),
		funding_rate: funding,
		funding_apr: fundingApr(funding),
		open_interest_usd: num(t.open_interest_usd),
		volume_24h_usd: num(t.converted_volume?.usd),
		volume_24h_base: num(t.h24_volume),
		spread_pct: spreadPct(t.bid_ask_spread),
		last_traded_at: num(t.last_traded),
		expired_at: t.expired_at ?? null,
		trade_url: httpUrl(t.trade_url),
	};
}

// A row from the cross-venue /derivatives feed. Thinner than shapeContract:
// that feed carries no base/target, spread or index.
function shapePeer(t, venue) {
	const symbol = str(t.symbol);
	const funding = num(t.funding_rate);
	return {
		venue_id: venue?.id ?? null,
		venue_name: str(t.market) || venue?.name || 'Unknown',
		image: venue?.image ?? null,
		symbol,
		slug: symbol ? contractSlug(symbol) : null,
		price: num(t.price ?? t.last),
		change_24h: num(t.price_percentage_change_24h ?? t.h24_percentage_change),
		funding_rate: funding,
		funding_apr: fundingApr(funding),
		open_interest_usd: num(t.open_interest),
		volume_24h_usd: num(t.volume_24h),
		current: false,
	};
}

function median(values) {
	if (!values.length) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// A popular index lists on well over a hundred venues, most of them thin. The
// extremes of that full set are noise: a DEX doing four figures a day sets the
// widest funding and the widest price every single time. Anything presented as
// somewhere a trader could actually act (best venue to hold a long, best venue
// to hold a short, how far quotes disagree) is drawn from venues clearing at
// least this much in 24h volume; the aggregate totals and shares still count
// every venue.
const LIQUID_VOLUME_FLOOR_USD = 1_000_000;

function pick(peer) {
	return peer
		? {
				venue_id: peer.venue_id,
				venue_name: peer.venue_name,
				symbol: peer.symbol,
				slug: peer.slug,
				funding_rate: peer.funding_rate,
				funding_apr: peer.funding_apr,
			}
		: null;
}

// Everything the cross-venue table needs to be an answer rather than a list:
// where this contract's funding sits against the field, how much of the
// underlying's open interest and volume it holds, and how far the venues
// disagree on price.
function summarizePeers(peers, current) {
	if (!peers.length) return null;
	const liquid = peers.filter((p) => (p.volume_24h_usd ?? 0) >= LIQUID_VOLUME_FLOOR_USD);
	const fundings = liquid.map((p) => p.funding_rate).filter((v) => v != null);
	const prices = liquid.map((p) => p.price).filter((v) => v != null && v > 0);
	const totalOi = peers.reduce((s, p) => s + (p.open_interest_usd ?? 0), 0);
	const totalVol = peers.reduce((s, p) => s + (p.volume_24h_usd ?? 0), 0);

	const byFunding = liquid.filter((p) => p.funding_rate != null);
	const cheapestLong = byFunding.length
		? byFunding.reduce((a, b) => (b.funding_rate < a.funding_rate ? b : a))
		: null;
	const richestShort = byFunding.length
		? byFunding.reduce((a, b) => (b.funding_rate > a.funding_rate ? b : a))
		: null;

	const priceMin = prices.length ? Math.min(...prices) : null;
	const priceMax = prices.length ? Math.max(...prices) : null;

	const rankBy = (key) => {
		const value = current?.[key];
		if (value == null) return null;
		return peers.filter((p) => (p[key] ?? -Infinity) > value).length + 1;
	};

	return {
		venues: peers.length,
		liquid_venues: liquid.length,
		liquid_floor_usd: LIQUID_VOLUME_FLOOR_USD,
		funding_min: fundings.length ? Math.min(...fundings) : null,
		funding_max: fundings.length ? Math.max(...fundings) : null,
		funding_median: median(fundings),
		funding_spread: fundings.length ? Math.max(...fundings) - Math.min(...fundings) : null,
		cheapest_long: pick(cheapestLong),
		richest_short: pick(richestShort),
		price_min: priceMin,
		price_max: priceMax,
		price_dispersion_pct: priceMin && priceMax ? ((priceMax - priceMin) / priceMin) * 100 : null,
		total_open_interest_usd: totalOi || null,
		total_volume_24h_usd: totalVol || null,
		oi_share_pct: totalOi && current?.open_interest_usd != null ? (current.open_interest_usd / totalOi) * 100 : null,
		vol_share_pct: totalVol && current?.volume_24h_usd != null ? (current.volume_24h_usd / totalVol) * 100 : null,
		oi_rank: rankBy('open_interest_usd'),
		vol_rank: rankBy('volume_24h_usd'),
	};
}

// The same underlying on every other venue, ranked by 24h volume. The feed
// keys venues by display name, so each row is resolved back to an id through
// the venue directory in order to link to its own detail page.
async function buildPeers(indexId, contract, venueName) {
	if (!indexId) return { peers: [], stats: null };

	let rows = [];
	try {
		const raw = await geckoFetch('/derivatives?include_tickers=unexpired', { ttlMs: FEED_TTL_MS });
		rows = Array.isArray(raw) ? raw : [];
	} catch {
		return { peers: [], stats: null };
	}

	let byName = new Map();
	try {
		({ byName } = await fetchDerivativeVenues());
	} catch {
		// Names without ids still render; they just do not link anywhere.
	}

	const wantedVenue = venueNameKey(venueName);
	const peers = rows
		.filter((t) => t && t.contract_type === 'perpetual' && t.index_id === indexId)
		.map((t) => shapePeer(t, byName.get(venueNameKey(t.market))))
		.sort((a, b) => (b.volume_24h_usd ?? 0) - (a.volume_24h_usd ?? 0));

	for (const p of peers) {
		if (venueNameKey(p.venue_name) === wantedVenue && p.symbol === contract.symbol) {
			p.current = true;
			// The venue-scoped read is the fresher of the two feeds for this one
			// contract, so the row the visitor is standing on shows those numbers.
			p.price = contract.price ?? p.price;
			p.funding_rate = contract.funding_rate ?? p.funding_rate;
			p.funding_apr = fundingApr(p.funding_rate);
			p.open_interest_usd = contract.open_interest_usd ?? p.open_interest_usd;
			p.volume_24h_usd = contract.volume_24h_usd ?? p.volume_24h_usd;
		}
	}

	const stats = summarizePeers(peers, contract);
	return { peers: peers.slice(0, MAX_PEERS), stats };
}

// Spot market data for the contract's underlying, so the page can put the mark
// price next to the asset it tracks and link through to /coin/:id.
async function buildIndexAsset(coinId) {
	if (!coinId) return null;
	try {
		const raw = await geckoFetch(
			`/coins/markets?vs_currency=usd&ids=${encodeURIComponent(coinId)}&price_change_percentage=24h&sparkline=false`,
			{ ttlMs: ASSET_TTL_MS },
		);
		const row = Array.isArray(raw) ? raw[0] : null;
		if (!row) return null;
		return {
			coin_id: str(row.id),
			name: str(row.name),
			symbol: str(row.symbol)?.toUpperCase() ?? null,
			image: httpUrl(row.image),
			price_usd: num(row.current_price),
			change_24h: num(row.price_change_percentage_24h),
			market_cap: num(row.market_cap),
			market_cap_rank: num(row.market_cap_rank),
			volume_24h: num(row.total_volume),
			high_24h: num(row.high_24h),
			low_24h: num(row.low_24h),
			ath: num(row.ath),
			ath_change_pct: num(row.ath_change_percentage),
		};
	} catch {
		return null;
	}
}

/**
 * Assemble the full contract payload.
 * Throws with `status` 404 when the venue or the symbol is unknown upstream.
 */
export async function buildDerivativeContract(venueId, symbol) {
	const detail = await geckoFetch(
		`/derivatives/exchanges/${encodeURIComponent(venueId)}?include_tickers=unexpired`,
		{ ttlMs: VENUE_TTL_MS },
	);

	const tickers = Array.isArray(detail?.tickers) ? detail.tickers : [];
	const wanted = symbol.toLowerCase();
	const raw = tickers.find((t) => String(t?.symbol ?? '').toLowerCase() === wanted);
	if (!raw) {
		const err = new Error(`no contract ${symbol} on ${venueId}`);
		err.status = 404;
		throw err;
	}

	const contract = shapeContract(raw, venueId);
	const venueName = (detail.name || venueId).trim();
	const venue = {
		id: venueId,
		name: venueName,
		image: httpUrl(detail.image),
		url: httpUrl(detail.url),
		description: detail.description ? htmlToText(detail.description) : null,
		country: str(detail.country),
		year_established: num(detail.year_established),
		open_interest_btc: num(detail.open_interest_btc),
		trade_volume_24h_btc: num(detail.trade_volume_24h_btc),
		perpetual_pairs: num(detail.number_of_perpetual_pairs),
		futures_pairs: num(detail.number_of_futures_pairs),
		contracts_listed: tickers.length,
	};

	// Everything else the venue lists, ranked by volume, minus this contract.
	const venueContracts = tickers
		.filter((t) => t && String(t.symbol ?? '').toLowerCase() !== wanted)
		.map((t) => shapeContract(t, venueId))
		.sort((a, b) => (b.volume_24h_usd ?? 0) - (a.volume_24h_usd ?? 0))
		.slice(0, MAX_VENUE_CONTRACTS);

	const venueOi = tickers.reduce((s, t) => s + (num(t.open_interest_usd) ?? 0), 0);
	const venueVol = tickers.reduce((s, t) => s + (num(t.converted_volume?.usd) ?? 0), 0);
	contract.venue_oi_share_pct =
		venueOi && contract.open_interest_usd != null ? (contract.open_interest_usd / venueOi) * 100 : null;
	contract.venue_vol_share_pct =
		venueVol && contract.volume_24h_usd != null ? (contract.volume_24h_usd / venueVol) * 100 : null;

	const [{ peers, stats }, indexAsset] = await Promise.all([
		buildPeers(contract.base, contract, venueName),
		buildIndexAsset(contract.coin_id),
	]);

	return {
		venue,
		contract,
		index: indexAsset,
		peers,
		peer_stats: stats,
		venue_contracts: venueContracts,
		funding_periods_per_year: FUNDING_PERIODS_PER_YEAR,
		updated_at: Date.now(),
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.marketDataIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, 'http://x').searchParams;
	const venue = (params.get('venue') || '').trim().toLowerCase();
	const symbol = (params.get('symbol') || '').trim();

	if (!VENUE_ID_RE.test(venue)) {
		return error(res, 400, 'bad_request', 'venue must be a derivatives exchange id');
	}
	if (!SYMBOL_RE.test(symbol)) {
		return error(res, 400, 'bad_request', 'symbol must be a venue contract symbol');
	}

	try {
		const payload = await buildDerivativeContract(venue, symbol);
		return json(res, 200, payload, {
			'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
		});
	} catch (err) {
		if (err?.status === 404) {
			return error(
				res,
				404,
				'not_found',
				`no active contract "${symbol}" on "${venue}"`,
			);
		}
		return error(
			res,
			502,
			'upstream_error',
			'contract data is unavailable right now, please retry shortly',
		);
	}
});

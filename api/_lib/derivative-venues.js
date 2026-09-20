// The derivatives-venue directory, shared by /api/coin/derivatives and
// /api/coin/derivative.
//
// CoinGecko's `/derivatives` ticker feed names a venue only by its display
// name ("WhiteBIT Futures"), while every venue-scoped endpoint and every
// internal route addresses it by id ("whitebit_futures"). Without that bridge
// a perp row cannot link anywhere: it knows the market it trades on but not
// how to name it. `/derivatives/exchanges` carries both, so this module keeps
// one cached copy of the full directory and exposes the name to id map built
// from it.
//
// The page-ranked table on /derivatives fetches its own 50-row slice; this
// directory is deliberately the FULL list (per_page=250 covers every venue
// CoinGecko tracks, roughly 110 today), because a ticker from a venue outside
// the top 50 by open interest still needs a working link.

import { geckoFetch } from './coingecko.js';

const TTL_MS = 300_000;
const PATH = '/derivatives/exchanges?order=open_interest_btc_desc&per_page=250';

let _cache = null; // { venues, byName, expiresAt }

const num = (v) => {
	if (v == null || v === '') return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : null;
};

/** Venue display names are compared case- and whitespace-insensitively. */
export function venueNameKey(name) {
	return String(name ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

/**
 * The full derivatives-venue directory plus a display-name lookup.
 * Throws when the upstream is unreachable and nothing is cached; callers that
 * only want richer links should catch and degrade.
 * @returns {Promise<{ venues: object[], byName: Map<string, object> }>}
 */
export async function fetchDerivativeVenues() {
	const now = Date.now();
	if (_cache && _cache.expiresAt > now) return { venues: _cache.venues, byName: _cache.byName };

	const raw = await geckoFetch(PATH, { ttlMs: TTL_MS });
	const rows = Array.isArray(raw) ? raw : [];
	const venues = rows
		.filter((e) => e && e.id)
		.map((e) => ({
			id: String(e.id),
			name: (e.name || e.id).trim(),
			image: e.image || null,
			open_interest_btc: num(e.open_interest_btc),
			trade_volume_24h_btc: num(e.trade_volume_24h_btc),
			perpetual_pairs: num(e.number_of_perpetual_pairs),
			futures_pairs: num(e.number_of_futures_pairs),
			year_established: num(e.year_established),
			country: e.country || null,
		}));

	if (!venues.length) throw new Error('empty derivatives exchange directory');

	const byName = new Map();
	for (const v of venues) {
		const key = venueNameKey(v.name);
		if (key && !byName.has(key)) byName.set(key, v);
	}

	_cache = { venues, byName, expiresAt: now + TTL_MS };
	return { venues, byName };
}

/**
 * Resolve a ticker's `market` display name to its venue id.
 * Returns null instead of throwing: a missing id costs a link, not a page.
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export async function venueIdForName(name) {
	try {
		const { byName } = await fetchDerivativeVenues();
		return byName.get(venueNameKey(name))?.id ?? null;
	} catch {
		return null;
	}
}

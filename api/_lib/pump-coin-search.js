// pump.fun's coin search, the one listing route that still answers per query.
//
// On 2026-11-25 pump.fun retired GET /coins/<mint> (404 "Cannot GET" for every
// mint) and started ignoring `searchTerm` on GET /coins, which now returns the
// market-cap board whatever the query. GET /coins/search-unrestricted is what
// its own site uses: keyed by `searchTerm`, it returns full coin records (name,
// symbol, image, creator, complete, usd_market_cap, supply, pools). It searches
// several chains and fuzzy-matches, so callers keep Solana rows only and, for
// a single coin, an exact mint match only. Listings no longer carry the
// bonding-curve virtual reserves; read those on-chain when needed.
//
// No imports on purpose: services/pump-claims ships api/_lib in its image and
// reaches this through api/_lib/pump-search.js.

export const PUMP_SEARCH_BASE = process.env.PUMP_FRONTEND_BASE || 'https://frontend-api-v3.pump.fun';

// CAIP-2 id pump.fun stamps on Solana mainnet rows.
export const SOLANA_MAINNET_CHAIN_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

/** The search URL for a name, symbol or mint. */
export function pumpSearchUrl(term, limit = 30) {
	const url = new URL('/coins/search-unrestricted', PUMP_SEARCH_BASE);
	url.searchParams.set('searchTerm', String(term));
	url.searchParams.set('limit', String(Math.max(1, Math.floor(limit))));
	url.searchParams.set('offset', '0');
	return url.toString();
}

/** The search URL that returns the coin record for `mint`. */
export function pumpCoinSearchUrl(mint) {
	return pumpSearchUrl(mint, 5);
}

/** Pull the coin array out of either accepted search envelope. */
function rowsFrom(body) {
	if (Array.isArray(body)) return body;
	if (Array.isArray(body?.coins)) return body.coins;
	return null;
}

/** The exact-mint coin record from a search response, or null. */
export function pickPumpCoin(body, mint) {
	const rows = rowsFrom(body);
	if (!rows) return null;
	return rows.find((c) => c && c.mint === mint) || null;
}

/**
 * Solana, non-NSFW rows from a search response, in pump.fun's order. Rows from
 * other chains are dropped; a row without a chain id is the Solana-only legacy
 * shape and kept. Returns null when the body is not a coin list.
 */
export function solanaSearchRows(body, { includeNsfw = false } = {}) {
	const rows = rowsFrom(body);
	if (!rows) return null;
	return rows.filter((c) => {
		if (!c || typeof c.mint !== 'string' || c.mint.length < 32) return false;
		if (c.chain_id && c.chain_id !== SOLANA_MAINNET_CHAIN_ID) return false;
		if (!includeNsfw && c.nsfw === true) return false;
		return true;
	});
}

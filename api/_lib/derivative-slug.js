// Perpetual-contract URL slugs, shared by every surface that links to
// /derivative/:venue/:symbol.
//
// A contract is addressed by its venue id plus the venue's own symbol, and
// those symbols are not path-safe: a handful arrive as "ETH/USDT". A
// percent-encoded %2F is decoded by proxies before routing, which splits the
// path into an extra segment and 404s the route, so the slash is swapped for
// "~" instead. "~" is an unreserved URL character (no encoding needed, no
// double-encoding trap) and appears in no venue symbol the derivatives feed
// carries.
//
// A symbol that falls outside the accepted charset returns null rather than a
// mangled slug: the caller renders plain text instead of a link that would
// 404.
//
// This module exists twice and the two copies must stay byte-identical:
// src/shared/derivative-slug.js (browser) and api/_lib/derivative-slug.js
// (server). The server build context excludes src/, so it cannot import the
// browser copy; tests/api/derivative-slug.test.js compares the two files and
// fails the moment they drift.

// Venue ids come from CoinGecko's derivatives-exchange namespace.
export const VENUE_ID_RE = /^[a-z0-9_-]{1,60}$/i;
// Exchange symbols in the feed use letters, digits, "_", "-", "/", "." and ":".
export const SYMBOL_RE = /^[A-Za-z0-9._:/-]{1,48}$/;
// What a symbol looks like once the slash is folded into "~".
export const SYMBOL_SLUG_RE = /^[A-Za-z0-9._:~-]{1,48}$/;

/**
 * Fold a venue symbol into a path-safe slug.
 * @param {string} symbol e.g. "ETH/USDT"
 * @returns {string|null} e.g. "ETH~USDT", or null when the symbol is unusable
 */
export function contractSlug(symbol) {
	const s = String(symbol ?? '').trim();
	if (!s || !SYMBOL_RE.test(s) || s.includes('~')) return null;
	return s.replace(/\//g, '~');
}

/**
 * Recover the venue symbol from a path slug.
 * @param {string} slug e.g. "ETH~USDT"
 * @returns {string|null} e.g. "ETH/USDT", or null when the slug is unusable
 */
export function symbolFromSlug(slug) {
	let s = String(slug ?? '').trim();
	// Tolerate a still-encoded segment: some clients hand back "%7E" or "%2F".
	if (s.includes('%')) {
		try {
			s = decodeURIComponent(s);
		} catch {
			return null;
		}
	}
	if (!s) return null;
	const symbol = s.replace(/~/g, '/');
	return SYMBOL_RE.test(symbol) ? symbol : null;
}

/**
 * The canonical detail path for one contract.
 * @param {string} venueId CoinGecko derivatives-exchange id
 * @param {string} symbol venue symbol
 * @returns {string|null} "/derivative/<venue>/<slug>", or null when unusable
 */
export function derivativePath(venueId, symbol) {
	const id = String(venueId ?? '').trim();
	const slug = contractSlug(symbol);
	if (!id || !VENUE_ID_RE.test(id) || !slug) return null;
	return `/derivative/${id.toLowerCase()}/${slug}`;
}

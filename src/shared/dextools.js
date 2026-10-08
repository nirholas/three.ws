// DEXTools links and the Social Boost rally, in one dependency-free place.
//
// Imported by browser bundles (launch flow, coin pages, coin3d, widgets) and by
// the API layer (oracle market links, the $THREE link set), so it imports
// nothing and touches no DOM.
//
// Why DEXTools gets its own module instead of one more line per surface:
// DEXTools Social Boost ranks tokens by daily and weekly visits to their pair
// page and buys the winning token on the open market ($THREE has won it three
// times, see src/pump/dextools-social-boost.js). Every link a three.ws surface
// sends to a DEXTools pair page is a visit that counts for that coin, so the
// URL shape and the rally copy live here once and every surface sends the same
// visitor to the same page.
//
// URL shape, checked against DEXTools' own edge on 2026-10-08:
//   https://www.dextools.io/app/<chain>/pair-explorer/<address>
// `address` should be a pool (pair) address. DEXTools also accepts a mint
// there, but it files a pump.fun mint as the coin's bonding-curve pair (pair ==
// mint), so a raw-mint link lands a graduated coin on its dead curve page
// instead of its live pool. Only pass a mint for a coin still on its curve
// (a fresh launch). A surface that knows only the mint of a coin that may have
// graduated should link through dextoolsTokenUrl() in trading-terminals.js,
// which resolves the top pool server-side and counts the visit.
// The `/app/en/...` form 301s to this one, so the canonical form is used here.

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** three.ws chain id → DEXTools URL slug. Solana leads. */
export const DEXTOOLS_CHAIN_SLUGS = {
	solana: 'solana',
	ethereum: 'ether',
	base: 'base',
	'binance-smart-chain': 'bnb',
	bsc: 'bnb',
	'polygon-pos': 'polygon',
	'arbitrum-one': 'arbitrum',
	'optimistic-ethereum': 'optimism',
	avalanche: 'avalanche',
};

export const SOCIAL_BOOST_URL = 'https://www.dextools.io/app/social-boost';

/**
 * The DEXTools pair page for a pair address or a token mint.
 * @param {string} address  pool/pair address (preferred) or token address
 * @param {string} [chain='solana']  three.ws chain id (see DEXTOOLS_CHAIN_SLUGS)
 * @returns {string|null} null when the address is malformed for the chain
 */
export function dextoolsUrl(address, chain = 'solana') {
	const slug = DEXTOOLS_CHAIN_SLUGS[chain];
	const a = typeof address === 'string' ? address.trim() : '';
	if (!slug || !a) return null;
	const ok = slug === 'solana' ? SOL_RE.test(a) : EVM_RE.test(a);
	return ok ? `https://www.dextools.io/app/${slug}/pair-explorer/${encodeURIComponent(a)}` : null;
}

/**
 * The post a holder shares to send their community to the coin's DEXTools
 * page. Plain text, ready for an X intent or a Telegram message. The DEXTools
 * link goes last so X renders its card.
 * @param {{ symbol?: string, url: string }} p
 */
export function socialBoostRallyText({ symbol, url }) {
	const sym = String(symbol || '').replace(/^\$/, '').trim();
	const tag = sym ? `$${sym}` : 'This coin';
	return `${tag} is on DEXTools. Every visit to the pair page counts toward DEXTools Social Boost, and the winner gets a buyback.\n\nGo look at the chart:\n${url}`;
}

/** X compose URL for the rally post. */
export function socialBoostRallyIntent(p) {
	return `https://x.com/intent/post?text=${encodeURIComponent(socialBoostRallyText(p))}`;
}

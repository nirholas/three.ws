// Venue-agnostic prediction-market interface.
//
// Routes (api/v1/agents/[id]/predictions/, api/predictions/), the MCP tools
// (api/_mcpagent/predictions-tools.js) and the market_price alert runner talk to
// this module only. Each venue is one file exporting an object that satisfies
// VENUE_METHODS; adding a venue is adding that file and one line to VENUES.
//
// Solana is the default and the only venue today: event contracts settled in
// USDC on Solana (api/_lib/predictions/solana-venue.js).

import { venue as solanaVenue } from './solana-venue.js';

/**
 * @typedef {Object} PredictionOutcome
 * @property {'yes'|'no'} side
 * @property {string} label           what the side means for this market ("Yes", a team name)
 * @property {number|null} buy_price  price to buy one contract, as a probability 0..1
 * @property {number|null} sell_price price one contract sells for right now
 *
 * @typedef {Object} PredictionMarket
 * @property {string} id
 * @property {string|null} event_id
 * @property {string} venue
 * @property {string|null} provider   the book that fills and resolves the market
 * @property {string} title
 * @property {string|null} status
 * @property {string|null} result     'yes' | 'no' | 'draw' | 'refund' once resolved
 * @property {boolean} tradable
 * @property {string|null} open_time
 * @property {string|null} close_time
 * @property {string|null} resolve_at
 * @property {number|null} probability implied probability of YES (mid price)
 * @property {number|null} spread
 * @property {number|null} volume_contracts
 * @property {PredictionOutcome[]} outcomes
 * @property {string|null} rules
 * @property {string|null} rules_secondary
 * @property {string|null} image_url
 * @property {object|null} history_ref
 *
 * @typedef {Object} PredictionEvent
 * @property {string} id
 * @property {string} venue
 * @property {string|null} provider
 * @property {string} title
 * @property {string|null} subtitle
 * @property {string|null} category
 * @property {string|null} subcategory
 * @property {string[]} tags
 * @property {string|null} image_url
 * @property {boolean} is_active
 * @property {boolean} is_live
 * @property {string|null} begin_at
 * @property {string|null} close_time
 * @property {number|null} volume_usd
 * @property {number|null} volume_24h_usd
 * @property {{ condition: string|null, rules_pdf: string|null, source: string|null }} resolution
 * @property {number} market_count
 * @property {PredictionMarket[]} markets
 *
 * @typedef {Object} PredictionPosition
 * @property {string} id
 * @property {string} market_id
 * @property {'yes'|'no'} side
 * @property {number} contracts
 * @property {number|null} cost_usd
 * @property {number|null} value_usd
 * @property {number|null} pnl_usd
 * @property {'open'|'settled'|'lost'|'redeemed'} status
 * @property {boolean} claimable
 */

/** Every venue implements these. tests/predictions-venue.test.js enforces it. */
export const VENUE_METHODS = Object.freeze([
	'listEvents',
	'listCategories',
	'getEvent',
	'getMarket',
	'getOrderbook',
	'getPriceHistory',
	'tradingStatus',
	'listPositions',
	'listFills',
	'getOrderStatus',
	'buildOpenOrder',
	'buildCloseOrder',
	'buildRedeem',
	'submit',
]);

export const VENUES = Object.freeze({ [solanaVenue.id]: solanaVenue });
export const DEFAULT_VENUE = solanaVenue.id;

/** Methods a venue object is missing. Empty when it satisfies the contract. */
export function missingVenueMethods(v) {
	return VENUE_METHODS.filter((m) => typeof v?.[m] !== 'function');
}

export function getVenue(id = DEFAULT_VENUE) {
	const v = VENUES[id || DEFAULT_VENUE];
	if (!v) {
		const err = new Error(`Unknown prediction venue "${id}". Known: ${Object.keys(VENUES).join(', ')}.`);
		err.status = 400;
		err.code = 'unknown_venue';
		throw err;
	}
	return v;
}

export function listVenues() {
	return Object.values(VENUES).map((v) => ({ id: v.id, label: v.label, chain: v.chain, settlement: v.settlement, default: v.id === DEFAULT_VENUE }));
}

/**
 * Implied probability of one side of a market: the mid of its buy and sell
 * price when both exist, else whichever exists, else the complement of the
 * other side's mid. Null when the market has no price at all.
 * @param {PredictionMarket} market
 * @param {'yes'|'no'} side
 */
export function sideProbability(market, side) {
	const mid = (o) => {
		if (!o) return null;
		if (o.buy_price != null && o.sell_price != null) return (o.buy_price + o.sell_price) / 2;
		return o.buy_price ?? o.sell_price ?? null;
	};
	const own = mid(market?.outcomes?.find((o) => o.side === side));
	if (own != null) return Math.round(own * 10_000) / 10_000;
	const other = mid(market?.outcomes?.find((o) => o.side !== side));
	return other != null ? Math.round((1 - other) * 10_000) / 10_000 : null;
}

export { VenueError } from './solana-venue.js';

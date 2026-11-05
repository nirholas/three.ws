// Lending venue registry. Every route, tool and page reaches a venue through
// getVenue(id); nothing outside this directory imports a venue module.
//
// A venue implements this contract (see ./kamino.js for the reference one):
//
//   id, name, chain, network, market, program, app_url
//   capabilities                  { deposit, withdraw, borrow, repay }
//   listMarkets()                 every suppliable token with APY and risk
//   getReserve(mintOrReserve)     one normalized market row, 404 when absent
//   getPosition(owner)            deposits, borrows, health factor, or null
//   buildDeposit / buildWithdraw  unsigned web3.js instructions + lookup tables
//   invalidateMarket()            drop cached market state after a landed action

import { venue as kamino, VENUE_ID as KAMINO_ID } from './kamino.js';
import { LendingError } from './errors.js';

const VENUES = new Map([[KAMINO_ID, kamino]]);

export const DEFAULT_VENUE = KAMINO_ID;

/** The venue for an id, or the default when omitted. Throws 404 `unknown_venue`. */
export function getVenue(id) {
	const key = id == null || id === '' ? DEFAULT_VENUE : String(id).toLowerCase();
	const venue = VENUES.get(key);
	if (!venue) {
		throw new LendingError('unknown_venue', `No lending venue "${key}". Available: ${[...VENUES.keys()].join(', ')}.`, 404, { venues: [...VENUES.keys()] });
	}
	return venue;
}

/** Public descriptions of every venue (no functions). */
export function listVenues() {
	return [...VENUES.values()].map((v) => ({
		id: v.id, name: v.name, chain: v.chain, network: v.network, market: v.market,
		program: v.program, app_url: v.app_url, capabilities: v.capabilities,
	}));
}

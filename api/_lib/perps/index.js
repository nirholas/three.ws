// Perpetual futures: the venue-agnostic interface every perps venue implements.
//
// The agent wallet trades perps through exactly one shape, defined here, so the
// service layer (api/_lib/perps/service.js), the v1 routes, the MCP tools and the
// /agents/:id/perps page never import a venue module directly. Adding a second
// venue is one new file beside ./phoenix.js that exports every member listed in
// VENUE_CONTRACT, plus one entry in VENUES below.
//
// Units, everywhere this interface is used:
//   prices    USD numbers, never ticks
//   sizes     base units; `signed_size` is positive long, negative short
//   money     USD numbers; collateral is USDC-denominated with 6 decimals
//   funding   percent per hour (`funding_rate_hourly_pct`) and its APR
//
// How a venue is driven, by `execution`:
//   instructions  buildOrder returns @solana/web3.js instructions the platform
//                 compiles, simulates, signs with the agent wallet and sends
//   transaction   buildOrder returns a venue-built unsigned Solana transaction
//                 the platform simulates, signs and submits (Jupiter)
//   api_wallet    buildOrder returns a venue action the platform signs with the
//                 agent's approved API wallet and posts (Hyperliquid)
// `capabilities` says what the venue supports (order types, deposit/withdraw,
// cancel); the service refuses an unsupported action before anything is signed.
//
// Instruction builders return @solana/web3.js TransactionInstruction arrays. The
// caller owns signing and submission: every perps transaction is signed by the
// agent's custodial wallet on the audited path in service.js, never inside a venue.

import * as phoenix from './phoenix.js';
import * as jupiter from './jupiter.js';
import * as hyperliquid from './hyperliquid.js';

/** Every member a venue module must export, with the kind of value it is. */
export const VENUE_CONTRACT = Object.freeze({
	id: 'string',
	label: 'string',
	collateral: 'object',
	chain: 'string',
	execution: 'string',
	capabilities: 'object',
	accountRef: 'function',
	ping: 'function',
	listMarkets: 'function',
	getMarket: 'function',
	getMarketData: 'function',
	getAccount: 'function',
	prepareAccount: 'function',
	submitPrepare: 'function',
	buildDeposit: 'function',
	buildWithdraw: 'function',
	quoteOrder: 'function',
	buildOrder: 'function',
	buildConditional: 'function',
	buildCancel: 'function',
	buildCancelConditional: 'function',
});

/**
 * Check a module against VENUE_CONTRACT. Returns the list of problems, empty
 * when the module conforms. Run at load and by tests/perps-desk.test.js.
 */
export function venueContractProblems(venue) {
	const problems = [];
	for (const [key, kind] of Object.entries(VENUE_CONTRACT)) {
		const value = venue?.[key];
		const actual = value === null ? 'null' : typeof value;
		if (actual !== kind) problems.push(`${key}: expected ${kind}, got ${actual}`);
	}
	return problems;
}

const VENUES = new Map([phoenix, jupiter, hyperliquid].map((v) => [v.id, v]));

for (const venue of VENUES.values()) {
	const problems = venueContractProblems(venue);
	if (problems.length) throw new Error(`perps venue ${venue?.id} breaks the venue contract: ${problems.join('; ')}`);
}

export const DEFAULT_VENUE = phoenix.id;

/** Resolve a venue by id, the default when omitted. An unknown id is a 400. */
export function getVenue(id = DEFAULT_VENUE) {
	const venue = VENUES.get(id || DEFAULT_VENUE);
	if (!venue) {
		throw Object.assign(new Error(`Unknown perps venue "${id}". Available: ${[...VENUES.keys()].join(', ')}.`), {
			status: 400,
			code: 'unknown_venue',
			detail: { venue: id, available: [...VENUES.keys()] },
		});
	}
	return venue;
}

/** Every registered venue module, default first. */
export function listVenueModules() {
	return [...VENUES.values()].sort((a, b) => (a.id === DEFAULT_VENUE ? -1 : b.id === DEFAULT_VENUE ? 1 : 0));
}

/** Public description of every registered venue. */
export function listVenues() {
	return [...VENUES.values()].map((v) => ({
		id: v.id,
		label: v.label,
		collateral: v.collateral,
		chain: v.chain,
		execution: v.execution,
		capabilities: v.capabilities,
		default: v.id === DEFAULT_VENUE,
	}));
}

export const ORDER_TYPES = Object.freeze(['market', 'limit', 'take_profit', 'stop_loss']);
export const SIDES = Object.freeze(['long', 'short']);

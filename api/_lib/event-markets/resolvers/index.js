// Resolver registry for Event Markets: one module per source_kind, each exporting
// describe(rule) (plain words for the UI) and resolve(market, { now, deps }).

import * as arena from './arena_tournament.js';
import * as leaderboard from './event_leaderboard.js';
import * as cohort from './launch_cohort.js';
import * as round from './build_round.js';
import * as bounty from './bounty.js';

const RESOLVERS = {
	arena_tournament: arena,
	event_leaderboard: leaderboard,
	launch_cohort: cohort,
	build_round: round,
	bounty,
};

const CUSTOM_RULE = 'A custom market has no automatic data source. It resolves only when an admin records the result with a written reason; if no result is recorded before the market times out, it is void and picks are refunded.';

/** The resolver module for a source kind, or null for `custom`. */
export function resolverFor(sourceKind) {
	return RESOLVERS[sourceKind] || null;
}

/** Plain-language resolution rule for a market, shown on its page. */
export function describeRule(market) {
	const r = resolverFor(market.source_kind);
	return r ? r.describe(market.resolution_rule || {}) : CUSTOM_RULE;
}

export const RESOLVER_KINDS = Object.keys(RESOLVERS);

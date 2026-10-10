// Standings routes for Event Markets: leaderboard (season, all-time, per source
// kind), season list, season reward list and the signed-in account's own stats.
// Mounted by routes.js. Scoring rules: scoring.js; guide: docs/event-markets.md
// (section Scoring and seasons).

import { apiError, strParam, intParam } from '../agents-v1/http.js';
import { SOURCE_KINDS } from './index.js';
import { getLeaderboard, listSeasons, getAccountStats, getSeasonRewards } from './leaderboard.js';
import { CONFIG } from './scoring.js';

async function leaderboardRoute({ query, principal }) {
	const scope = query.scope === 'all' ? 'all' : 'season';
	const out = await getLeaderboard({
		scope,
		season: strParam(query.season, { name: 'season', max: 7 }),
		sourceKind: strParam(query.source_kind, { name: 'source_kind', max: 40 }) || 'all',
		limit: intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 25 }),
		viewerId: principal?.userId ?? null,
	});
	if (out.error === 'invalid_season') throw apiError(400, 'invalid_season', 'season must look like 2026-Q4.');
	if (out.error === 'invalid_source_kind') throw apiError(400, 'invalid_source_kind', `source_kind must be all or one of ${SOURCE_KINDS.join(', ')}.`);
	return { ...out, rules: CONFIG };
}

async function seasonsRoute() {
	return { seasons: await listSeasons() };
}

async function rewardsRoute({ params }) {
	const out = await getSeasonRewards(params.id);
	if (out.error) throw apiError(400, 'invalid_season', 'season must look like 2026-Q4.');
	return out;
}

async function meRoute({ principal }) {
	return getAccountStats(principal.userId);
}

export function standingsRoutes(prefix = '/event-markets') {
	return [
		{ method: 'GET', path: `${prefix}/leaderboard`, name: 'event_markets.leaderboard', auth: 'optional', handler: leaderboardRoute },
		{ method: 'GET', path: `${prefix}/seasons`, name: 'event_markets.seasons', auth: 'public', handler: seasonsRoute },
		{ method: 'GET', path: `${prefix}/seasons/:id/rewards`, name: 'event_markets.rewards', auth: 'public', handler: rewardsRoute },
		{ method: 'GET', path: `${prefix}/me`, name: 'event_markets.me', auth: 'required', handler: meRoute },
	];
}

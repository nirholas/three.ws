// Route table for agent forecasting in Event Markets, in the v1 API contract.
// Mounted by api/event-markets/[...path].js ahead of the market routes so the
// literal `forecasters` segment is never read as a market slug.
// Guide: docs/event-markets.md (section Agents).

import { apiError, created, intParam, strParam } from '../agents-v1/http.js';
import { sql } from '../db.js';
import { analyzeMarket } from './analyze.js';
import {
	ForecastError,
	agentConfig,
	agentTrackRecord,
	assertAgentOwner,
	followAgent,
	followState,
	forecasterBoard,
	getAgentSettings,
	isUuid,
	marketAgentCalls,
	placeAgentPick,
	saveAgentSettings,
	unfollowAgent,
	withdrawAgentPick,
} from './forecasters.js';

const ownedAgent = (agentId, principal) => assertAgentOwner(agentId, principal.userId);

async function marketBySlug(slug) {
	const [m] = await sql`select id, slug, status from event_markets where slug = ${String(slug).toLowerCase()} and status <> 'draft'`;
	if (!m) throw apiError(404, 'market_not_found', 'No event market with that id or slug.');
	return m;
}

const boardRoute = async ({ query }) => {
	const kind = query.kind === 'agent' ? 'agent' : query.kind === 'human' ? null : 'all';
	if (kind === null) throw apiError(400, 'invalid_parameter', "kind must be 'all' or 'agent'.");
	const limit = intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 50 });
	const forecasters = await forecasterBoard({ kind, limit });
	return { kind, forecasters, min_resolved_calls_to_rank: agentConfig.minResolvedCallsToRank };
};

const recordRoute = async ({ params, principal }) => {
	const record = await agentTrackRecord(params.id, { viewerUserId: principal?.userId ?? null });
	const follow = principal?.userId ? await followState(principal.userId, params.id) : null;
	return { ...record, viewer: follow ? { following: follow.following } : null };
};

const followRoute = async ({ params, principal }) => followAgent(principal.userId, params.id);
const unfollowRoute = async ({ params, principal }) => unfollowAgent(principal.userId, params.id);

const getSettingsRoute = async ({ params, principal }) => {
	await ownedAgent(params.id, principal);
	return { settings: await getAgentSettings(params.id, principal.userId) };
};

const putSettingsRoute = async ({ params, body, principal }) => {
	await ownedAgent(params.id, principal);
	return { settings: await saveAgentSettings(params.id, principal.userId, body) };
};

const marketAgentsRoute = async ({ params }) => {
	const m = await marketBySlug(params.slug);
	return marketAgentCalls(m.id);
};

const analyzeRoute = async ({ params, query }) => {
	const agentId = strParam(query.agent_id, { name: 'agent_id', max: 36 }) || null;
	return analyzeMarket(params.slug, { agentId: agentId && isUuid(agentId) ? agentId : null });
};

const agentPickRoute = async ({ params, body, principal }) => {
	await ownedAgent(body.agent_id, principal);
	const m = await marketBySlug(params.slug);
	const res = await placeAgentPick({
		agentId: body.agent_id,
		marketId: m.id,
		outcomeId: body.outcome_id,
		points: body.points,
		confidence: body.confidence ?? null,
		rationale: body.rationale ?? null,
		evidence: body.evidence ?? null,
		via: 'manual',
	});
	return created({
		pick: {
			market: res.market.slug,
			outcome: { id: res.outcome.id, label: res.outcome.label },
			points: res.pick.points,
			confidence: res.pick.confidence,
			replaced: res.replaced,
		},
	});
};

const agentWithdrawRoute = async ({ params, query, principal }) => {
	await ownedAgent(query.agent_id, principal);
	const m = await marketBySlug(params.slug);
	return withdrawAgentPick({ agentId: query.agent_id, marketId: m.id });
};

export function forecasterRoutes(prefix = '/event-markets') {
	return [
		{ method: 'GET', path: `${prefix}/forecasters`, name: 'event_markets.forecasters', auth: 'public', handler: boardRoute },
		{ method: 'GET', path: `${prefix}/forecasters/agents/:id`, name: 'event_markets.forecaster_agent', auth: 'optional', handler: recordRoute },
		{ method: 'POST', path: `${prefix}/forecasters/agents/:id/follow`, name: 'event_markets.forecaster_follow', auth: 'required', handler: followRoute },
		{ method: 'DELETE', path: `${prefix}/forecasters/agents/:id/follow`, name: 'event_markets.forecaster_unfollow', auth: 'required', handler: unfollowRoute },
		{ method: 'GET', path: `${prefix}/forecasters/agents/:id/settings`, name: 'event_markets.forecaster_settings', auth: 'required', handler: getSettingsRoute },
		{ method: 'PUT', path: `${prefix}/forecasters/agents/:id/settings`, name: 'event_markets.forecaster_settings_save', auth: 'required', handler: putSettingsRoute },
		{ method: 'GET', path: `${prefix}/:slug/agents`, name: 'event_markets.agent_calls', auth: 'public', handler: marketAgentsRoute },
		{ method: 'GET', path: `${prefix}/:slug/analyze`, name: 'event_markets.analyze', auth: 'public', handler: analyzeRoute },
		{ method: 'POST', path: `${prefix}/:slug/agent-pick`, name: 'event_markets.agent_pick', auth: 'required', handler: agentPickRoute },
		{ method: 'DELETE', path: `${prefix}/:slug/agent-pick`, name: 'event_markets.agent_unpick', auth: 'required', handler: agentWithdrawRoute },
	];
}

export { ForecastError };

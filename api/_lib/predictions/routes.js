// Route table for prediction markets, in the v1 API contract
// (api/_lib/agents-v1/http.js: one envelope, per-route auth and scopes, CSRF on
// cookie writes, Idempotency-Key replay).
//
// Two mounts share it:
//   /api/v1/agents/:id/predictions/*   api/v1/agents/[id]/predictions/[...path].js
//   /api/predictions/*                 api/predictions/[...path].js (public reads only)
//
// Reads (events, categories, event, market) are public. Everything touching
// the agent (positions, previews, orders, limits, watches) is owner-only, and
// the three fund-moving routes also require the signed real-funds agreement,
// confirm_trade: true, and a fresh preview_id.

import { apiError, created, requireUuid, strParam, intParam } from '../agents-v1/http.js';
import { currentSignatureFor, agreementRequirement } from '../real-funds-agreement.js';
import { getPredictionLimits, setPredictionLimits } from '../agent-trade-guards.js';
import { getVenue, DEFAULT_VENUE, listVenues } from './index.js';
import { summarizeBook } from './book.js';
import {
	previewOpen, executeOpen, previewClose, executeClose, previewRedeem, executeRedeem,
	agentPositions, loadOwnedAgent, describeError,
} from './engine.js';
import { createWatch, listWatches, deleteWatch } from './watch.js';

const SORTS = new Set(['volume', 'volume_24h', 'close', 'new']);
const RANGES = new Set(['1d', '1w', '1m', 'max']);
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Re-throw engine errors as v1 ApiErrors so the envelope carries their code. */
async function run(fn) {
	try {
		return await fn();
	} catch (err) {
		const d = describeError(err);
		if (d) throw apiError(d.status, d.code, d.message, d.detail);
		throw err;
	}
}

function venueId(q) {
	return q?.venue ? String(q.venue) : DEFAULT_VENUE;
}

function venueRef(id) {
	if (typeof id !== 'string' || !ID_RE.test(id)) throw apiError(404, 'not_found', 'No market or event with that id.');
	return id;
}

// ── public reads ─────────────────────────────────────────────────────────────

async function listEventsRoute({ query }) {
	const sort = SORTS.has(query.sort) ? query.sort : 'volume';
	const out = await run(() => getVenue(venueId(query)).listEvents({
		q: strParam(query.q, { name: 'q', max: 120 }) || '',
		category: strParam(query.category, { name: 'category', max: 40 }),
		subcategory: strParam(query.subcategory, { name: 'subcategory', max: 40 }),
		sort,
		start: intParam(query.start, { name: 'start', min: 0, max: 10_000, fallback: 0 }),
		limit: intParam(query.limit, { name: 'limit', min: 1, max: 50, fallback: 24 }),
		includeClosed: query.include_closed === 'true',
	}));
	return { ...out, venue: venueId(query), sort };
}

async function categoriesRoute({ query }) {
	return { categories: await run(() => getVenue(venueId(query)).listCategories()), venues: listVenues() };
}

async function marketDetail(venue, market, range) {
	const [bookRaw, history] = await Promise.all([
		market.tradable ? venue.getOrderbook(market.id).catch(() => null) : null,
		venue.getPriceHistory(market, range).catch(() => ({ source: null, range, points: [], unavailable: true })),
	]);
	return { ...market, book: bookRaw ? summarizeBook(bookRaw) : null, history };
}

async function eventRoute({ params, query }) {
	const venue = getVenue(venueId(query));
	const range = RANGES.has(query.range) ? query.range : '1w';
	const event = await run(() => venue.getEvent(venueRef(params.eventId)));
	const lead = event.markets.find((m) => m.id === query.market) || event.markets[0] || null;
	const leadDetail = lead ? await run(() => marketDetail(venue, lead, range)) : null;
	return { ...event, selected_market: leadDetail };
}

async function marketRoute({ params, query }) {
	const venue = getVenue(venueId(query));
	const range = RANGES.has(query.range) ? query.range : '1w';
	const market = await run(() => venue.getMarket(venueRef(params.marketId)));
	return run(() => marketDetail(venue, market, range));
}

export function publicRoutes(prefix) {
	return [
		{ method: 'GET', path: `${prefix}/events`, name: 'predictions.events', auth: 'public', handler: listEventsRoute },
		{ method: 'GET', path: `${prefix}/categories`, name: 'predictions.categories', auth: 'public', handler: categoriesRoute },
		{ method: 'GET', path: `${prefix}/event/:eventId`, name: 'predictions.event', auth: 'public', handler: eventRoute },
		{ method: 'GET', path: `${prefix}/market/:marketId`, name: 'predictions.market', auth: 'public', handler: marketRoute },
	];
}

// ── owner routes ─────────────────────────────────────────────────────────────

async function requireAgreement(userId) {
	let signed;
	try {
		signed = await currentSignatureFor(userId);
	} catch {
		throw apiError(503, 'agreement_check_unavailable', 'Could not verify your signed real-funds agreements, so nothing was sent. Try again in a moment.');
	}
	if (!signed) {
		const r = agreementRequirement();
		throw apiError(403, 'risk_ack_required', 'Sign the real-funds agreements (Terms of Service, Risk Disclosure, and Agent Wallet Agreement) before moving funds. Nothing was sent.', r);
	}
}

const agentOf = (params) => requireUuid(params.id, 'agent');
const sourceOf = (principal) => (principal.source === 'session' ? 'owner' : `api:${principal.source}`);

export const agentRoutes = [
	...publicRoutes('/agents/:id/predictions'),
	{
		method: 'GET', path: '/agents/:id/predictions/positions', name: 'predictions.positions', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal }) => run(() => agentPositions({ agentId: agentOf(params), userId: principal.userId })),
	},
	{
		method: 'GET', path: '/agents/:id/predictions/limits', name: 'predictions.limits.get', auth: 'required', scope: 'wallet:read',
		handler: async ({ params, principal }) => {
			const agent = await run(() => loadOwnedAgent(agentOf(params), principal.userId));
			return getPredictionLimits(agent.meta);
		},
	},
	{
		method: 'PUT', path: '/agents/:id/predictions/limits', name: 'predictions.limits.set', auth: 'required', scope: 'wallet:write',
		handler: ({ params, principal, body, req }) => run(() => setPredictionLimits(agentOf(params), principal.userId, body, { req })),
	},
	{
		method: 'POST', path: '/agents/:id/predictions/open/preview', name: 'predictions.open.preview', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, body }) => run(() => previewOpen({
			agentId: agentOf(params), userId: principal.userId, venueId: body.venue,
			marketId: body.market_id, side: body.side, stakeUsd: body.stake_usd, maxPrice: body.max_price,
		})),
	},
	{
		method: 'POST', path: '/agents/:id/predictions/open', name: 'predictions.open', auth: 'required', scope: 'wallet:write',
		handler: async ({ params, principal, body, req }) => {
			await requireAgreement(principal.userId);
			return run(() => executeOpen({ agentId: agentOf(params), userId: principal.userId, previewId: body.preview_id, confirm: body.confirm_trade, req, source: sourceOf(principal) }));
		},
	},
	{
		method: 'POST', path: '/agents/:id/predictions/close/preview', name: 'predictions.close.preview', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, body }) => run(() => previewClose({
			agentId: agentOf(params), userId: principal.userId, positionId: body.position_id, contracts: body.contracts, minPrice: body.min_price,
		})),
	},
	{
		method: 'POST', path: '/agents/:id/predictions/close', name: 'predictions.close', auth: 'required', scope: 'wallet:write',
		handler: async ({ params, principal, body, req }) => {
			await requireAgreement(principal.userId);
			return run(() => executeClose({ agentId: agentOf(params), userId: principal.userId, previewId: body.preview_id, confirm: body.confirm_trade, req, source: sourceOf(principal) }));
		},
	},
	{
		method: 'POST', path: '/agents/:id/predictions/redeem/preview', name: 'predictions.redeem.preview', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, body }) => run(() => previewRedeem({ agentId: agentOf(params), userId: principal.userId, positionId: body.position_id })),
	},
	{
		method: 'POST', path: '/agents/:id/predictions/redeem', name: 'predictions.redeem', auth: 'required', scope: 'wallet:write',
		handler: async ({ params, principal, body, req }) => {
			await requireAgreement(principal.userId);
			return run(() => executeRedeem({ agentId: agentOf(params), userId: principal.userId, previewId: body.preview_id, confirm: body.confirm_trade, req, source: sourceOf(principal) }));
		},
	},
	{
		method: 'GET', path: '/agents/:id/predictions/watch', name: 'predictions.watch.list', auth: 'required', scope: 'wallet:read',
		handler: async ({ params, principal }) => {
			const agentId = agentOf(params);
			await run(() => loadOwnedAgent(agentId, principal.userId));
			return { watches: await run(() => listWatches({ agentId, userId: principal.userId })) };
		},
	},
	{
		method: 'POST', path: '/agents/:id/predictions/watch', name: 'predictions.watch.create', auth: 'required', scope: 'wallet:write',
		handler: async ({ params, principal, body }) => {
			const agentId = agentOf(params);
			await run(() => loadOwnedAgent(agentId, principal.userId));
			return created(await run(() => createWatch({ agentId, userId: principal.userId, body })));
		},
	},
	{
		method: 'DELETE', path: '/agents/:id/predictions/watch/:watchId', name: 'predictions.watch.delete', auth: 'required', scope: 'wallet:write',
		handler: async ({ params, principal }) => {
			await run(() => loadOwnedAgent(agentOf(params), principal.userId));
			return run(() => deleteWatch({ userId: principal.userId, watchId: requireUuid(params.watchId, 'watch') }));
		},
	},
];

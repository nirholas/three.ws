// Route table for Event Markets, in the v1 API contract (one envelope, per-route
// auth, CSRF on cookie writes). Mounted at /api/event-markets/* by
// api/event-markets/[...path].js. Reads are public; picks need a session.
// Literal segments (leaderboard, seasons, me, forecasters) come before the
// `:slug` routes so they are never read as a market slug.
// Guide: docs/event-markets.md.

import { apiError, created, strParam, intParam } from '../agents-v1/http.js';
import { sql } from '../db.js';
import { isAdminUser } from '../admin.js';
import { limits } from '../rate-limit.js';
import {
	EventMarketError, SOURCE_KINDS, createMarket, getMarket, getPicks, listMarkets, lockMarket, marketHistory, placePick, resolveMarket,
	updateMarket, voidMarket, withdrawPick,
} from './index.js';
import { standingsRoutes } from './standings-routes.js';
import { forecasterRoutes } from './forecaster-routes.js';
import { stakingRoutes } from './staking/routes.js';

/** Typed seam errors become the v1 envelope; anything else propagates. */
async function guarded(fn) {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof EventMarketError) throw apiError(err.status, err.code, err.message, err.detail || undefined);
		throw err;
	}
}

const listRoute = ({ query }) =>
	guarded(async () => {
		const status = strParam(query.status, { name: 'status', max: 10 }) || 'open';
		const sourceKind = strParam(query.source_kind, { name: 'source_kind', max: 40 }) || null;
		if (sourceKind && !SOURCE_KINDS.includes(sourceKind)) {
			throw apiError(400, 'invalid_source_kind', `source_kind must be one of ${SOURCE_KINDS.join(', ')}.`);
		}
		return listMarkets({
			status,
			sourceKind,
			q: strParam(query.q, { name: 'q', max: 80 }) || null,
			limit: intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 20 }),
			cursor: strParam(query.cursor, { name: 'cursor', max: 300 }) || null,
		});
	});

const marketRoute = ({ params, principal }) => guarded(() => getMarket(params.slug, { viewer: principal?.userId ?? null }));

const historyRoute = ({ params, query }) =>
	guarded(() => marketHistory(params.slug, { maxPoints: intParam(query.max_points, { name: 'max_points', min: 2, max: 500, fallback: 200 }) }));

const picksRoute = ({ params, principal }) =>
	guarded(async () => {
		const market = await getMarket(params.slug);
		return { picks: await getPicks({ marketId: market.id, accountId: principal.userId }) };
	});

/** Per-account and per-IP ceilings on every write, before it touches the database. */
async function throttleWrite(principal, ip) {
	const [user, byIp] = await Promise.all([limits.eventMarketWriteUser(principal.userId), limits.eventMarketWriteIp(ip || 'unknown')]);
	const hit = [user, byIp].find((r) => !r.success);
	if (hit) {
		const retryAfterSeconds = Math.max(1, Math.ceil(((hit.reset ?? Date.now() + 60_000) - Date.now()) / 1000));
		throw apiError(429, 'rate_limited', `Too many pick changes. Try again in ${retryAfterSeconds} seconds.`, { retryAfterSeconds });
	}
}

/** Admin gate: the principal must be a signed-in admin. */
async function requireAdminPrincipal(principal) {
	const [user] = await sql`select * from users where id = ${principal.userId} and deleted_at is null`;
	if (!user || !(await isAdminUser(user))) throw apiError(403, 'forbidden', 'Only a three.ws admin can create or change markets.');
}

const pickRoute = ({ params, body, principal, ip }) =>
	guarded(async () => {
		await throttleWrite(principal, ip);
		return created(await placePick({ market: params.slug, accountId: principal.userId, outcomeId: body.outcome_id, points: body.points }));
	});

const withdrawRoute = ({ params, principal, ip }) =>
	guarded(async () => {
		await throttleWrite(principal, ip);
		return withdrawPick({ market: params.slug, accountId: principal.userId });
	});

const adminWrite = (fn) => (ctx) =>
	guarded(async () => {
		await requireAdminPrincipal(ctx.principal);
		await throttleWrite(ctx.principal, ctx.ip);
		return fn(ctx);
	});

const adminCreate = adminWrite(async ({ body, principal }) => created(await createMarket({ ...body, created_by: principal.userId })));
const adminEdit = adminWrite(({ params, body }) => updateMarket(params.slug, body));
const adminLock = adminWrite(({ params }) => lockMarket(params.slug));
const adminVoid = adminWrite(({ params, body }) => voidMarket(params.slug, body?.reason ?? null));
const adminResolve = adminWrite(({ params, body }) => resolveMarket(params.slug, body?.winner_outcome_id));

export function publicRoutes(prefix = '/event-markets') {
	return [
		...standingsRoutes(prefix),
		...forecasterRoutes(prefix),
		{ method: 'GET', path: prefix, name: 'event_markets.list', auth: 'public', handler: listRoute },
		{ method: 'GET', path: `${prefix}/:slug`, name: 'event_markets.get', auth: 'optional', handler: marketRoute },
		{ method: 'GET', path: `${prefix}/:slug/history`, name: 'event_markets.history', auth: 'public', handler: historyRoute },
		{ method: 'GET', path: `${prefix}/:slug/picks`, name: 'event_markets.picks', auth: 'required', handler: picksRoute },
		{ method: 'POST', path: `${prefix}/:slug/pick`, name: 'event_markets.pick', auth: 'required', handler: pickRoute },
		...stakingRoutes(prefix),
		{ method: 'DELETE', path: `${prefix}/:slug/pick`, name: 'event_markets.withdraw', auth: 'required', handler: withdrawRoute },
		{ method: 'POST', path: prefix, name: 'event_markets.create', auth: 'required', handler: adminCreate },
		{ method: 'PATCH', path: `${prefix}/:slug`, name: 'event_markets.edit', auth: 'required', handler: adminEdit },
		{ method: 'POST', path: `${prefix}/:slug/lock`, name: 'event_markets.lock', auth: 'required', handler: adminLock },
		{ method: 'POST', path: `${prefix}/:slug/void`, name: 'event_markets.void', auth: 'required', handler: adminVoid },
		{ method: 'POST', path: `${prefix}/:slug/resolve`, name: 'event_markets.resolve', auth: 'required', handler: adminResolve },
	];
}

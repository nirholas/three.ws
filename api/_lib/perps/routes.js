// Route table for perpetual futures, in the v1 API contract
// (api/_lib/agents-v1/http.js: one envelope, per-route auth and scopes, CSRF on
// cookie writes, Idempotency-Key replay). Mounted at
// /api/v1/agents/:id/perps/* by api/v1/agents/[id]/perps/[...path].js.
//
// Market reads are public. Everything touching the agent is owner-only. Every
// execute takes the preview_id from its preview, confirm_trade: true, and an
// Idempotency-Key header, and replays the first result for a repeated key.
// Guide: docs/perps.md.

import { apiError, requireUuid, strParam, intParam } from '../agents-v1/http.js';
import { DEFAULT_VENUE } from './index.js';
import { loosenedPerpsKeys, PERPS_LIMIT_DEFAULTS } from './limits.js';
import { recentAlerts } from './alerts.js';
import * as perps from './service.js';

const STREAM_MAX_MS = 5 * 60_000;
const HEARTBEAT_MS = 15_000;

/** Re-throw service errors as v1 ApiErrors so the envelope carries their code. */
async function run(fn) {
	try {
		return await fn();
	} catch (err) {
		const d = perps.describeError(err);
		if (d) throw apiError(d.status, d.code, d.message, d.detail);
		throw err;
	}
}

const agentOf = (params) => requireUuid(params.id, 'agent');
const sourceOf = (principal) => (principal.source === 'session' ? 'owner' : `api:${principal.source}`);
const venueOf = (v) => (v ? String(v) : DEFAULT_VENUE);
const modeOf = (v) => (v == null || v === '' ? null : String(v));

function idempotencyHeader(req) {
	const raw = req.headers['idempotency-key'];
	if (typeof raw !== 'string' || !raw.trim()) {
		throw apiError(400, 'idempotency_key_required', 'Every perps execute needs an Idempotency-Key header, so a retried request never trades twice.');
	}
	return raw.trim();
}

function executeRoute(name, path, fn) {
	return {
		method: 'POST', path, name, auth: 'required', scope: 'wallet:write',
		handler: ({ params, principal, body, req }) => {
			const key = idempotencyHeader(req);
			return run(() => fn({
				agentId: agentOf(params), userId: principal.userId, previewId: body.preview_id,
				confirm: body.confirm_trade, idempotencyKey: key, req, source: sourceOf(principal),
			}));
		},
	};
}

/** GET /agents/:id/perps/stream: the live tracker as server-sent events. */
async function streamRoute({ req, res, params, principal, query }) {
	const agentId = agentOf(params);
	const venueId = venueOf(query.venue);
	const mode = modeOf(query.mode);
	const intervalMs = intParam(query.interval, { name: 'interval', min: 2, max: 30, fallback: 4 }) * 1000;
	// The first frame validates ownership and mode before the stream opens, so a
	// bad request still gets a normal JSON error.
	let frame = await run(() => perps.trackerFrame({ agentId, userId: principal.userId, venueId, mode }));

	res.writeHead(200, {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache, no-transform',
		'x-accel-buffering': 'no',
		connection: 'keep-alive',
	});
	let closed = false;
	req.on('close', () => {
		closed = true;
	});
	const send = (event, data) => {
		if (closed || res.writableEnded) return;
		res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};
	const pause = (ms) => new Promise((r) => setTimeout(r, ms));
	const stop = Date.now() + STREAM_MAX_MS;
	let lastBeat = Date.now();

	send('frame', frame);
	while (!closed && Date.now() < stop) {
		await pause(intervalMs);
		if (closed) break;
		try {
			frame = await perps.trackerFrame({ agentId, userId: principal.userId, venueId, mode });
			send('frame', frame);
			lastBeat = Date.now();
		} catch (err) {
			const d = perps.describeError(err);
			send('error', { code: d?.code || 'tracker_unavailable', message: d?.message || 'Could not read the account this tick; retrying.' });
			if (d && d.status >= 400 && d.status < 500) break;
		}
		if (Date.now() - lastBeat >= HEARTBEAT_MS && !closed) {
			res.write(': keepalive\n\n');
			lastBeat = Date.now();
		}
	}
	if (!closed) send('reconnect', { after_ms: 0 });
	if (!res.writableEnded) res.end();
}

export const agentRoutes = [
	{
		method: 'GET', path: '/agents/:id/perps/markets', name: 'perps.markets', auth: 'public',
		handler: ({ query }) => run(() => perps.markets({ venueId: venueOf(query.venue), kind: strParam(query.kind, { name: 'kind', max: 20 }) })),
	},
	{
		method: 'GET', path: '/agents/:id/perps/market/:symbol', name: 'perps.market', auth: 'public',
		handler: ({ params, query }) => run(() => perps.marketData({
			venueId: venueOf(query.venue),
			symbol: strParam(params.symbol, { name: 'symbol', max: 24 }),
			depth: intParam(query.depth, { name: 'depth', min: 1, max: 100, fallback: 20 }),
			trades: intParam(query.trades, { name: 'trades', min: 0, max: 100, fallback: 30 }),
			funding: intParam(query.funding, { name: 'funding', min: 0, max: 168, fallback: 48 }),
		})),
	},
	{
		method: 'GET', path: '/agents/:id/perps/account', name: 'perps.account', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, query }) => run(() => perps.account({ agentId: agentOf(params), userId: principal.userId, venueId: venueOf(query.venue), mode: modeOf(query.mode) })),
	},
	{
		method: 'GET', path: '/agents/:id/perps/positions', name: 'perps.positions', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, query }) => run(() => perps.positions({
			agentId: agentOf(params), userId: principal.userId, venueId: venueOf(query.venue), mode: modeOf(query.mode),
			limit: intParam(query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 }),
		})),
	},
	{
		method: 'GET', path: '/agents/:id/perps/executions', name: 'perps.executions', auth: 'required', scope: 'wallet:read',
		handler: async ({ params, principal, query }) => {
			const agentId = agentOf(params);
			await run(() => perps.loadOwnedAgent(agentId, principal.userId));
			const mode = modeOf(query.mode);
			if (mode && mode !== 'paper' && mode !== 'live') throw apiError(400, 'invalid_mode', 'mode must be "paper" or "live".');
			return { executions: await perps.listExecutions(agentId, { mode, limit: intParam(query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 }) }) };
		},
	},
	{
		method: 'GET', path: '/agents/:id/perps/alerts', name: 'perps.alerts', auth: 'required', scope: 'wallet:read',
		handler: async ({ params, principal, query }) => {
			const agentId = agentOf(params);
			await run(() => perps.loadOwnedAgent(agentId, principal.userId));
			return { alerts: await recentAlerts(agentId, { limit: intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 20 }) }) };
		},
	},
	{
		method: 'GET', path: '/agents/:id/perps/stream', name: 'perps.stream', auth: 'required', scope: 'wallet:read',
		handler: streamRoute,
	},
	{
		method: 'GET', path: '/agents/:id/perps/limits', name: 'perps.limits.get', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal }) => run(async () => ({ ...(await perps.getLimits({ agentId: agentOf(params), userId: principal.userId })), defaults: PERPS_LIMIT_DEFAULTS })),
	},
	{
		method: 'PUT', path: '/agents/:id/perps/limits', name: 'perps.limits.set', auth: 'required', scope: 'wallet:write',
		handler: async ({ params, principal, body, req }) => {
			const agentId = agentOf(params);
			if (principal.source !== 'session') {
				const { limits } = await run(() => perps.getLimits({ agentId, userId: principal.userId }));
				const loosened = loosenedPerpsKeys(limits, body);
				if (loosened.length) {
					throw apiError(403, 'owner_session_required', 'Turning live trading on, resuming after the kill switch, or raising a cap must be done by the owner while signed in. An API key may only tighten perps limits.', { keys: loosened });
				}
			}
			return run(() => perps.updateLimits({ agentId, userId: principal.userId, patch: body, req }));
		},
	},
	{
		method: 'POST', path: '/agents/:id/perps/deposit/preview', name: 'perps.deposit.preview', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, body }) => run(() => perps.previewDeposit({ agentId: agentOf(params), userId: principal.userId, venueId: venueOf(body.venue), mode: modeOf(body.mode), amountUsd: body.amount_usd })),
	},
	executeRoute('perps.deposit', '/agents/:id/perps/deposit', perps.executeDeposit),
	{
		method: 'POST', path: '/agents/:id/perps/withdraw/preview', name: 'perps.withdraw.preview', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, body }) => run(() => perps.previewWithdraw({ agentId: agentOf(params), userId: principal.userId, venueId: venueOf(body.venue), mode: modeOf(body.mode), amountUsd: body.amount_usd })),
	},
	executeRoute('perps.withdraw', '/agents/:id/perps/withdraw', perps.executeWithdraw),
	{
		method: 'POST', path: '/agents/:id/perps/order/preview', name: 'perps.order.preview', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, body }) => run(() => perps.previewOrder({
			agentId: agentOf(params), userId: principal.userId, venueId: venueOf(body.venue), mode: modeOf(body.mode),
			symbol: body.symbol, side: body.side, type: body.type, size: body.size, marginUsd: body.margin_usd, leverage: body.leverage,
			price: body.price, triggerPrice: body.trigger_price, sizePercent: body.size_percent, reduceOnly: body.reduce_only, slippageBps: body.slippage_bps,
		})),
	},
	executeRoute('perps.order', '/agents/:id/perps/order', perps.executeOrder),
	{
		method: 'POST', path: '/agents/:id/perps/cancel/preview', name: 'perps.cancel.preview', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, body }) => run(() => perps.previewCancel({ agentId: agentOf(params), userId: principal.userId, venueId: venueOf(body.venue), mode: modeOf(body.mode), orderId: body.order_id, kind: body.kind || null })),
	},
	executeRoute('perps.cancel', '/agents/:id/perps/cancel', perps.executeCancel),
	{
		method: 'POST', path: '/agents/:id/perps/flatten/preview', name: 'perps.flatten.preview', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, body }) => run(() => perps.previewFlatten({ agentId: agentOf(params), userId: principal.userId, venueId: venueOf(body.venue), mode: modeOf(body.mode) })),
	},
	executeRoute('perps.flatten', '/agents/:id/perps/flatten', perps.executeFlatten),
];

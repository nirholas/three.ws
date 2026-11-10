/**
 * Robinhood Crypto connector REST API. The owner's own Crypto Trading API key,
 * spend caps, holdings, quotes and orders. Crypto pairs only.
 * Service layer: api/_lib/robinhood/service.js. Docs: docs/robinhood-crypto.md.
 *
 * vercel.json maps /api/v1/robinhood/crypto[/...] here.
 *
 *   GET    /api/v1/robinhood/crypto                  connection status + caps + today's spend
 *   PUT    /api/v1/robinhood/crypto/credentials      { api_key, private_key, per_order_cap_usd?, daily_cap_usd? }
 *   DELETE /api/v1/robinhood/crypto/credentials      revoke (the order ledger is kept)
 *   PATCH  /api/v1/robinhood/crypto/settings         { per_order_cap_usd?, daily_cap_usd?, trading_enabled? }
 *   GET    /api/v1/robinhood/crypto/holdings         positions priced at the live bid
 *   GET    /api/v1/robinhood/crypto/quote            ?symbol=ASSET-USD (repeat or comma-separate for several)
 *   GET    /api/v1/robinhood/crypto/orders           ?limit (the ledger, newest first)
 *   POST   /api/v1/robinhood/crypto/orders/preview   { symbol, side, type?, quantity | amount_usd, limit_price? }
 *   POST   /api/v1/robinhood/crypto/orders           { preview_id, confirm_order: true }
 *
 * Envelope (the v1 contract): success { data, meta: { requestId, timestamp } },
 * failure { error: { code, message, details }, meta }.
 *
 * Auth: credentials and settings are browser-session only (writes need
 * X-CSRF-Token), so no API key can paste a credential or raise its own cap.
 * Reads accept a session or a bearer with `wallet:read`; previews and orders a
 * session or a bearer with `wallet:trade` (connector keys never carry it).
 */

import { randomUUID } from 'node:crypto';
import { cors, readJson, setRateLimitHeaders } from '../../_lib/http.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../../_lib/auth.js';
import { checkCsrf } from '../../_lib/csrf.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import * as connector from '../../_lib/robinhood/service.js';

const SESSION_ONLY = 'session';
const READ_SCOPE = 'wallet:read';
const TRADE_SCOPE = 'wallet:trade';

function send(res, status, body) {
	if (res.headersSent || res.writableEnded) return;
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(JSON.stringify(body));
}

const meta = (ctx) => ({ requestId: ctx.requestId, timestamp: new Date().toISOString() });

function sendError(res, ctx, status, code, message, details = null) {
	send(res, status, { error: { code, message, details }, meta: meta(ctx) });
}

async function resolvePrincipal(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session', scope: null, ip: clientIp(req) };
	const bearer = await authenticateBearer(extractBearer(req));
	if (!bearer) return null;
	return { userId: bearer.userId, source: bearer.source || 'apikey', scope: bearer.scope || '', ip: clientIp(req) };
}

const ROUTES = {
	'GET ': { scope: READ_SCOPE, run: (c) => connector.getConnection(c.base) },
	'PUT credentials': {
		scope: SESSION_ONLY,
		run: (c) => connector.saveCredentials({ ...c.base, apiKey: c.body.api_key, privateKey: c.body.private_key, perOrderCapUsd: c.body.per_order_cap_usd, dailyCapUsd: c.body.daily_cap_usd }),
	},
	'DELETE credentials': { scope: SESSION_ONLY, run: (c) => connector.revoke(c.base) },
	'PATCH settings': {
		scope: SESSION_ONLY,
		run: (c) => connector.updateSettings({ ...c.base, perOrderCapUsd: c.body.per_order_cap_usd, dailyCapUsd: c.body.daily_cap_usd, tradingEnabled: c.body.trading_enabled }),
	},
	'GET holdings': { scope: READ_SCOPE, run: (c) => connector.holdings(c.base) },
	'GET quote': { scope: READ_SCOPE, run: (c) => connector.quote({ ...c.base, symbols: c.url.searchParams.getAll('symbol').flatMap((s) => s.split(',')) }) },
	'GET orders': { scope: READ_SCOPE, run: (c) => connector.listOrders({ ...c.base, limit: c.url.searchParams.get('limit') }) },
	'POST orders/preview': {
		scope: TRADE_SCOPE,
		status: 201,
		run: (c) =>
			connector.previewOrder({
				...c.base,
				source: c.principal.source === 'session' ? 'session' : 'apikey',
				symbol: c.body.symbol,
				side: c.body.side,
				type: c.body.type,
				quantity: c.body.quantity,
				amountUsd: c.body.amount_usd,
				limitPrice: c.body.limit_price,
			}),
	},
	'POST orders': { scope: TRADE_SCOPE, run: (c) => connector.placeOrder({ ...c.base, previewId: c.body.preview_id, confirmOrder: c.body.confirm_order }) },
};

const KNOWN_PATHS = new Set(Object.keys(ROUTES).map((k) => k.slice(k.indexOf(' ') + 1)));

export default async function handler(req, res) {
	const ctx = { requestId: randomUUID() };
	res.setHeader('x-request-id', ctx.requestId);
	if (cors(req, res, { methods: 'GET,PUT,PATCH,POST,DELETE,OPTIONS', credentials: true })) return;

	const url = new URL(req.url, 'http://x');
	const m = url.pathname.match(/^\/api\/v1\/robinhood\/crypto\/?(.*)$/);
	const sub = (m ? m[1] : url.searchParams.get('path') || '').replace(/\/+$/, '');
	const route = ROUTES[`${req.method} ${sub}`];
	if (!route) {
		if (KNOWN_PATHS.has(sub)) return sendError(res, ctx, 405, 'method_not_allowed', `${req.method} is not supported on this path`);
		return sendError(res, ctx, 404, 'not_found', 'unknown Robinhood Crypto route');
	}

	try {
		const principal = await resolvePrincipal(req);
		if (!principal) return sendError(res, ctx, 401, 'unauthorized', 'Sign in or send a three.ws API key.');
		if (principal.source !== 'session') {
			if (route.scope === SESSION_ONLY) {
				return sendError(res, ctx, 403, 'session_required', 'Credentials and spend caps can only be changed from a signed-in browser at three.ws/settings/robinhood.');
			}
			if (!hasScope(principal.scope, route.scope)) {
				return sendError(res, ctx, 403, 'insufficient_scope', `This key needs the ${route.scope} scope.`, { required: route.scope });
			}
		}

		const rl = await limits.apiV1(`robinhood-crypto:${principal.userId}`);
		setRateLimitHeaders(res, rl);
		if (!rl.success) return sendError(res, ctx, 429, 'rate_limited', 'Too many requests. Slow down and retry shortly.');

		let body = {};
		if (req.method !== 'GET') {
			if (principal.source === 'session') {
				const v = await checkCsrf(req, principal.userId);
				if (!v.ok) return sendError(res, ctx, 403, v.code, v.message);
			}
			if (req.method !== 'DELETE') {
				try {
					body = (await readJson(req)) || {};
				} catch (e) {
					return sendError(res, ctx, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid JSON body');
				}
				if (typeof body !== 'object' || Array.isArray(body)) body = {};
			}
		}

		const data = await route.run({ url, body, principal, base: { userId: principal.userId } });
		return send(res, route.status || 200, { data, meta: meta(ctx) });
	} catch (e) {
		if (e instanceof connector.ConnectorError) return sendError(res, ctx, e.status, e.code, e.message, e.details);
		console.error('[robinhood-crypto]', ctx.requestId, e?.message);
		return sendError(res, ctx, 500, 'internal_error', 'Something went wrong on our side. Check your recent orders before retrying an order.');
	}
}

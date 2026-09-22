/**
 * Agent cards REST API: gift cards and prepaid cards bought from an agent's
 * own wallet. Service layer: api/_lib/cards/service.js. Docs: docs/agent-cards.md.
 *
 * vercel.json maps /api/v1/agents/:id/cards[/...] here.
 *
 *   GET  /api/v1/agents/:id/cards                      list (alias: /cards/list)
 *   GET  /api/v1/agents/:id/cards/provider             provider capabilities
 *   GET  /api/v1/agents/:id/cards/merchants/search     ?q&country&kind&sandbox
 *   GET  /api/v1/agents/:id/cards/products/search      ?q&country&category&merchant&kind&sandbox&limit&start
 *   GET  /api/v1/agents/:id/cards/products/:productId
 *   POST /api/v1/agents/:id/cards/quote                { product_id, amount }
 *   POST /api/v1/agents/:id/cards/create               { quote_id, confirm_spend: true }
 *   GET  /api/v1/agents/:id/cards/connect
 *   GET  /api/v1/agents/:id/cards/connect-link
 *   GET  /api/v1/agents/:id/cards/:cardId              card + audit events
 *   GET  /api/v1/agents/:id/cards/:cardId/status       sync from the provider
 *   POST /api/v1/agents/:id/cards/:cardId/refresh      same, as a write
 *   GET  /api/v1/agents/:id/cards/:cardId/balance
 *   POST /api/v1/agents/:id/cards/:cardId/data         masked data + single-use preview_id
 *   POST /api/v1/agents/:id/cards/:cardId/reveal       { preview_id, confirm_reveal: true }
 *   POST /api/v1/agents/:id/cards/:cardId/cancel       { confirm_cancel: true }
 *   POST /api/v1/agents/:id/cards/:cardId/withdraw     { amount, confirm_withdraw: true }
 *   GET  /api/v1/agents/:id/cards/:cardId/withdrawals
 *
 * Envelope (the v1 contract): success { data, meta: { requestId, timestamp } },
 * failure { error: { code, message, details }, meta }.
 *
 * Auth: a signed-in session (writes need X-CSRF-Token), or a three.ws API key
 * / OAuth token. Bearer callers need `wallet:read` for reads and `wallet:write`
 * for anything that quotes, buys, reveals, cancels or withdraws.
 */

import { randomUUID } from 'node:crypto';
import { cors, readJson, setRateLimitHeaders } from '../_lib/http.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../_lib/auth.js';
import { checkCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import * as cards from '../_lib/cards/service.js';

const READ_SCOPE = 'wallet:read';
const WRITE_SCOPE = 'wallet:write';

function send(res, status, body) {
	if (res.headersSent || res.writableEnded) return;
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(JSON.stringify(body));
}

const meta = (ctx) => ({ requestId: ctx.requestId, timestamp: new Date().toISOString() });

function sendError(res, ctx, status, code, message, details = null) {
	res.setHeader('x-request-id', ctx.requestId);
	send(res, status, { error: { code, message, details }, meta: meta(ctx) });
}

async function resolvePrincipal(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session', scope: null, ip: clientIp(req) };
	const bearer = await authenticateBearer(extractBearer(req));
	if (!bearer) return null;
	return { userId: bearer.userId, source: bearer.source, scope: bearer.scope || '', ip: clientIp(req) };
}

/** Split the request into the agent id and the path segments after /cards. */
function parseTarget(req) {
	const url = new URL(req.url, 'http://x');
	const m = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/cards(?:\/(.*))?$/);
	const agentId = m ? decodeURIComponent(m[1]) : url.searchParams.get('id');
	const rest = m ? (m[2] || '') : (url.searchParams.get('path') || '');
	const segments = rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
	return { url, agentId, segments };
}

const bool = (v) => v === true || v === 'true' || v === '1';

/** Route table: [method, pattern, scope, handler(ctx)]. `:card` is a card id. */
const ROUTES = [
	['GET', '', READ_SCOPE, (c) => cards.listCards({ ...c.base, status: c.q('status'), limit: c.q('limit'), cursor: c.q('cursor') })],
	['GET', 'list', READ_SCOPE, (c) => cards.listCards({ ...c.base, status: c.q('status'), limit: c.q('limit'), cursor: c.q('cursor') })],
	['GET', 'provider', READ_SCOPE, async (c) => {
		await cards.loadOwnedAgent(c.agentId, c.principal);
		return cards.providerInfo(c.q('provider'));
	}],
	['GET', 'merchants/search', READ_SCOPE, async (c) => {
		await cards.loadOwnedAgent(c.agentId, c.principal);
		return cards.searchMerchants({ q: c.q('q'), country: c.q('country'), kind: c.q('kind'), sandbox: bool(c.q('sandbox')), limit: c.q('limit') });
	}],
	['GET', 'products/search', READ_SCOPE, async (c) => {
		await cards.loadOwnedAgent(c.agentId, c.principal);
		return cards.searchProducts({
			q: c.q('q'), country: c.q('country'), category: c.q('category'), merchant: c.q('merchant'),
			kind: c.q('kind'), sandbox: bool(c.q('sandbox')), limit: c.q('limit'), start: c.q('start'),
		});
	}],
	['GET', 'products/:product', READ_SCOPE, async (c) => {
		await cards.loadOwnedAgent(c.agentId, c.principal);
		return cards.getProduct({ productId: c.params.product });
	}],
	['POST', 'quote', WRITE_SCOPE, (c) => cards.quoteCard({ ...c.base, productId: c.body.product_id, amount: c.body.amount })],
	['POST', 'create', WRITE_SCOPE, (c) => cards.createCard({ ...c.base, quoteId: c.body.quote_id, confirmSpend: c.body.confirm_spend })],
	['GET', 'connect', READ_SCOPE, (c) => cards.connectStatus({ ...c.base, provider: c.q('provider') })],
	['GET', 'connect-link', WRITE_SCOPE, (c) => cards.connectLink({ ...c.base, provider: c.q('provider') })],
	['GET', ':card', READ_SCOPE, (c) => cards.getCard({ ...c.base, cardId: c.params.card })],
	['GET', ':card/status', READ_SCOPE, (c) => cards.refreshCard({ ...c.base, cardId: c.params.card })],
	['POST', ':card/refresh', READ_SCOPE, (c) => cards.refreshCard({ ...c.base, cardId: c.params.card })],
	['GET', ':card/balance', READ_SCOPE, (c) => cards.cardBalance({ ...c.base, cardId: c.params.card })],
	['POST', ':card/data', WRITE_SCOPE, (c) => cards.cardData({ ...c.base, cardId: c.params.card })],
	['POST', ':card/reveal', WRITE_SCOPE, (c) => cards.revealCard({
		...c.base, cardId: c.params.card, previewId: c.body.preview_id, confirmReveal: c.body.confirm_reveal,
	})],
	['POST', ':card/cancel', WRITE_SCOPE, (c) => cards.cancelCard({ ...c.base, cardId: c.params.card, confirmCancel: c.body.confirm_cancel })],
	['POST', ':card/withdraw', WRITE_SCOPE, (c) => cards.withdrawCard({
		...c.base, cardId: c.params.card, amount: c.body.amount, confirmWithdraw: c.body.confirm_withdraw,
	})],
	['GET', ':card/withdrawals', READ_SCOPE, (c) => cards.listWithdrawals({ ...c.base, cardId: c.params.card })],
].map(([m, pattern, scope, handler]) => ({ method: m, parts: pattern.split('/').filter(Boolean), scope, handler }));

// Literal segments win over `:card`, so /cards/list never reads as a card id.
function match(method, segments) {
	let literalPathSeen = false;
	let anyPathSeen = false;
	let paramHit = null;
	for (const r of ROUTES) {
		if (r.parts.length !== segments.length) continue;
		const params = {};
		let ok = true;
		let literal = true;
		for (let i = 0; i < r.parts.length; i++) {
			const p = r.parts[i];
			if (p.startsWith(':')) {
				params[p.slice(1)] = segments[i];
				if (i === 0) literal = false;
			} else if (p !== segments[i]) {
				ok = false;
				break;
			}
		}
		if (!ok) continue;
		anyPathSeen = true;
		if (literal) literalPathSeen = true;
		if (r.method !== method) continue;
		if (literal) return { route: r, params };
		paramHit = paramHit || { route: r, params };
	}
	if (literalPathSeen || (!paramHit && anyPathSeen)) return { methodMismatch: true };
	return paramHit;
}

export default async function handler(req, res) {
	const ctx = { requestId: randomUUID() };
	res.setHeader('x-request-id', ctx.requestId);
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;

	const { url, agentId, segments } = parseTarget(req);
	const hit = match(req.method, segments);
	if (!hit?.route) {
		if (hit?.methodMismatch) return sendError(res, ctx, 405, 'method_not_allowed', `${req.method} is not supported on this path`);
		return sendError(res, ctx, 404, 'not_found', 'unknown agent cards route');
	}

	try {
		const principal = await resolvePrincipal(req);
		if (!principal) return sendError(res, ctx, 401, 'unauthorized', 'Sign in or send a three.ws API key.');
		if (principal.source !== 'session' && !hasScope(principal.scope, hit.route.scope)) {
			return sendError(res, ctx, 403, 'insufficient_scope', `This key needs the ${hit.route.scope} scope.`, { required: hit.route.scope });
		}

		const rl = await limits.apiV1(`cards:${principal.userId}`);
		setRateLimitHeaders(res, rl);
		if (!rl.success) return sendError(res, ctx, 429, 'rate_limited', 'Too many requests. Slow down and retry shortly.');

		let body = {};
		if (req.method === 'POST') {
			if (principal.source === 'session') {
				const v = await checkCsrf(req, principal.userId);
				if (!v.ok) return sendError(res, ctx, 403, v.code, v.message);
			}
			try {
				body = (await readJson(req)) || {};
			} catch (e) {
				return sendError(res, ctx, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid JSON body');
			}
			if (typeof body !== 'object' || Array.isArray(body)) body = {};
		}

		const c = {
			agentId,
			principal,
			params: hit.params,
			body,
			q: (k) => url.searchParams.get(k),
			base: { agentId, principal },
		};
		const data = await hit.route.handler(c);
		const status = hit.route.parts[0] === 'quote' ? 201 : 200;
		return send(res, status, { data, meta: meta(ctx) });
	} catch (e) {
		if (e instanceof cards.CardError) return sendError(res, ctx, e.status, e.code, e.message, e.details);
		console.error('[agent-cards]', ctx.requestId, e?.message);
		return sendError(res, ctx, 500, 'internal_error', 'Something went wrong on our side. No funds moved unless the card shows a payment signature.');
	}
}

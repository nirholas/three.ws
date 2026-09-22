// Whole-agent marketplace REST API: /api/v1/marketplace/agents/*
//
//   GET    /api/v1/marketplace/agents                         browse live listings (index.js)
//   GET    /api/v1/marketplace/agents/public                  published agents, with sale state
//   GET    /api/v1/marketplace/agents/history?agent_id=       marketplace event history
//   GET    /api/v1/marketplace/agents/by-agent/:agentId       an agent's live listing (or null)
//   GET    /api/v1/marketplace/agents/dashboard               seller dashboard (auth)
//   GET    /api/v1/marketplace/agents/bids/mine               bids I placed (auth)
//   GET    /api/v1/marketplace/agents/bids/received           bids on my listings (auth)
//   POST   /api/v1/marketplace/agents/preview                 confirmation table for any money action (auth)
//   POST   /api/v1/marketplace/agents/listings                create a listing (auth, confirm)
//   GET    /api/v1/marketplace/agents/listings/:id            listing detail, bids, history, transfer
//   POST   /api/v1/marketplace/agents/listings/:id/delist     delist and refund open bids (auth, confirm)
//   POST   /api/v1/marketplace/agents/listings/:id/bids       place a bid (auth, confirm)
//   POST   /api/v1/marketplace/agents/listings/:id/buy        buy now (auth, confirm)
//   POST   /api/v1/marketplace/agents/bids/:id/confirm        record a wallet-signed escrow transfer (auth)
//   POST   /api/v1/marketplace/agents/bids/:id/transaction    rebuild the escrow transaction (auth)
//   POST   /api/v1/marketplace/agents/bids/:id/accept         accept a bid (auth, confirm)
//   POST   /api/v1/marketplace/agents/bids/:id/reject         reject a bid (auth)
//   POST   /api/v1/marketplace/agents/bids/:id/withdraw       withdraw a bid (auth, confirm)
//   GET    /api/v1/marketplace/agents/transfers/:id           settlement progress (auth, buyer or seller)
//   POST   /api/v1/marketplace/agents/transfers/:id/resume    resume a failed settlement (auth)
//
// Auth: a browser session (state-changing calls need the X-CSRF-Token header),
// a three.ws API key, or an OAuth token. Keys and tokens need agents:read for
// the private reads, agents:write for listing and accepting, and wallet:write
// for anything that moves the caller's own funds. Envelope: { data } on success,
// { error, error_description } on failure, like every /api/v1 route.

import { cors, error, json, readJson, wrap, rateLimited, setRateLimitHeaders } from '../../../_lib/http.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../../../_lib/auth.js';
import { requireCsrf } from '../../../_lib/csrf.js';
import { limits, clientIp } from '../../../_lib/rate-limit.js';
import * as svc from '../../../_lib/agent-market/service.js';

async function principal(req) {
	const session = await getSessionUser(req);
	if (session) return { id: session.id, source: 'session', scope: 'all' };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { id: bearer.userId, source: bearer.source, scope: bearer.scope || '' };
	return null;
}

function denied(res, status, code, message) {
	error(res, status, code, message);
	return null;
}

// Resolve and authorize the caller for a route. Returns the user or null after
// answering the request.
async function authorize(req, res, { scope, write }) {
	const user = await principal(req);
	if (!user) return denied(res, 401, 'unauthorized', 'sign in, or send a three.ws API key as `Authorization: Bearer sk_live_…`');
	if (user.source !== 'session' && scope && !hasScope(user.scope, scope)) {
		return denied(res, 403, 'insufficient_scope', `this endpoint requires the "${scope}" scope`);
	}
	if (write && user.source === 'session' && !(await requireCsrf(req, res, user.id))) return null;
	return user;
}

function parts(req) {
	const { pathname } = new URL(req.url, 'http://internal');
	return pathname.replace(/^\/api\/v1\/marketplace\/agents\/?/, '').split('/').filter(Boolean);
}

function query(req) {
	return Object.fromEntries(new URL(req.url, 'http://internal').searchParams);
}

// Route table: [method, pattern, auth, handler]. `:x` segments bind params.
const ROUTES = [
	['GET', 'public', null, (ctx) => svc.browsePublicAgents(ctx.query)],
	['GET', 'history', null, (ctx) => svc.marketplaceHistory({ agentId: ctx.query.agent_id || null, limit: ctx.query.limit })],
	['GET', 'by-agent/:agentId', { optional: true }, (ctx) => svc.getLiveListingForAgent(ctx.params.agentId, ctx.user?.id)],
	['GET', 'dashboard', { scope: 'agents:read' }, (ctx) => svc.sellerDashboard(ctx.user)],
	['GET', 'bids/mine', { scope: 'agents:read' }, (ctx) => svc.myBids(ctx.user)],
	['GET', 'bids/received', { scope: 'agents:read' }, (ctx) => svc.receivedBids(ctx.user)],
	['POST', 'preview', { scope: 'agents:read', write: true }, (ctx) => {
		const { action, ...params } = ctx.body || {};
		return svc.previewAction(ctx.user, action, params);
	}],
	['POST', 'listings', { scope: 'agents:write', write: true }, (ctx) => svc.createListing(ctx.user, ctx.body, { confirm: ctx.body.confirm === true })],
	['GET', 'listings/:id', { optional: true }, (ctx) => svc.getListingDetail(ctx.params.id, ctx.user?.id)],
	['POST', 'listings/:id/delist', { scope: 'agents:write', write: true }, (ctx) => svc.delistListing(ctx.user, ctx.params.id, { confirm: ctx.body.confirm === true })],
	['POST', 'listings/:id/bids', { scope: 'wallet:write', write: true }, (ctx) =>
		svc.placeBid(ctx.user, { ...ctx.body, listing_id: ctx.params.id }, { confirm: ctx.body.confirm === true, kind: 'bid' })],
	['POST', 'listings/:id/buy', { scope: 'wallet:write', write: true }, (ctx) =>
		svc.placeBid(ctx.user, { ...ctx.body, listing_id: ctx.params.id }, { confirm: ctx.body.confirm === true, kind: 'buy_now' })],
	['POST', 'bids/:id/confirm', { scope: 'wallet:write', write: true }, (ctx) => svc.confirmBidFunding(ctx.user, ctx.params.id, { signature: ctx.body.signature || null })],
	['POST', 'bids/:id/transaction', { scope: 'wallet:write', write: true }, (ctx) => svc.rebuildFundingTransaction(ctx.user, ctx.params.id)],
	['POST', 'bids/:id/accept', { scope: 'agents:write', write: true }, (ctx) => svc.acceptBid(ctx.user, ctx.params.id, { confirm: ctx.body.confirm === true })],
	['POST', 'bids/:id/reject', { scope: 'agents:write', write: true }, (ctx) => svc.rejectBid(ctx.user, ctx.params.id)],
	['POST', 'bids/:id/withdraw', { scope: 'wallet:write', write: true }, (ctx) => svc.withdrawBid(ctx.user, ctx.params.id, { confirm: ctx.body.confirm === true })],
	['GET', 'transfers/:id', { scope: 'agents:read' }, (ctx) => svc.getTransferForViewer(ctx.params.id, ctx.user)],
	['POST', 'transfers/:id/resume', { scope: 'agents:write', write: true }, (ctx) => svc.resumeTransfer(ctx.user, ctx.params.id)],
];

function match(segs) {
	for (const [m, pattern, auth, handler] of ROUTES) {
		const p = pattern.split('/');
		if (p.length !== segs.length) continue;
		const params = {};
		let ok = true;
		for (let i = 0; i < p.length; i++) {
			if (p[i].startsWith(':')) params[p[i].slice(1)] = segs[i];
			else if (p[i] !== segs[i]) { ok = false; break; }
		}
		if (ok) return { method: m, auth, handler, params };
	}
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	const segs = parts(req);
	const route = match(segs);
	if (!route) return error(res, 404, 'not_found', 'no such marketplace route; see GET /api/v1');
	if (route.method !== req.method) {
		res.setHeader('allow', `${route.method}, OPTIONS`);
		return error(res, 405, 'method_not_allowed', `use ${route.method}`);
	}

	const rl = await limits.apiV1(`ip:${clientIp(req)}`);
	setRateLimitHeaders(res, rl);
	if (!rl.success) return rateLimited(res, rl);

	let user = null;
	if (route.auth?.optional) {
		user = await principal(req);
	} else if (route.auth) {
		user = await authorize(req, res, route.auth);
		if (!user) return;
	}

	const body = req.method === 'POST' ? (await readJson(req).catch(() => ({}))) || {} : {};
	try {
		const data = await route.handler({ req, user, params: route.params, query: query(req), body });
		res.setHeader('cache-control', req.method === 'GET' && !user ? 'public, max-age=15' : 'no-store');
		return json(res, 200, { data: data ?? null });
	} catch (err) {
		if (err?.expose && err.code && err.status && err.status < 500) {
			const extra = {};
			if (err.requirement) extra.requirement = err.requirement;
			if (err.bid_id) extra.bid_id = err.bid_id;
			if (err.signature) extra.signature = err.signature;
			return error(res, err.status, err.code, err.message, extra);
		}
		throw err;
	}
});

// Route table for /api/agent-commerce/*, in the v1 API contract
// (api/_lib/agents-v1/http.js: one envelope, per-route auth and scopes, CSRF on
// cookie writes, Idempotency-Key replay). Mounted by
// api/agent-commerce/[...route].js. Guide: docs/agent-commerce.md.
//
// Public (anyone holding the link, rate-limited per IP):
//   GET  /invoices/:id/public         the payer's view: amount, pay link, timeline
//   POST /invoices/:id/verify         read the chain now and settle what it shows
//   GET  /pay/:id                     302 to the invoice's solana: transfer link
//   GET  /pay/:id/qr.svg              that link as a QR code
//   GET  /offers                      active offers any agent can buy
//
// Owner (session, API key or OAuth token):
//   GET/POST /invoices, GET /invoices/:id, POST /invoices/:id/cancel
//   GET/POST /offers/mine, POST /offers/:id/status, GET /purchases
//   GET /requests                      limit proposals from the owner's agents
//
// Owner, browser session only (an agent's bearer token can never reach these):
//   POST /requests/:id/challenge       step-up options + wallet message to sign
//   POST /requests/:id                 approve (with step-up) or deny

import { apiError, created, intParam, strParam } from '../agents-v1/http.js';
import { limits } from '../rate-limit.js';
import { CommerceError } from './assets.js';
import {
	createInvoice, getInvoiceForOwner, getInvoicePublic, listInvoices, cancelInvoice, verifyInvoice,
	loadInvoiceRow, isUuid,
} from './invoices.js';
import { solanaPayUrl, qrSvg } from './solana-pay.js';
import { createOffer, listPublicOffers, listOwnerOffers, setOfferStatus, listOwnerPurchases } from './offers.js';
import { listLimitRequests, getLimitRequest, decideLimitRequest } from './limit-requests.js';
import { stepUpChallenge } from './step-up.js';

/** Re-throw commerce errors as v1 ApiErrors so the envelope carries their code. */
async function run(fn) {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof CommerceError) throw apiError(err.status, err.code, err.message, err.extra || null);
		throw err;
	}
}

async function limit(result) {
	const rl = await result;
	if (!rl.success) throw apiError(429, 'rate_limited', 'Too many requests. Slow down and retry.');
}

function sessionOnly(principal) {
	if (principal?.source !== 'session') {
		throw apiError(403, 'session_required', 'Only the owner, signed in on three.ws, can answer this. API keys and agent tokens cannot.');
	}
}

function uuidParam(v, what) {
	if (!isUuid(v)) throw apiError(404, 'not_found', `No ${what} with that id.`);
	return v;
}

// ── public ───────────────────────────────────────────────────────────────────

async function publicInvoiceRoute({ params, ip }) {
	await limit(limits.commercePublic(ip));
	return run(() => getInvoicePublic(uuidParam(params.id, 'invoice')));
}

async function verifyRoute({ params, ip }) {
	await limit(limits.commerceVerify(ip));
	return run(() => verifyInvoice(uuidParam(params.id, 'invoice')));
}

async function loadPayable(id) {
	const row = await loadInvoiceRow(uuidParam(id, 'invoice'));
	if (!row) throw apiError(404, 'not_found', 'No invoice with that id.');
	if (row.status === 'paid' || row.status === 'cancelled') {
		throw apiError(410, 'not_payable', `This invoice is ${row.status}; there is nothing to pay.`);
	}
	return row;
}

async function payRedirectRoute({ params, ip, res }) {
	await limit(limits.commercePublic(ip));
	const row = await loadPayable(params.id);
	res.statusCode = 302;
	res.setHeader('location', solanaPayUrl(row));
	res.setHeader('cache-control', 'no-store');
	res.end();
}

async function payQrRoute({ params, ip, res }) {
	await limit(limits.commercePublic(ip));
	const row = await loadPayable(params.id);
	const svg = await qrSvg(solanaPayUrl(row));
	res.statusCode = 200;
	res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
	// The amount still due shrinks as partial payments land, so never cache.
	res.setHeader('cache-control', 'no-store');
	res.setHeader('x-content-type-options', 'nosniff');
	res.end(svg);
}

async function publicOffersRoute({ query, ip }) {
	await limit(limits.commercePublic(ip));
	const agentId = query.agent_id ? uuidParam(query.agent_id, 'agent') : null;
	const offers = await run(() => listPublicOffers({
		agentId,
		asset: strParam(query.asset, { name: 'asset', max: 8 }),
		network: strParam(query.network, { name: 'network', max: 16 }),
		limit: intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 25 }),
	}));
	return { offers };
}

// ── owner ────────────────────────────────────────────────────────────────────

async function listInvoicesRoute({ principal, query }) {
	await limit(limits.commerceOwner(principal.userId));
	return run(() => listInvoices({
		userId: principal.userId,
		agentId: strParam(query.agent_id, { name: 'agent_id', max: 64 }),
		status: strParam(query.status, { name: 'status', max: 16 }),
		limit: intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 25 }),
		before: strParam(query.before, { name: 'before', max: 40 }),
	}));
}

async function createInvoiceRoute({ principal, body }) {
	await limit(limits.commerceOwner(principal.userId));
	const invoice = await run(() => createInvoice({
		userId: principal.userId,
		agentId: strParam(body.agent_id, { name: 'agent_id', max: 64, required: true }),
		createdBy: 'owner',
		amount: body.amount,
		asset: body.asset,
		network: body.network,
		memo: body.memo,
		description: body.description,
		payer: body.payer,
		payerLabel: body.payer_label,
		dueAt: body.due_at,
		dueInHours: body.due_in_hours,
	}));
	return created({ invoice });
}

async function getInvoiceRoute({ principal, params }) {
	await limit(limits.commerceOwner(principal.userId));
	return run(() => getInvoiceForOwner(principal.userId, uuidParam(params.id, 'invoice')));
}

async function cancelInvoiceRoute({ principal, params, body }) {
	await limit(limits.commerceOwner(principal.userId));
	return run(() => cancelInvoice({ userId: principal.userId, id: uuidParam(params.id, 'invoice'), reason: body.reason }));
}

async function myOffersRoute({ principal, query }) {
	await limit(limits.commerceOwner(principal.userId));
	const offers = await run(() => listOwnerOffers({
		userId: principal.userId,
		agentId: query.agent_id ? uuidParam(query.agent_id, 'agent') : null,
		limit: intParam(query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 }),
	}));
	return { offers };
}

async function createOfferRoute({ principal, body }) {
	await limit(limits.commerceOwner(principal.userId));
	const offer = await run(() => createOffer({
		agentId: uuidParam(body.agent_id, 'agent'),
		userId: principal.userId,
		title: body.title,
		description: body.description,
		price: body.price,
		asset: body.asset,
		network: body.network,
		fulfillment: body.fulfillment,
		stock: body.stock ?? null,
	}));
	return created({ offer });
}

async function offerStatusRoute({ principal, params, body }) {
	await limit(limits.commerceOwner(principal.userId));
	const offer = await run(() => setOfferStatus({ userId: principal.userId, offerId: uuidParam(params.id, 'offer'), status: body.status }));
	return { offer };
}

async function purchasesRoute({ principal, query }) {
	await limit(limits.commerceOwner(principal.userId));
	const purchases = await run(() => listOwnerPurchases({
		userId: principal.userId,
		limit: intParam(query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 }),
	}));
	return { purchases };
}

async function listRequestsRoute({ principal, query }) {
	await limit(limits.commerceOwner(principal.userId));
	const status = strParam(query.status, { name: 'status', max: 16 });
	const requests = await run(() => listLimitRequests({
		userId: principal.userId,
		status,
		limit: intParam(query.limit, { name: 'limit', min: 1, max: 200, fallback: 50 }),
	}));
	return { requests };
}

async function challengeRoute({ principal, params }) {
	sessionOnly(principal);
	await limit(limits.commerceDecide(principal.userId));
	const row = await run(() => getLimitRequest({ userId: principal.userId, id: params.id }));
	if (row.status !== 'pending') throw apiError(409, 'not_pending', `This request is already ${row.status}.`);
	return run(() => stepUpChallenge({ userId: principal.userId, requestId: row.id, payloadHash: row.payload_hash }));
}

async function decideRoute({ principal, params, body, req }) {
	sessionOnly(principal);
	await limit(limits.commerceDecide(principal.userId));
	const request = await run(() => decideLimitRequest({
		req,
		userId: principal.userId,
		id: params.id,
		decision: body.decision,
		shownHash: body.payload_hash ?? null,
		stepUp: body.step_up ?? null,
	}));
	return { request };
}

export const commerceRoutes = [
	{ method: 'GET', path: '/invoices/:id/public', name: 'commerce.invoice.public', auth: 'public', handler: publicInvoiceRoute },
	{ method: 'POST', path: '/invoices/:id/verify', name: 'commerce.invoice.verify', auth: 'public', csrf: false, handler: verifyRoute },
	{ method: 'GET', path: '/pay/:id', name: 'commerce.pay', auth: 'public', handler: payRedirectRoute },
	{ method: 'GET', path: '/pay/:id/qr.svg', name: 'commerce.pay.qr', auth: 'public', handler: payQrRoute },
	{ method: 'GET', path: '/offers', name: 'commerce.offers.public', auth: 'public', handler: publicOffersRoute },

	{ method: 'GET', path: '/invoices', name: 'commerce.invoices.list', auth: 'required', scope: 'wallet:read', handler: listInvoicesRoute },
	{ method: 'POST', path: '/invoices', name: 'commerce.invoices.create', auth: 'required', scope: 'agents:write', handler: createInvoiceRoute },
	{ method: 'GET', path: '/invoices/:id', name: 'commerce.invoice.get', auth: 'required', scope: 'wallet:read', handler: getInvoiceRoute },
	{ method: 'POST', path: '/invoices/:id/cancel', name: 'commerce.invoice.cancel', auth: 'required', scope: 'agents:write', handler: cancelInvoiceRoute },
	{ method: 'GET', path: '/offers/mine', name: 'commerce.offers.mine', auth: 'required', scope: 'wallet:read', handler: myOffersRoute },
	{ method: 'POST', path: '/offers/mine', name: 'commerce.offers.create', auth: 'required', scope: 'agents:write', handler: createOfferRoute },
	{ method: 'POST', path: '/offers/:id/status', name: 'commerce.offer.status', auth: 'required', scope: 'agents:write', handler: offerStatusRoute },
	{ method: 'GET', path: '/purchases', name: 'commerce.purchases', auth: 'required', scope: 'wallet:read', handler: purchasesRoute },
	{ method: 'GET', path: '/requests', name: 'commerce.requests.list', auth: 'required', scope: 'wallet:read', handler: listRequestsRoute },
	{ method: 'POST', path: '/requests/:id/challenge', name: 'commerce.request.challenge', auth: 'required', handler: challengeRoute },
	{ method: 'POST', path: '/requests/:id', name: 'commerce.request.decide', auth: 'required', handler: decideRoute },
];

// Human-task marketplace REST API: /api/human-tasks/*
//
//   GET  /api/human-tasks                       browse open tasks (public; q, category, location, lat, lng, radius_km)
//   GET  /api/human-tasks/mine                  tasks my agents posted (auth)
//   GET  /api/human-tasks/work                  tasks I accepted (auth)
//   GET  /api/human-tasks/agents                my agents that can fund a task, with USDC balance (auth)
//   GET  /api/human-tasks/standing              my worker verification level (auth)
//   GET  /api/human-tasks/disputes              open dispute queue (admin)
//   POST /api/human-tasks/quote                 price a task, returns the confirmation table and a quote_id (auth)
//   POST /api/human-tasks                       post a quoted task and lock escrow (auth, confirm)
//   GET  /api/human-tasks/:id                   detail with timeline
//   POST /api/human-tasks/:id/claim             accept an open task (auth)
//   POST /api/human-tasks/:id/unclaim           hand an accepted task back (auth)
//   POST /api/human-tasks/:id/upload            signed URL for one proof photo (auth)
//   POST /api/human-tasks/:id/submit            submit proof (auth)
//   POST /api/human-tasks/:id/preview-approve   payout confirmation table (auth, poster)
//   POST /api/human-tasks/:id/approve           approve and pay the worker (auth, poster, confirm)
//   POST /api/human-tasks/:id/cancel            cancel an open task and refund (auth, poster, confirm)
//   POST /api/human-tasks/:id/dispute           dispute submitted proof (auth, poster)
//   POST /api/human-tasks/:id/respond           worker answers a dispute (auth)
//   POST /api/human-tasks/:id/review            rate the other side (auth)
//   POST /api/human-tasks/disputes/:id/resolve  decide a dispute (admin; call once to preview, again with confirm)
//   POST /api/human-tasks/external/callback     signed status callback from an external network
//
// Auth: a browser session (state-changing calls need X-CSRF-Token), a three.ws
// API key, or an OAuth token. Keys need agents:read for private reads,
// agents:write for posting, and wallet:write for anything that moves funds.
// Envelope: { data } on success, { error, error_description } on failure.

import { cors, error, json, readJson, wrap, rateLimited, setRateLimitHeaders } from '../_lib/http.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { assertBearerMaySpend } from '../_lib/spend-scope.js';
import { isAdminUser } from '../_lib/admin.js';
import { webhookAdapter } from '../_lib/human-tasks/external.js';
import * as svc from '../_lib/human-tasks/service.js';
import * as S from '../_lib/human-tasks/schemas.js';

async function principal(req) {
	const session = await getSessionUser(req);
	if (session) return { id: session.id, source: 'session', scope: 'all', record: session };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { id: bearer.userId, source: bearer.source, scope: bearer.scope || '' };
	return null;
}

async function authorize(req, res, { scope, write, spend, admin }) {
	const user = await principal(req);
	if (!user) {
		error(res, 401, 'unauthorized', 'sign in, or send a three.ws API key as `Authorization: Bearer sk_live_...`');
		return null;
	}
	if (user.source !== 'session' && scope && !hasScope(user.scope, scope)) {
		error(res, 403, 'insufficient_scope', `this endpoint requires the "${scope}" scope`);
		return null;
	}
	if (spend && user.source !== 'session') assertBearerMaySpend({ scope: user.scope }, req);
	if (write && user.source === 'session' && !(await requireCsrf(req, res, user.id))) return null;
	if (admin && !(user.source === 'session' && (await isAdminUser(user.record)))) {
		error(res, 403, 'forbidden', 'admin access required');
		return null;
	}
	return user;
}

function parts(req) {
	const { pathname } = new URL(req.url, 'http://internal');
	return pathname.replace(/^\/api\/human-tasks\/?/, '').split('/').filter(Boolean);
}

const query = (req) => Object.fromEntries(new URL(req.url, 'http://internal').searchParams);
const own = { scope: 'agents:read' };
const act = { scope: 'wallet:write', write: true, spend: true };

// [method, pattern, auth, handler]. `:x` segments bind params. Static patterns
// are listed before `:id` ones so they win.
const ROUTES = [
	['GET', '', { optional: true }, (c) => svc.browseTasks(c.query)],
	['GET', 'mine', own, (c) => svc.myPostedTasks(c.user, c.query)],
	['GET', 'work', own, (c) => svc.myWork(c.user)],
	['GET', 'agents', own, (c) => svc.myAgents(c.user)],
	['GET', 'standing', own, (c) => svc.myStanding(c.user)],
	['GET', 'disputes', { scope: 'agents:read', admin: true }, (c) => svc.disputeQueue(c.user)],
	['POST', 'quote', { scope: 'agents:write', write: true }, (c) => svc.quoteTask(c.user, S.parseBody(S.taskParams, c.body))],
	['POST', '', act, (c) => svc.postTask(c.user, S.parseBody(S.postBody, c.body))],
	['POST', 'disputes/:id/resolve', { scope: 'agents:write', write: true, admin: true }, (c) => svc.resolveDispute(c.user, c.params.id, S.parseBody(S.resolveBody, c.body))],
	['GET', ':id', { optional: true }, (c) => svc.getTaskDetail(c.params.id, c.user?.id || null)],
	['POST', ':id/claim', { scope: 'agents:write', write: true }, (c) => svc.claimTask(c.user, c.params.id, S.parseBody(S.claimBody, c.body))],
	['POST', ':id/unclaim', { scope: 'agents:write', write: true }, (c) => svc.unclaimTask(c.user, c.params.id)],
	['POST', ':id/upload', { scope: 'agents:write', write: true }, (c) => svc.requestUpload(c.user, c.params.id, S.parseBody(S.uploadBody, c.body))],
	['POST', ':id/submit', { scope: 'agents:write', write: true }, (c) => svc.submitProof(c.user, c.params.id, S.parseBody(S.submitBody, c.body))],
	['POST', ':id/preview-approve', { scope: 'agents:write', write: true }, (c) => svc.previewApprove(c.user, c.params.id)],
	['POST', ':id/approve', act, (c) => svc.approveTask(c.user, c.params.id, S.parseBody(S.approveBody, c.body))],
	['POST', ':id/cancel', act, (c) => svc.cancelTask(c.user, c.params.id, S.parseBody(S.cancelBody, c.body))],
	['POST', ':id/dispute', { scope: 'agents:write', write: true }, (c) => svc.disputeTask(c.user, c.params.id, S.parseBody(S.disputeBody, c.body))],
	['POST', ':id/respond', { scope: 'agents:write', write: true }, (c) => svc.respondToDispute(c.user, c.params.id, S.parseBody(S.respondBody, c.body))],
	['POST', ':id/review', { scope: 'agents:write', write: true }, (c) => svc.reviewTask(c.user, c.params.id, S.parseBody(S.reviewBody, c.body))],
];

function match(segs, httpMethod) {
	let methodMismatch = null;
	for (const [m, pattern, auth, handler] of ROUTES) {
		const p = pattern ? pattern.split('/') : [];
		if (p.length !== segs.length) continue;
		const params = {};
		let ok = true;
		for (let i = 0; i < p.length; i++) {
			if (p[i].startsWith(':')) params[p[i].slice(1)] = segs[i];
			else if (p[i] !== segs[i]) { ok = false; break; }
		}
		if (!ok) continue;
		if (m === httpMethod) return { method: m, auth, handler, params };
		methodMismatch = m;
	}
	return methodMismatch ? { mismatch: methodMismatch } : null;
}

async function externalCallback(req, res) {
	if (req.method !== 'POST') {
		res.setHeader('allow', 'POST, OPTIONS');
		return error(res, 405, 'method_not_allowed', 'use POST');
	}
	if (!webhookAdapter.configured()) return error(res, 404, 'not_found', 'external fulfillment is not enabled');
	const raw = await readRaw(req);
	try {
		const event = webhookAdapter.verifyCallback(req, raw);
		const data = await svc.handleExternalCallback(event);
		return json(res, 200, { data });
	} catch (err) {
		if (err?.expose && err.status && err.status < 500) return error(res, err.status, err.code, err.message);
		throw err;
	}
}

async function readRaw(req) {
	const chunks = [];
	let size = 0;
	for await (const c of req) {
		size += c.length;
		if (size > 256 * 1024) throw Object.assign(new Error('callback body too large'), { status: 413, code: 'too_large', expose: true });
		chunks.push(c);
	}
	return Buffer.concat(chunks).toString('utf8');
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	const segs = parts(req);
	if (segs[0] === 'external' && segs[1] === 'callback') return externalCallback(req, res);

	const route = match(segs, req.method);
	if (!route) return error(res, 404, 'not_found', 'no such human-tasks route');
	if (route.mismatch) {
		res.setHeader('allow', `${route.mismatch}, OPTIONS`);
		return error(res, 405, 'method_not_allowed', `use ${route.mismatch}`);
	}

	const rl = await limits.apiV1(`ip:${clientIp(req)}`);
	setRateLimitHeaders(res, rl);
	if (!rl.success) return rateLimited(res, rl);

	let user = null;
	if (route.auth?.optional) user = await principal(req);
	else if (route.auth) {
		user = await authorize(req, res, route.auth);
		if (!user) return;
	}

	const body = req.method === 'POST' ? (await readJson(req).catch(() => ({}))) || {} : {};
	try {
		const data = await route.handler({ req, user, params: route.params, query: query(req), body });
		res.setHeader('cache-control', req.method === 'GET' && !user ? 'public, max-age=10' : 'no-store');
		return json(res, 200, { data: data ?? null });
	} catch (err) {
		if (err?.expose && err.code && err.status && err.status < 500) {
			const extra = {};
			if (err.requirement) extra.requirement = err.requirement;
			if (err.signature) extra.signature = err.signature;
			if (err.next_step) extra.next_step = err.next_step;
			return error(res, err.status, err.code, err.message, extra);
		}
		throw err;
	}
});

/**
 * Agent mail REST API: a real email inbox for every agent. Service layer:
 * api/_lib/mail/service.js (shared with the MCP tools in api/_mcp/tools/mail.js).
 * Docs: docs/agent-mail.md.
 *
 * vercel.json maps /api/v1/agents/:id/mail[/...] here.
 *
 *   GET    /api/v1/agents/:id/mail                          mailbox, limits, pricing (null mailbox before provisioning)
 *   GET    /api/v1/agents/:id/mail/address                  the address only
 *   POST   /api/v1/agents/:id/mail/quote                    { action: 'create', local_part?, display_name?, payment_source? }
 *                                                           { action: 'send', to, cc?, subject?, text, html?, attachments?, in_reply_to?, payment_source? }
 *   POST   /api/v1/agents/:id/mail/create                   { quote_id, confirm_spend: true }
 *   POST   /api/v1/agents/:id/mail/send                     { quote_id, confirm_send: true, ...the exact draft that was quoted }
 *   GET    /api/v1/agents/:id/mail/messages                 ?folder=inbox|sent|spam|all&unread=1&q=&limit=&cursor= (alias: /mail/list)
 *   GET    /api/v1/agents/:id/mail/messages/:msg            one message (marks a received message read; ?mark_read=0 to peek)
 *   POST   /api/v1/agents/:id/mail/messages/:msg/read       { read: true|false }
 *   DELETE /api/v1/agents/:id/mail/messages/:msg
 *   GET    /api/v1/agents/:id/mail/messages/:msg/attachments/:index   short-lived download URL
 *   GET    /api/v1/agents/:id/mail/chat                     email-as-chat status for this mailbox
 *   POST   /api/v1/agents/:id/mail/chat                     { enabled: true|false } pair or unpair the account email
 *
 * Envelope (the v1 contract): success { data, meta: { requestId, timestamp } },
 * failure { error: { code, message, details }, meta }.
 *
 * Auth: a signed-in session (writes need X-CSRF-Token), or a three.ws API key
 * / OAuth token. Bearer callers need `agents:read` for reads, `agents:write`
 * for message state changes, and `wallet:write` for anything that quotes or
 * charges (provisioning and sending are metered).
 */

import { randomUUID } from 'node:crypto';
import { cors, readJson, setRateLimitHeaders } from '../_lib/http.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../_lib/auth.js';
import { checkCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import * as mail from '../_lib/mail/service.js';
import { emailChatStatus, setEmailChat } from '../_lib/gateway/email.js';

const READ_SCOPE = 'agents:read';
const WRITE_SCOPE = 'agents:write';
const MONEY_SCOPE = 'wallet:write';

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
	return { userId: bearer.userId, source: bearer.source, scope: bearer.scope || '', ip: clientIp(req) };
}

/** Split the request into the agent id and the path segments after /mail. */
function parseTarget(req) {
	const url = new URL(req.url, 'http://x');
	const m = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/mail(?:\/(.*))?$/);
	const agentId = m ? decodeURIComponent(m[1]) : url.searchParams.get('id');
	const rest = m ? m[2] || '' : url.searchParams.get('path') || '';
	const segments = rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
	return { url, agentId, segments };
}

const bool = (v) => v === true || v === 'true' || v === '1';

/** The draft fields a send quote and a send carry, taken from a request body. */
export function draftFrom(body) {
	return {
		to: body.to,
		cc: body.cc,
		subject: body.subject,
		text: body.text,
		html: body.html,
		attachments: body.attachments,
		in_reply_to: body.in_reply_to,
	};
}

function quote(c) {
	const action = c.body.action;
	if (action === 'create') {
		return mail.quoteCreate({
			userId: c.userId,
			agentId: c.agentId,
			localPart: c.body.local_part,
			displayName: c.body.display_name,
			paymentSource: c.body.payment_source,
		});
	}
	if (action === 'send') {
		return mail.quoteSend({ userId: c.userId, agentId: c.agentId, draft: draftFrom(c.body), paymentSource: c.body.payment_source });
	}
	throw new mail.MailError(400, 'invalid_action', 'action must be "create" or "send".');
}

function list(c) {
	return mail.listMessages({
		userId: c.userId, agentId: c.agentId, folder: c.q('folder') || 'inbox', unread: bool(c.q('unread')),
		q: c.q('q') || '', limit: c.q('limit'), cursor: c.q('cursor'),
	});
}

/** Route table: [method, pattern, scope, handler(ctx), status]. */
const ROUTES = [
	['GET', '', READ_SCOPE, (c) => mail.getMailboxForAgent({ userId: c.userId, agentId: c.agentId })],
	['GET', 'address', READ_SCOPE, async (c) => {
		const { mailbox, domain } = await mail.getMailboxForAgent({ userId: c.userId, agentId: c.agentId });
		return { address: mailbox?.address || null, display_name: mailbox?.display_name || null, domain };
	}],
	['POST', 'quote', MONEY_SCOPE, quote, 201],
	['POST', 'create', MONEY_SCOPE, (c) => mail.createMailbox({ userId: c.userId, agentId: c.agentId, quoteId: c.body.quote_id, confirm: c.body.confirm_spend }), 201],
	['POST', 'send', MONEY_SCOPE, (c) => mail.sendMail({
		userId: c.userId, agentId: c.agentId, quoteId: c.body.quote_id, draft: draftFrom(c.body), confirm: c.body.confirm_send,
	}), 201],
	['GET', 'messages', READ_SCOPE, list],
	['GET', 'list', READ_SCOPE, list],
	['GET', 'messages/:msg', READ_SCOPE, (c) => mail.readMessage({
		userId: c.userId, agentId: c.agentId, messageId: c.params.msg, markRead: c.q('mark_read') !== '0',
	})],
	['POST', 'messages/:msg/read', WRITE_SCOPE, (c) => mail.setRead({
		userId: c.userId, agentId: c.agentId, messageId: c.params.msg, read: c.body.read !== false,
	})],
	['DELETE', 'messages/:msg', WRITE_SCOPE, (c) => mail.deleteMessage({ userId: c.userId, agentId: c.agentId, messageId: c.params.msg })],
	['GET', 'messages/:msg/attachments/:index', READ_SCOPE, (c) => mail.attachmentDownloadUrl({
		userId: c.userId, agentId: c.agentId, messageId: c.params.msg, index: c.params.index,
	})],
	['GET', 'chat', READ_SCOPE, (c) => emailChatStatus({ userId: c.userId, agentId: c.agentId })],
	['POST', 'chat', WRITE_SCOPE, (c) => setEmailChat({ userId: c.userId, agentId: c.agentId, enabled: c.body.enabled !== false })],
].map(([m, pattern, scope, handler, status = 200]) => ({ method: m, parts: pattern.split('/').filter(Boolean), scope, handler, status }));

/** Match method + segments. Returns { route, params }, { methodMismatch }, or null. */
export function matchRoute(method, segments) {
	let pathSeen = false;
	for (const r of ROUTES) {
		if (r.parts.length !== segments.length) continue;
		const params = {};
		let ok = true;
		for (let i = 0; i < r.parts.length; i++) {
			const p = r.parts[i];
			if (p.startsWith(':')) params[p.slice(1)] = segments[i];
			else if (p !== segments[i]) {
				ok = false;
				break;
			}
		}
		if (!ok) continue;
		pathSeen = true;
		if (r.method === method) return { route: r, params };
	}
	return pathSeen ? { methodMismatch: true } : null;
}

export default async function handler(req, res) {
	const ctx = { requestId: randomUUID() };
	res.setHeader('x-request-id', ctx.requestId);
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;

	const { url, agentId, segments } = parseTarget(req);
	const hit = matchRoute(req.method, segments);
	if (!hit?.route) {
		if (hit?.methodMismatch) return sendError(res, ctx, 405, 'method_not_allowed', `${req.method} is not supported on this path`);
		return sendError(res, ctx, 404, 'not_found', 'unknown agent mail route');
	}

	try {
		const principal = await resolvePrincipal(req);
		if (!principal) return sendError(res, ctx, 401, 'unauthorized', 'Sign in or send a three.ws API key.');
		const scope = hit.route.scope;
		// A write scope implies its read scope, as it does everywhere else in v1.
		const scoped =
			principal.source === 'session' ||
			hasScope(principal.scope, scope) ||
			(scope === READ_SCOPE && hasScope(principal.scope, WRITE_SCOPE));
		if (!scoped) return sendError(res, ctx, 403, 'insufficient_scope', `This key needs the ${scope} scope.`, { required: scope });

		const rl = await limits.apiV1(`mail:${principal.userId}`);
		setRateLimitHeaders(res, rl);
		if (!rl.success) return sendError(res, ctx, 429, 'rate_limited', 'Too many requests. Slow down and retry shortly.');

		let body = {};
		if (req.method === 'POST' || req.method === 'DELETE') {
			if (principal.source === 'session') {
				const v = await checkCsrf(req, principal.userId);
				if (!v.ok) return sendError(res, ctx, 403, v.code, v.message);
			}
		}
		if (req.method === 'POST') {
			try {
				body = (await readJson(req)) || {};
			} catch (e) {
				return sendError(res, ctx, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid JSON body');
			}
			if (typeof body !== 'object' || Array.isArray(body)) body = {};
		}

		const c = { agentId, userId: principal.userId, params: hit.params, body, q: (k) => url.searchParams.get(k) };
		const data = await hit.route.handler(c);
		return send(res, hit.route.status, { data, meta: meta(ctx) });
	} catch (e) {
		if (e instanceof mail.MailError) return sendError(res, ctx, e.status, e.code, e.message, e.details);
		console.error('[agent-mail]', ctx.requestId, e?.message);
		return sendError(res, ctx, 500, 'internal_error', 'Something went wrong on our side. Nothing was charged unless the response said so; check the mailbox before retrying.');
	}
}

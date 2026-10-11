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
 *                                                           { action: 'reply', message_id, text, html?, reply_all?, attachments?, payment_source? }
 *   POST   /api/v1/agents/:id/mail/create                   { quote_id, confirm_spend: true }
 *   POST   /api/v1/agents/:id/mail/send                     { quote_id, confirm_send: true, ...the exact draft that was quoted }
 *   POST   /api/v1/agents/:id/mail/reply                    { quote_id, confirm_send: true, message_id, text, html?, reply_all?, attachments? }
 *   GET    /api/v1/agents/:id/mail/search                   ?q=&folder=all|inbox|sent|spam&limit=&cursor=
 *   GET    /api/v1/agents/:id/mail/messages                 ?folder=inbox|sent|spam|all&unread=1&q=&limit=&cursor= (alias: /mail/list)
 *   GET    /api/v1/agents/:id/mail/messages/:msg            one message (marks a received message read; ?mark_read=0 to peek)
 *   POST   /api/v1/agents/:id/mail/messages/:msg/read       { read: true|false }
 *   DELETE /api/v1/agents/:id/mail/messages/:msg          (alias: POST /mail/messages/:msg/delete)
 *   GET    /api/v1/agents/:id/mail/messages/:msg/attachments/:index   short-lived download URL
 *
 *   Owner controls (writes need a signed-in session; an API key can read them):
 *   GET    /api/v1/agents/:id/mail/settings                 allowlist, daily cap, rules, usage
 *   PUT    /api/v1/agents/:id/mail/policy                   { allowlist_enabled?, allowlist?, daily_send_cap? }
 *   GET    /api/v1/agents/:id/mail/rules
 *   POST   /api/v1/agents/:id/mail/rules                    { name, match_from, match_subject?, mode: approve|auto, prompt, enabled? }
 *   PATCH  /api/v1/agents/:id/mail/rules/:rule              any of the fields above
 *   DELETE /api/v1/agents/:id/mail/rules/:rule
 *   GET    /api/v1/agents/:id/mail/rule-events              recent rule firings with their approval / run state
 *
 * Envelope (the v1 contract): success { data, meta: { requestId, timestamp } },
 * failure { error: { code, message, details }, meta }.
 *
 * Auth: a signed-in session (writes need X-CSRF-Token), or a three.ws API key
 * / OAuth token. Bearer callers need `agents:read` for reads, `agents:write`
 * for message state changes, and `wallet:write` for anything that quotes or
 * charges (provisioning and sending are metered).
 *
 * Received mail is untrusted data. Read routes return it as stored, with
 * `untrusted: true` on every received message; the MCP tools additionally
 * fence it for a model (api/_lib/mail/untrusted.js).
 */

import { randomUUID } from 'node:crypto';
import { cors, readJson, setRateLimitHeaders } from '../_lib/http.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../_lib/auth.js';
import { checkCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import * as mail from '../_lib/mail/service.js';

const READ_SCOPE = 'agents:read';
const WRITE_SCOPE = 'agents:write';
const MONEY_SCOPE = 'wallet:write';
// The allowlist, cap and rules guard what an agent may do with mail, so only
// the owner in a browser session may change them; an agent holding the
// owner's API key must not be able to loosen its own limits.
const OWNER_SESSION = 'owner_session';

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
	if (action === 'reply') {
		return mail.quoteReply({
			userId: c.userId, agentId: c.agentId, messageId: c.body.message_id, text: c.body.text, html: c.body.html,
			replyAll: bool(c.body.reply_all), attachments: c.body.attachments, paymentSource: c.body.payment_source,
		});
	}
	throw new mail.MailError(400, 'invalid_action', 'action must be "create", "send" or "reply".');
}

function list(c) {
	return mail.listMessages({
		userId: c.userId, agentId: c.agentId, folder: c.q('folder') || 'inbox', unread: bool(c.q('unread')),
		q: c.q('q') || '', limit: c.q('limit'), cursor: c.q('cursor'),
	});
}

const remove = (c) => mail.deleteMessage({ userId: c.userId, agentId: c.agentId, messageId: c.params.msg });

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
	['POST', 'reply', MONEY_SCOPE, (c) => mail.sendReply({
		userId: c.userId, agentId: c.agentId, messageId: c.body.message_id, text: c.body.text, html: c.body.html,
		replyAll: bool(c.body.reply_all), attachments: c.body.attachments, quoteId: c.body.quote_id, confirm: c.body.confirm_send,
	}), 201],
	['GET', 'search', READ_SCOPE, (c) => mail.searchMessages({
		userId: c.userId, agentId: c.agentId, query: c.q('q'), folder: c.q('folder') || 'all', limit: c.q('limit'), cursor: c.q('cursor'),
	})],
	['GET', 'messages', READ_SCOPE, list],
	['GET', 'list', READ_SCOPE, list],
	['GET', 'messages/:msg', READ_SCOPE, (c) => mail.readMessage({
		userId: c.userId, agentId: c.agentId, messageId: c.params.msg, markRead: c.q('mark_read') !== '0',
	})],
	['POST', 'messages/:msg/read', WRITE_SCOPE, (c) => mail.setRead({
		userId: c.userId, agentId: c.agentId, messageId: c.params.msg, read: c.body.read !== false,
	})],
	['DELETE', 'messages/:msg', WRITE_SCOPE, remove],
	['POST', 'messages/:msg/delete', WRITE_SCOPE, remove],
	['GET', 'messages/:msg/attachments/:index', READ_SCOPE, (c) => mail.attachmentDownloadUrl({
		userId: c.userId, agentId: c.agentId, messageId: c.params.msg, index: c.params.index,
	})],
	['GET', 'settings', READ_SCOPE, (c) => mail.getMailSettings({ userId: c.userId, agentId: c.agentId })],
	['PUT', 'policy', OWNER_SESSION, (c) => mail.updateMailPolicy({ userId: c.userId, agentId: c.agentId, patch: c.body })],
	['GET', 'rules', READ_SCOPE, (c) => mail.listMailRules({ userId: c.userId, agentId: c.agentId })],
	['POST', 'rules', OWNER_SESSION, (c) => mail.createMailRule({ userId: c.userId, agentId: c.agentId, input: c.body }), 201],
	['PATCH', 'rules/:rule', OWNER_SESSION, (c) => mail.updateMailRule({ userId: c.userId, agentId: c.agentId, ruleId: c.params.rule, input: c.body })],
	['DELETE', 'rules/:rule', OWNER_SESSION, (c) => mail.deleteMailRule({ userId: c.userId, agentId: c.agentId, ruleId: c.params.rule })],
	['GET', 'rule-events', READ_SCOPE, (c) => mail.listMailRuleEvents({ userId: c.userId, agentId: c.agentId, limit: c.q('limit') })],
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
	if (cors(req, res, { methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS', credentials: true })) return;

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
		if (scope === OWNER_SESSION && principal.source !== 'session') {
			return sendError(res, ctx, 403, 'owner_session_required', 'Mail allowlist, cap and rules can only be changed by the owner while signed in at three.ws, never with an API key.');
		}
		// A write scope implies its read scope, as it does everywhere else in v1.
		const scoped =
			scope === OWNER_SESSION ||
			principal.source === 'session' ||
			hasScope(principal.scope, scope) ||
			(scope === READ_SCOPE && hasScope(principal.scope, WRITE_SCOPE));
		if (!scoped) return sendError(res, ctx, 403, 'insufficient_scope', `This key needs the ${scope} scope.`, { required: scope });

		const rl = await limits.apiV1(`mail:${principal.userId}`);
		setRateLimitHeaders(res, rl);
		if (!rl.success) return sendError(res, ctx, 429, 'rate_limited', 'Too many requests. Slow down and retry shortly.');

		let body = {};
		const writes = req.method !== 'GET';
		if (writes) {
			if (principal.source === 'session') {
				const v = await checkCsrf(req, principal.userId);
				if (!v.ok) return sendError(res, ctx, 403, v.code, v.message);
			}
		}
		if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
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

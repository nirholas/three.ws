// The v1 agents API contract: one router, one envelope, one error shape.
//
// Every route under /api/v1/{agents,runs,automations,models,me,intel,strategies}
// is declared in api/v1/rest.js as a row of `defineRouter`. This module gives
// each row the same behavior:
//
//   • Auth      three.ws API key (`Authorization: Bearer sk_live_…`), OAuth
//               access token, or a signed-in browser session.
//   • Scopes    declared per route, enforced for key and OAuth callers.
//   • CSRF      cookie-authenticated writes must carry X-CSRF-Token.
//   • Limits    per principal (key › user › ip) via limits.apiV1.
//   • Metering  every call lands in usage_events as kind 'api'.
//   • Envelope  success → { data, meta: { requestId, timestamp, … } }
//               failure → { error: { code, message, details }, meta }
//   • Replay    an authenticated write carrying `Idempotency-Key` runs once;
//               a retry with the same key and body gets the stored response
//               back (header `Idempotent-Replayed: true`) for 24 hours.
//
// A handler returns its payload, or `created(payload)` for a 201, or writes
// the response itself (the SSE stream) and returns nothing. To fail, throw
// `apiError(status, code, message, details)`. Anything else that throws is a
// 500 with a sanitized message; the stable error codes are listed in
// docs/api-reference.md.

import { createHash, randomUUID } from 'node:crypto';
import { cors, readJson, setRateLimitHeaders } from '../http.js';
import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../auth.js';
import { checkCsrf } from '../csrf.js';
import { limits, clientIp } from '../rate-limit.js';
import { recordEvent } from '../usage.js';
import { acquireLock, cacheGet, cacheSet, releaseLock } from '../cache.js';

export class ApiError extends Error {
	/**
	 * @param {number} status
	 * @param {string} code
	 * @param {string} message
	 * @param {object|null} [details]
	 */
	constructor(status, code, message, details = null) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

/** Build an ApiError to throw. */
export function apiError(status, code, message, details = null) {
	return new ApiError(status, code, message, details);
}

const CREATED = Symbol('created');

/** Mark a handler result as a 201 Created. */
export function created(data) {
	return { [CREATED]: true, data };
}

/** Attach pagination to a list result: `{ items, hasMore, nextCursor }`. */
export function page(items, { hasMore, nextCursor = null }) {
	return { __page: true, items, hasMore: Boolean(hasMore), nextCursor };
}

function meta(ctx, extra = {}) {
	return { requestId: ctx.requestId, timestamp: new Date().toISOString(), ...extra };
}

function send(res, status, body) {
	if (res.headersSent || res.writableEnded) return;
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(JSON.stringify(body));
}

/** Write an error envelope. */
export function sendError(res, ctx, status, code, message, details = null) {
	send(res, status, { error: { code, message, details }, meta: meta(ctx) });
}

/** Compile '/agents/:id/runs' into a matcher returning params or null. */
export function compilePath(pattern) {
	const parts = pattern.split('/').filter(Boolean);
	return (segments) => {
		if (segments.length !== parts.length) return null;
		const params = {};
		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			if (p.startsWith(':')) params[p.slice(1)] = segments[i];
			else if (p !== segments[i]) return null;
		}
		return params;
	};
}

async function resolvePrincipal(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session', scope: 'all' };
	const bearer = await authenticateBearer(extractBearer(req));
	if (!bearer) return null;
	return {
		userId: bearer.userId,
		source: bearer.source,
		scope: bearer.scope || '',
		apiKeyId: bearer.apiKeyId,
		clientId: bearer.clientId,
	};
}

/**
 * Build the single request handler for a table of routes.
 *
 * @param {object} o
 * @param {string} o.base  URL prefix stripped before matching, e.g. '/api/v1'
 * @param {Array<{ method: string, path: string, name: string, auth: 'public'|'optional'|'required',
 *   scope?: string, csrf?: boolean, handler: (ctx: object) => any }>} o.routes
 */
export function defineRouter({ base, routes }) {
	const compiled = routes.map((r) => ({ ...r, match: compilePath(r.path) }));
	const allMethods = [...new Set(routes.map((r) => r.method))];

	return async function handler(req, res) {
		const ctx = { requestId: randomUUID(), req, res };
		res.setHeader('x-request-id', ctx.requestId);
		if (cors(req, res, { methods: [...allMethods, 'OPTIONS'].join(','), origins: '*' })) return;

		const url = new URL(req.url, 'http://internal');
		let rel = url.pathname;
		if (rel.startsWith(base)) rel = rel.slice(base.length);
		let segments;
		try {
			segments = rel.split('/').filter(Boolean).map(decodeURIComponent);
		} catch {
			return sendError(res, ctx, 400, 'bad_request', 'Malformed URL encoding.');
		}

		let route = null;
		let params = null;
		let pathMatched = false;
		for (const r of compiled) {
			const p = r.match(segments);
			if (!p) continue;
			pathMatched = true;
			if (r.method === req.method) {
				route = r;
				params = p;
				break;
			}
		}
		if (!route) {
			return pathMatched
				? sendError(res, ctx, 405, 'method_not_allowed', `${req.method} is not supported on ${url.pathname}.`)
				: sendError(res, ctx, 404, 'not_found', `No route matches ${req.method} ${url.pathname}.`);
		}

		const started = Date.now();
		let principal = null;
		try {
			if (route.auth !== 'public') {
				principal = await resolvePrincipal(req);
				if (route.auth === 'required' && !principal) {
					throw apiError(
						401,
						'unauthorized',
						'Authenticate with a three.ws API key (`Authorization: Bearer sk_live_…`) or sign in. Create a key at /dashboard/developers.',
					);
				}
				if (principal && principal.source !== 'session' && route.scope && !hasScope(principal.scope, route.scope)) {
					throw apiError(403, 'insufficient_scope', `This route requires the "${route.scope}" scope.`, {
						required: route.scope,
					});
				}
			}

			const rlKey = principal?.apiKeyId
				? `key:${principal.apiKeyId}`
				: principal?.userId
					? `user:${principal.userId}`
					: `ip:${clientIp(req)}`;
			const rl = await limits.apiV1(rlKey);
			const retryAfter = Math.max(1, setRateLimitHeaders(res, rl) || 1);
			if (!rl.success) {
				res.setHeader('retry-after', String(retryAfter));
				throw apiError(429, 'rate_limited', 'Too many requests. Slow down and retry.', { retryAfterSeconds: retryAfter });
			}

			const writes = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
			let body = {};
			if (writes && req.method !== 'DELETE' && hasBody(req)) {
				try {
					body = (await readJson(req)) || {};
				} catch (err) {
					throw apiError(400, 'bad_json', err?.message || 'The request body must be JSON.');
				}
				if (!body || typeof body !== 'object' || Array.isArray(body)) {
					throw apiError(400, 'bad_json', 'The request body must be a JSON object.');
				}
			}
			if (writes && principal?.source === 'session' && route.csrf !== false) {
				const verdict = await checkCsrf({ headers: req.headers, body }, principal.userId);
				if (!verdict.ok) throw apiError(403, verdict.code, verdict.message);
			}

			const idem = writes && principal ? idempotencyKey(req, principal, route, body) : null;
			if (idem) {
				const stored = await cacheGet(idem.key).catch(() => null);
				if (stored) {
					if (stored.bodyHash !== idem.bodyHash) {
						throw apiError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used with a different request body.');
					}
					res.setHeader('idempotent-replayed', 'true');
					meter(route, principal, 'ok', started);
					return send(res, stored.status, stored.body);
				}
				if (!(await acquireLock(`${idem.key}:lock`, 120))) {
					throw apiError(409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running. Retry shortly.');
				}
				ctx.idem = idem;
			}

			const query = Object.fromEntries(url.searchParams);
			let result;
			try {
				result = await route.handler({ ...ctx, principal, params, query, body, ip: clientIp(req) });
			} finally {
				if (ctx.idem) releaseLock(`${ctx.idem.key}:lock`);
			}
			meter(route, principal, 'ok', started);
			if (res.headersSent || res.writableEnded) return;
			const out = shape(ctx, result);
			if (ctx.idem) {
				await cacheSet(ctx.idem.key, { ...out, bodyHash: ctx.idem.bodyHash }, IDEMPOTENCY_TTL_S).catch(() => {});
			}
			return send(res, out.status, out.body);
		} catch (err) {
			meter(route, principal, 'error', started);
			if (res.headersSent) {
				if (!res.writableEnded) res.end();
				return;
			}
			if (err instanceof ApiError) return sendError(res, ctx, err.status, err.code, err.message, err.details);
			// A 4xx thrown by a shared helper (a SpendLimitError, an insufficient-
			// credits 402) keeps its code and message; everything else is redacted.
			const status = Number(err?.status);
			if (status >= 400 && status < 500 && err?.code) {
				return sendError(res, ctx, status, String(err.code), String(err.message || err.code), err.detail || null);
			}
			console.error(`[v1] ${req.method} ${url.pathname} failed (${ctx.requestId}):`, err);
			return sendError(res, ctx, 500, 'internal_error', 'The request failed unexpectedly. Quote the requestId if you report it.');
		}
	};
}

const IDEMPOTENCY_TTL_S = 24 * 60 * 60;

function shape(ctx, result) {
	if (result && result[CREATED]) return { status: 201, body: { data: result.data, meta: meta(ctx) } };
	if (result && result.__page) {
		return {
			status: 200,
			body: { data: result.items, meta: meta(ctx, { hasMore: result.hasMore, nextCursor: result.nextCursor }) },
		};
	}
	return { status: 200, body: { data: result ?? null, meta: meta(ctx) } };
}

function idempotencyKey(req, principal, route, body) {
	const raw = req.headers['idempotency-key'];
	if (typeof raw !== 'string' || !raw.trim()) return null;
	if (raw.length > 200) throw apiError(400, 'invalid_idempotency_key', 'Idempotency-Key must be at most 200 characters.');
	const digest = (v) => createHash('sha256').update(v).digest('hex');
	return {
		key: `v1:idem:${principal.userId}:${route.name}:${digest(raw.trim())}`,
		bodyHash: digest(`${req.url}\n${JSON.stringify(body)}`),
	};
}

// A write with no payload (POST /agents/:id/start) is valid; only a declared
// or non-empty body is parsed.
function hasBody(req) {
	if (req.body !== undefined && req.body !== null && !(typeof req.body === 'object' && Object.keys(req.body).length === 0)) return true;
	if (req.headers['content-type']) return true;
	const len = Number(req.headers['content-length'] || 0);
	return len > 0 || Boolean(req.headers['transfer-encoding']);
}

function meter(route, principal, status, started) {
	recordEvent({
		kind: 'api',
		tool: route.name,
		userId: principal?.userId,
		apiKeyId: principal?.apiKeyId,
		clientId: principal?.clientId,
		status,
		latencyMs: Date.now() - started,
	});
}

// ── input helpers shared by the service modules ──────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throw 404 unless `id` is a UUID (every v1 resource id is one). */
export function requireUuid(id, what = 'resource') {
	if (typeof id !== 'string' || !UUID_RE.test(id)) throw apiError(404, 'not_found', `No ${what} with that id.`);
	return id.toLowerCase();
}

/** Parse an optional bounded integer query/body value. */
export function intParam(value, { name, min, max, fallback }) {
	if (value === undefined || value === null || value === '') return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max) {
		throw apiError(400, 'invalid_parameter', `${name} must be an integer from ${min} to ${max}.`, { parameter: name });
	}
	return n;
}

/** Parse an optional non-negative number. */
export function numParam(value, { name, min = 0, max = Number.MAX_SAFE_INTEGER, fallback = null }) {
	if (value === undefined || value === null || value === '') return fallback;
	const n = Number(value);
	if (!Number.isFinite(n) || n < min || n > max) {
		throw apiError(400, 'invalid_parameter', `${name} must be a number from ${min} to ${max}.`, { parameter: name });
	}
	return n;
}

/** Parse an optional trimmed string with a max length. */
export function strParam(value, { name, max, required = false }) {
	if (value === undefined || value === null || value === '') {
		if (required) throw apiError(400, 'missing_parameter', `${name} is required.`, { parameter: name });
		return null;
	}
	if (typeof value !== 'string') throw apiError(400, 'invalid_parameter', `${name} must be a string.`, { parameter: name });
	const s = value.trim();
	if (required && !s) throw apiError(400, 'missing_parameter', `${name} is required.`, { parameter: name });
	if (s.length > max) throw apiError(400, 'invalid_parameter', `${name} must be at most ${max} characters.`, { parameter: name });
	return s || null;
}

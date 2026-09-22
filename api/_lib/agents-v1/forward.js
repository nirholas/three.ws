// Call an existing /api handler in-process from a v1 route and turn its
// response into a v1 result, so a v1 route reuses the handler's whole guard
// chain (ownership, spend policy, real-funds agreement, CSRF, rate limits,
// custody ledger) instead of re-implementing it.
//
// The forwarded request keeps the caller's headers (so the handler resolves the
// same principal from the same bearer or session cookie) and carries the new
// body as `rawBody`, which api/_lib/http.js readBody prefers over the already
// drained stream. The legacy envelope `{ error, error_description, ...extra }`
// becomes an ApiError with the same status and code, extra as details.

import { apiError } from './http.js';

/**
 * @param {(req: object, res: object) => Promise<void>} handler
 * @param {object} ctx      the v1 route ctx (uses ctx.req)
 * @param {object} o
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} o.method
 * @param {string} o.url    path + query the handler sees, e.g. '/api/agents/<id>/solana?network=mainnet'
 * @param {object} [o.body] JSON body for writes
 * @returns {Promise<{ status: number, body: any, headers: Record<string, string> }>}
 */
export async function forward(handler, ctx, { method, url, body }) {
	const headers = { ...ctx.req.headers };
	delete headers['content-length'];
	delete headers['transfer-encoding'];
	let rawBody;
	if (body !== undefined) {
		rawBody = Buffer.from(JSON.stringify(body));
		headers['content-type'] = 'application/json';
		headers['content-length'] = String(rawBody.length);
	}
	// Inherit socket and connection info from the real request; override what
	// the target handler reads.
	const req = Object.create(ctx.req, {
		method: { value: method, writable: true },
		url: { value: url, writable: true },
		headers: { value: headers, writable: true },
		rawBody: { value: rawBody, writable: true },
		body: { value: body, writable: true },
		query: { value: Object.fromEntries(new URL(url, 'http://internal').searchParams), writable: true },
	});

	const res = new CapturedResponse();
	await handler(req, res);
	return { status: res.statusCode, body: res.json(), headers: res.headers };
}

/**
 * Forward and unwrap: a 2xx returns the handler's `data` (or the whole body
 * when it has no `data` key); anything else throws an ApiError.
 */
export async function forwardData(handler, ctx, opts) {
	const out = await forward(handler, ctx, opts);
	if (out.status >= 200 && out.status < 300) {
		const b = out.body;
		return b && typeof b === 'object' && 'data' in b ? b.data : b;
	}
	throw toApiError(out);
}

/** Convert a captured non-2xx legacy response into an ApiError. */
export function toApiError({ status, body }) {
	if (body && typeof body === 'object') {
		if (body.error && typeof body.error === 'object') {
			return apiError(status, body.error.code || 'error', body.error.message || 'Request failed.', body.error.details ?? null);
		}
		const { error: code, error_description: message, ...extra } = body;
		if (typeof code === 'string') {
			return apiError(status, code, message || code, Object.keys(extra).length ? extra : null);
		}
	}
	return apiError(status >= 400 ? status : 502, 'upstream_error', 'The request failed.');
}

class CapturedResponse {
	constructor() {
		this.statusCode = 200;
		this.headers = {};
		this.headersSent = false;
		this.writableEnded = false;
		this.chunks = [];
	}
	setHeader(k, v) {
		this.headers[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
	}
	getHeader(k) {
		return this.headers[String(k).toLowerCase()];
	}
	removeHeader(k) {
		delete this.headers[String(k).toLowerCase()];
	}
	writeHead(status, headers) {
		this.statusCode = status;
		if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
		this.headersSent = true;
		return this;
	}
	write(chunk) {
		this.headersSent = true;
		if (chunk != null) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
		return true;
	}
	end(chunk) {
		if (chunk != null) this.write(chunk);
		this.headersSent = true;
		this.writableEnded = true;
		return this;
	}
	json() {
		const text = Buffer.concat(this.chunks).toString('utf8');
		if (!text) return null;
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
}

// HTTP helpers for Vercel Node handlers. Keeps handlers small + consistent.

import { env } from './env.js';
import { captureException } from './sentry.js';
import { instrument as zauthInstrument } from './zauth.js';

export function json(res, status, body, headers = {}) {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
	res.end(JSON.stringify(body));
}

export function text(res, status, body, headers = {}) {
	res.statusCode = status;
	res.setHeader('content-type', 'text/plain; charset=utf-8');
	for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
	res.end(body);
}

export function redirect(res, location, status = 302) {
	res.statusCode = status;
	res.setHeader('location', location);
	res.setHeader('cache-control', 'no-store');
	res.end();
}

export function error(res, status, code, message, extra = {}) {
	return json(res, status, { error: code, error_description: message, ...extra });
}

export async function readJson(req, limit = 1_000_000) {
	const ct = req.headers['content-type'] || '';
	if (!ct.includes('application/json')) {
		const err = new Error('content-type must be application/json');
		err.status = 415;
		throw err;
	}
	return readBody(req, limit).then((buf) => {
		try {
			return JSON.parse(buf.toString('utf8'));
		} catch {
			const e = new Error('invalid JSON');
			e.status = 400;
			throw e;
		}
	});
}

export async function readForm(req, limit = 1_000_000) {
	const buf = await readBody(req, limit);
	return Object.fromEntries(new URLSearchParams(buf.toString('utf8')));
}

function readBody(req, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		req.on('data', (c) => {
			total += c.length;
			if (total > limit) {
				reject(Object.assign(new Error('payload too large'), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

export function cors(
	req,
	res,
	{ origins = null, methods = 'GET,POST,OPTIONS', credentials = false } = {},
) {
	const origin = req.headers.origin;
	if (origins === '*') {
		res.setHeader('access-control-allow-origin', '*');
	} else if (origin && isAllowedOrigin(origin, origins)) {
		res.setHeader('access-control-allow-origin', origin);
		res.setHeader('vary', 'origin');
		if (credentials) res.setHeader('access-control-allow-credentials', 'true');
	}
	res.setHeader('access-control-allow-methods', methods);
	res.setHeader(
		'access-control-allow-headers',
		'authorization, content-type, mcp-session-id, mcp-protocol-version',
	);
	res.setHeader('access-control-max-age', '86400');
	if (req.method === 'OPTIONS') {
		res.statusCode = 204;
		res.end();
		return true;
	}
	return false;
}

function isAllowedOrigin(origin, allowed) {
	if (!allowed) {
		if (origin === env.APP_ORIGIN) return true;
		if (origin === 'https://x402scan.com') return true;
		if (
			process.env.NODE_ENV !== 'production' &&
			/^https?:\/\/localhost(:\d+)?$/.test(origin)
		) {
			return true;
		}
		return false;
	}
	return allowed.some((pat) => (typeof pat === 'string' ? origin === pat : pat.test(origin)));
}

// Wrap async handlers so uncaught errors return a consistent JSON envelope.
export function wrap(handler) {
	return async (req, res) => {
		zauthInstrument(req, res);
		try {
			await handler(req, res);
		} catch (err) {
			const status = err.status || 500;
			if (status >= 500) {
				console.error('[api] unhandled', err);
				captureException(err, { url: req.url, method: req.method });
			}
			if (!res.writableEnded) {
				error(
					res,
					status,
					err.code || (status >= 500 ? 'internal_error' : 'bad_request'),
					err.message || 'error',
				);
			}
		}
	};
}

export function method(req, res, allowed) {
	const m = req.method || 'GET';
	if (!allowed.includes(m)) {
		res.setHeader('allow', allowed.join(', '));
		error(res, 405, 'method_not_allowed', `method ${m} not allowed`);
		return false;
	}
	return true;
}

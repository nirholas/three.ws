// zauthx402 SDK adapter for Vercel serverless.
//
// The upstream `@zauthx402/sdk/middleware` is shaped for Express: it expects
// `req.path`, `req.protocol`, `req.get(name)`, `req.originalUrl`, `req.ip`,
// and patches `res.json/send/end`. Our endpoints run as bare Vercel Node
// handlers (http.IncomingMessage / http.ServerResponse), so we shim the
// missing properties before invoking the middleware once per request.
//
// Disabled cleanly when ZAUTH_API_KEY is unset — `instrument()` becomes a
// no-op so unrelated environments don't pay any cost.

import { createRequire } from 'node:module';
import { env } from './env.js';

const require = createRequire(import.meta.url);

let cached;

function buildMiddleware() {
	const apiKey = env.ZAUTH_API_KEY;
	if (!apiKey) return null;
	try {
		// Lazy require so deployments without the SDK installed (or without a
		// key) don't pay the import cost.
		const mod = require('@zauthx402/sdk/middleware');
		return mod.zauthProvider(apiKey, {
			shouldMonitor: shouldMonitorReq,
		});
	} catch (err) {
		console.error('[zauth] failed to load @zauthx402/sdk:', err.message);
		return null;
	}
}

function shouldMonitorReq(req) {
	if (req.headers?.['x-payment-intent'] || req.headers?.['x-payment']) return true;
	const p = req.path || '';
	return /\/api\/(wk-x402|mcp)(\/|$)|\/api\/agents\/x402\/|\/api\/agents\/[^/]+\/x402\/|\/api\/agents\/payments\//.test(
		p,
	);
}

function getMiddleware() {
	if (cached === undefined) cached = buildMiddleware();
	return cached;
}

function shimResponse(res) {
	// The Express middleware does `res.json.bind(res)` / `res.send.bind(res)`
	// up-front, even if the handler never calls them. Provide Express-shaped
	// no-op fallbacks (delegating to `res.end`) so binding works. Our handlers
	// only call `res.end` directly, so these patched versions are never run.
	if (typeof res.json !== 'function') {
		res.json = function (body) {
			if (!res.getHeader('content-type')) {
				res.setHeader('content-type', 'application/json; charset=utf-8');
			}
			res.end(JSON.stringify(body));
		};
	}
	if (typeof res.send !== 'function') {
		res.send = function (body) {
			res.end(typeof body === 'string' ? body : JSON.stringify(body));
		};
	}
}

function shimRequest(req) {
	const url = req.url || '/';
	const qIdx = url.indexOf('?');
	const path = qIdx >= 0 ? url.slice(0, qIdx) : url;
	const xfProto = req.headers['x-forwarded-proto'];
	const protocol = (Array.isArray(xfProto) ? xfProto[0] : xfProto) || 'https';
	const xfFor = req.headers['x-forwarded-for'];
	const ip =
		(typeof xfFor === 'string' ? xfFor.split(',')[0].trim() : null) ||
		req.socket?.remoteAddress ||
		'';

	if (!('path' in req)) Object.defineProperty(req, 'path', { value: path });
	if (!('originalUrl' in req)) Object.defineProperty(req, 'originalUrl', { value: url });
	if (!('protocol' in req)) Object.defineProperty(req, 'protocol', { value: protocol });
	if (!('ip' in req)) Object.defineProperty(req, 'ip', { value: ip });
	if (typeof req.get !== 'function') {
		req.get = (name) => {
			const v = req.headers[String(name).toLowerCase()];
			return Array.isArray(v) ? v[0] : v;
		};
	}
	// `req.body` is undefined on raw Vercel handlers; the SDK only reads it
	// for an optional byte-size estimate, so leaving it undefined is fine.
}

/**
 * Run the zauth middleware once for this request. Safe to call on every
 * request — internal `shouldMonitor` filters non-x402 traffic.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export function instrument(req, res) {
	const mw = getMiddleware();
	if (!mw) return;
	try {
		shimRequest(req);
		shimResponse(res);
		mw(req, res, () => {});
	} catch (err) {
		console.error('[zauth] middleware error:', err.message);
	}
}

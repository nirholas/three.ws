// In-process caller for the public /api/oracle/* endpoints.
//
// The Oracle MCP read tools are thin wrappers over the same handlers the web
// app and the REST API serve, so a tool can never drift from the endpoint it
// fronts: same SQL, same cache headers, same per-IP rate limit, same honesty
// rules. This runs a handler with a real Node request/response pair and returns
// the status and parsed JSON body. No network hop, no copied logic.

import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

const FALLBACK_IP = '127.0.0.1';

function buildRequest(path, query, ip) {
	const url = new URL(path, 'http://three.ws');
	for (const [key, value] of Object.entries(query || {})) {
		if (value === undefined || value === null || value === '') continue;
		url.searchParams.set(key, String(value));
	}
	const req = new IncomingMessage(new Socket());
	req.method = 'GET';
	req.url = `${url.pathname}${url.search}`;
	req.headers = {
		host: 'three.ws',
		accept: 'application/json',
		'x-forwarded-for': ip || FALLBACK_IP,
		'user-agent': 'three.ws-oracle-mcp',
	};
	return req;
}

/**
 * Run an endpoint handler in process.
 *
 * @param {(req, res) => Promise<void>} handler  The endpoint's default export.
 * @param {string} path                          e.g. '/api/oracle/stats'.
 * @param {{ query?: Record<string, unknown>, ip?: string }} [opts]
 * @returns {Promise<{ status: number, body: any, retryAfter: number|null }>}
 */
export function invokeEndpoint(handler, path, { query, ip } = {}) {
	const req = buildRequest(path, query, ip);
	const res = new ServerResponse(req);
	const chunks = [];

	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			const raw = Buffer.concat(chunks).toString('utf8');
			let body = null;
			if (raw) {
				try {
					body = JSON.parse(raw);
				} catch {
					body = { raw };
				}
			}
			const retry = Number(res.getHeader('retry-after'));
			resolve({ status: res.statusCode, body, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null });
		};
		const keep = (chunk) => {
			if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
		};
		res.write = (chunk) => {
			keep(chunk);
			return true;
		};
		res.end = (chunk) => {
			keep(chunk);
			Object.defineProperty(res, 'writableEnded', { value: true, configurable: true });
			finish();
			return res;
		};
		Promise.resolve(handler(req, res)).then(() => {
			if (!settled && !res.writableEnded) finish();
		}, (err) => {
			if (!settled) {
				settled = true;
				reject(err);
			}
		});
	});
}

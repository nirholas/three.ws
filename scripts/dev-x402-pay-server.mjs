#!/usr/bin/env node
// Local dev server for /api/x402-pay — runs the Vercel function under plain
// Node so the browser can hit it without `vercel dev` or deploying.
//
// Usage (in a second terminal):
//   node scripts/dev-x402-pay-server.mjs           # listens on :3032
//   DEV_API_PROXY=http://localhost:3032 npm run dev  # main Vite proxies /api/* here
//
// Falls through to https://three.ws for everything other than /api/x402-pay,
// so the rest of /api/* (mcp, auth, etc.) keeps working as before.

import { createServer } from 'node:http';
import { config as dotenv } from 'dotenv';
dotenv({ path: new URL('../.env', import.meta.url) });
const { default: handler } = await import('../api/x402-pay.js');
const { default: ogHandler } = await import('../api/x402-pay/og.js');

const PORT = Number(process.env.PORT || 3032);
const UPSTREAM = process.env.UPSTREAM || 'https://three.ws';

async function passthrough(req, res) {
	const url = new URL(req.url, UPSTREAM);
	const headers = { ...req.headers };
	delete headers.host;
	delete headers['content-length'];
	const chunks = [];
	for await (const c of req) chunks.push(c);
	const body = chunks.length ? Buffer.concat(chunks) : undefined;
	const upRes = await fetch(url, {
		method: req.method,
		headers,
		body: body && body.length ? body : undefined,
	});
	res.statusCode = upRes.status;
	upRes.headers.forEach((v, k) => res.setHeader(k, v));
	const text = await upRes.text();
	res.end(text);
}

const server = createServer(async (req, res) => {
	const path = req.url.split('?')[0];
	if (path === '/api/x402-pay/og') {
		try { return await ogHandler(req, res); }
		catch (err) {
			console.error('[x402-pay/og] handler error:', err);
			res.statusCode = 500;
			res.end('og handler error');
		}
		return;
	}
	if (path === '/api/x402-pay' || path === '/api/x402-pay/') {
		try { return await handler(req, res); }
		catch (err) {
			console.error('[x402-pay] handler error:', err);
			res.statusCode = 500;
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({ error: 'handler_crash', message: String(err.message || err) }));
		}
		return;
	}
	try { return await passthrough(req, res); }
	catch (err) {
		console.error('[passthrough] error:', err);
		res.statusCode = 502;
		res.end('upstream error');
	}
});

server.listen(PORT, () => {
	console.log(`[x402-pay-dev] http://localhost:${PORT}  (forwards other /api/* → ${UPSTREAM})`);
});

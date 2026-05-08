#!/usr/bin/env node
// Local dev server for /.well-known/* handlers — runs the api/wk.js Vercel
// function under plain Node so we can exercise it without `vercel dev`.
// Usage:  node scripts/dev-wk-server.mjs   →   http://localhost:3030/.well-known/x402.json

import { createServer } from 'node:http';
import { config as dotenv } from 'dotenv';
dotenv({ path: new URL('../.env', import.meta.url) });
const { default: wkHandler } = await import('../api/wk.js');
const { send402, paymentRequirements } = await import('../api/_lib/x402-spec.js');

const PORT = Number(process.env.PORT || 3030);

const ROUTES = {
	'/.well-known/x402.json': 'x402-discovery',
	'/.well-known/x402':      'x402',
	'/.well-known/chat-plugin.json': 'chat-plugin',
	'/.well-known/agent-attestation-schemas': 'agent-attestation-schemas',
	'/.well-known/oauth-authorization-server': 'oauth-authorization-server',
	'/.well-known/oauth-protected-resource':   'oauth-protected-resource',
};

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

	// Preview the live /api/mcp 402 challenge (skips auth/db so we just see the
	// challenge body the agentic.market validator will hit on production).
	if (url.pathname === '/api/mcp') {
		res.setHeader('access-control-allow-origin', '*');
		res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
		res.setHeader('access-control-allow-headers', 'authorization, content-type, x-payment');
		if (req.method === 'OPTIONS') {
			res.statusCode = 204;
			res.end();
			return;
		}
		const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
		const host = (req.headers['x-forwarded-host'] || req.headers.host || 'three.ws').toString();
		// Always quote the production URL — the validator pins on a stable resource string.
		const resourceUrl = `${proto}://three.ws/api/mcp`;
		send402(res, { resourceUrl, accepts: paymentRequirements() });
		return;
	}

	const name = ROUTES[url.pathname];
	if (!name) {
		res.statusCode = 404;
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify({ error: 'not_found', path: url.pathname, known: [...Object.keys(ROUTES), '/api/mcp'] }));
		return;
	}
	req.query = { name };
	await wkHandler(req, res);
});

server.listen(PORT, () => {
	console.log(`[dev-wk-server] listening on http://localhost:${PORT}`);
	for (const path of Object.keys(ROUTES)) console.log(`  → http://localhost:${PORT}${path}`);
	console.log(`  → http://localhost:${PORT}/api/mcp  (v2 402 challenge preview)`);
});

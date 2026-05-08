#!/usr/bin/env node
// Local dev server for /.well-known/* handlers — runs the api/wk.js Vercel
// function under plain Node so we can exercise it without `vercel dev`.
// Usage:  node scripts/dev-wk-server.mjs   →   http://localhost:3030/.well-known/x402.json

import { createServer } from 'node:http';
import { config as dotenv } from 'dotenv';
dotenv({ path: new URL('../.env', import.meta.url) });
const { default: wkHandler } = await import('../api/wk.js');

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
	const name = ROUTES[url.pathname];
	if (!name) {
		res.statusCode = 404;
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify({ error: 'not_found', path: url.pathname, known: Object.keys(ROUTES) }));
		return;
	}
	req.query = { name };
	await wkHandler(req, res);
});

server.listen(PORT, () => {
	console.log(`[dev-wk-server] listening on http://localhost:${PORT}`);
	for (const path of Object.keys(ROUTES)) console.log(`  → http://localhost:${PORT}${path}`);
});

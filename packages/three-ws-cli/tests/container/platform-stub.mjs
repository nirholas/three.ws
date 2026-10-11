// A stand-in for the three.ws endpoints the installer path touches, so the clean
// container test runs without a real account: whoami, the MCP directory, the
// hosted skill file, one MCP server, and the signed installer scripts themselves.
// Usage: node platform-stub.mjs <port>

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const port = Number(process.argv[2] || 8799);
const origin = `http://127.0.0.1:${port}`;
const json = (res, body, headers = {}) => {
	res.writeHead(200, { 'content-type': 'application/json', ...headers });
	res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
	const url = new URL(req.url, origin);
	if (url.pathname === '/api/cli/whoami') return json(res, { user: { id: 'stub-user', email: 'container@example.com' } });
	if (url.pathname === '/.well-known/mcp.json') return json(res, { servers: [{ name: 'three.ws', endpoint: `${origin}/mcp`, transport: 'streamable-http', auth: 'oauth' }] });
	if (url.pathname === '/skill.md') {
		res.writeHead(200, { 'content-type': 'text/markdown' });
		return res.end(fs.readFileSync(path.join(ROOT, 'public', 'skill.md')));
	}
	if (url.pathname.startsWith('/cli/')) {
		const file = path.join(ROOT, 'public', url.pathname);
		if (!file.startsWith(path.join(ROOT, 'public', 'cli')) || !fs.existsSync(file)) {
			res.writeHead(404);
			return res.end();
		}
		res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
		return res.end(fs.readFileSync(file));
	}
	if (url.pathname === '/mcp' && req.method === 'POST') {
		let body = '';
		req.on('data', (d) => (body += d));
		req.on('end', () => {
			const msg = JSON.parse(body);
			if (msg.method === 'initialize') return json(res, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '1' } } }, { 'mcp-session-id': 's' });
			if (msg.method === 'tools/list') return json(res, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'forge_free', inputSchema: { type: 'object' } }, { name: 'create_agent', inputSchema: { type: 'object' } }] } });
			res.writeHead(202);
			res.end();
		});
		return;
	}
	res.writeHead(404, { 'content-type': 'application/json' });
	res.end('{"error":"not_found"}');
}).listen(port, '127.0.0.1', () => console.log(`stub listening on ${origin}`));

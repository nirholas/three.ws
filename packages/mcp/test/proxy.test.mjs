// Spawns the real CLI against a local Streamable HTTP server.
// Run: node --test packages/mcp/test/proxy.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
let server;
let url;
const seen = [];

before(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const msg = JSON.parse(raw);
			seen.push({ auth: req.headers.authorization, session: req.headers['mcp-session-id'], method: msg.method });
			if (msg.method === 'notifications/initialized') {
				res.writeHead(202).end();
			} else if (msg.method === 'initialize') {
				res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
				res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'local', version: '0' } } }));
			} else {
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo' }] } })}\n\n`);
			}
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	url = `http://127.0.0.1:${server.address().port}/mcp`;
});

after(() => server.close());

test('proxies initialize, notifications and an SSE tools/list with key and session', async () => {
	const child = spawn(process.execPath, [CLI], {
		env: { ...process.env, THREE_WS_MCP_URL: url, THREE_WS_API_KEY: 'k_test' },
	});
	let out = '';
	child.stdout.on('data', (c) => (out += c));
	const lines = [
		{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
	];
	child.stdin.write(`${JSON.stringify(lines[0])}\n`);
	await new Promise((resolve) => {
		const poll = setInterval(() => {
			if (out.includes('\n')) {
				clearInterval(poll);
				resolve();
			}
		}, 20);
	});
	child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
	child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
	child.stdin.end();
	await new Promise((r) => child.on('close', r));

	const replies = out.trim().split('\n').map((l) => JSON.parse(l));
	assert.equal(replies.length, 2);
	assert.equal(replies[0].result.serverInfo.name, 'local');
	assert.deepEqual(replies[1].result.tools, [{ name: 'echo' }]);
	assert.ok(seen.every((s) => s.auth === 'Bearer k_test'));
	assert.equal(seen.find((s) => s.method === 'tools/list').session, 'sess-1');
});

test('an unreachable endpoint yields a JSON-RPC error for the request', async () => {
	const child = spawn(process.execPath, [CLI], {
		env: { ...process.env, THREE_WS_MCP_URL: 'http://127.0.0.1:1/mcp' },
	});
	let out = '';
	child.stdout.on('data', (c) => (out += c));
	child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })}\n`);
	await new Promise((r) => child.on('close', r));
	const reply = JSON.parse(out.trim());
	assert.equal(reply.id, 7);
	assert.match(reply.error.message, /Could not reach/);
});

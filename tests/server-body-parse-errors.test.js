/**
 * Body-parser rejections on the Cloud Run server (server/body-parse-errors.mjs).
 *
 * The server parses JSON in Express middleware ahead of the route table, so a
 * malformed body is rejected before any api/** handler runs. The MCP handlers
 * already answer a parse failure with JSON-RPC error -32700, but they never got
 * the chance: every MCP endpoint answered `{"error":"bad_request"}`, a shape no
 * JSON-RPC client can read. Connector reviewers (Meta Muse end-to-end QA, the
 * OpenAI plugin review, Glama's health check) send exactly this request.
 *
 * Runs the real express.json() parser over a real socket; nothing is stubbed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { bodyParseErrorHandler, isMcpRpcPath } from '../server/body-parse-errors.mjs';

let server;
let base;

beforeAll(async () => {
	const app = express();
	app.use(express.json({ limit: '1kb' }));
	app.use((req, res) => res.json({ ok: true, body: req.body }));
	app.use(bodyParseErrorHandler({ bodyLimit: '1kb' }));
	await new Promise((resolve) => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const post = (path, body) =>
	fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

// Every hosted MCP server the platform publishes, read from the same directory
// file MCP clients read, so a server published there but missing from the
// server's matcher fails here.
const mcpJson = JSON.parse(readFileSync(new URL('../public/.well-known/mcp.json', import.meta.url), 'utf8'));
const PUBLISHED = mcpJson.servers.map((s) => new URL(s.endpoint).pathname);

describe('malformed JSON to an MCP endpoint', () => {
	it.each([...PUBLISHED, '/api/mcp-chatgpt', '/api/mcp/all', '/api/v1/agents/abc123/mcp'])(
		'%s answers a JSON-RPC -32700 parse error',
		async (path) => {
			const r = await post(path, '{bad');
			expect(r.status).toBe(400);
			expect(r.headers.get('content-type')).toMatch(/application\/json/);
			const body = await r.json();
			expect(body).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
			expect(typeof body.error.message).toBe('string');
		},
	);

	it('keeps the query string out of the match', async () => {
		const body = await (await post('/api/mcp-studio?auth=oauth', '{bad')).json();
		expect(body.error.code).toBe(-32700);
	});

	it('an over-limit body to an MCP endpoint is a JSON-RPC error too', async () => {
		const r = await post('/api/mcp-studio', JSON.stringify({ pad: 'x'.repeat(4000) }));
		expect(r.status).toBe(413);
		const body = await r.json();
		expect(body).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } });
		expect(body.error.message).toMatch(/1 ?KB/i);
	});
});

describe('non-MCP endpoints keep the REST error shape', () => {
	it.each(['/api/forge', '/api/mcp-plans', '/api/mcp-tools'])('%s answers bad_request', async (path) => {
		const r = await post(path, '{bad');
		expect(r.status).toBe(400);
		const body = await r.json();
		expect(body.error).toBe('bad_request');
		expect(body.jsonrpc).toBeUndefined();
	});

	it('over-limit stays payload_too_large', async () => {
		const r = await post('/api/forge', JSON.stringify({ pad: 'x'.repeat(4000) }));
		expect(r.status).toBe(413);
		expect((await r.json()).error).toBe('payload_too_large');
	});
});

describe('isMcpRpcPath', () => {
	it('matches trailing slashes and rejects look-alikes', () => {
		expect(isMcpRpcPath('/mcp/')).toBe(true);
		expect(isMcpRpcPath('/api/mcp-studio/')).toBe(true);
		expect(isMcpRpcPath('/api/mcp-census')).toBe(false);
		expect(isMcpRpcPath('/mcp-clients')).toBe(false);
		expect(isMcpRpcPath('/api/v1/agents//mcp')).toBe(false);
	});
});

// A real MCP server on 127.0.0.1 for tests of the external-connection stack.
// It speaks Streamable HTTP (stateless, JSON responses) through the official SDK
// and, with `oauth: true`, also serves the discovery, registration and token
// endpoints a protected server publishes. It records every tool call so a test
// can assert on what the server actually received.

import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const STUB_TOOLS = [
	{ name: 'get_note', description: 'Read one note by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
	{ name: 'search_notes', description: 'Search notes by text.', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
	{ name: 'create_note', description: 'Create a note.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
	{ name: 'delete_note', description: 'Delete a note for good.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

const readBody = (req) =>
	new Promise((resolve) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
	});

/**
 * @param {{ requireBearer?: string|null, oauth?: boolean, tools?: object[], reply?: (name: string, args: object) => string }} [opts]
 */
export async function startStubMcp(opts = {}) {
	const state = {
		requireBearer: opts.requireBearer ?? null,
		tools: opts.tools || STUB_TOOLS,
		calls: [],
		tokenRequests: [],
		accepted: new Set(opts.oauth ? ['at-1', 'at-2'] : []),
		reply: opts.reply || ((name, args) => `result of ${name} ${JSON.stringify(args)}`),
	};
	let base = '';

	const handler = async (req, res) => {
		const url = new URL(req.url, 'http://x');
		const json = (status, body, headers = {}) => {
			res.writeHead(status, { 'content-type': 'application/json', ...headers });
			res.end(JSON.stringify(body));
		};

		if (opts.oauth) {
			if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
				return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
			}
			if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
				return json(200, {
					issuer: base,
					authorization_endpoint: `${base}/authorize`,
					token_endpoint: `${base}/token`,
					registration_endpoint: `${base}/register`,
					response_types_supported: ['code'],
					grant_types_supported: ['authorization_code', 'refresh_token'],
					code_challenge_methods_supported: ['S256'],
					token_endpoint_auth_methods_supported: ['none'],
				});
			}
			if (url.pathname === '/register' && req.method === 'POST') {
				const meta = JSON.parse((await readBody(req)) || '{}');
				return json(201, { ...meta, client_id: 'stub-client-id' });
			}
			if (url.pathname === '/token' && req.method === 'POST') {
				const form = new URLSearchParams(await readBody(req));
				state.tokenRequests.push(Object.fromEntries(form));
				if (form.get('grant_type') === 'authorization_code' && form.get('code') === 'good-code') {
					return json(200, { access_token: 'at-1', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-1' });
				}
				if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'rt-1') {
					return json(200, { access_token: 'at-2', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-1' });
				}
				return json(400, { error: 'invalid_grant' });
			}
		}

		if (url.pathname !== '/mcp') return json(404, { error: 'not found' });

		const auth = req.headers.authorization || '';
		const token = auth.replace(/^Bearer /, '');
		const ok = opts.oauth ? state.accepted.has(token) : !state.requireBearer || token === state.requireBearer;
		if (!ok) {
			const challenge = opts.oauth ? `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` : 'Bearer';
			return json(401, { error: 'unauthorized' }, { 'www-authenticate': challenge });
		}
		if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

		const mcp = new Server({ name: 'stub-notes', version: '1.0.0' }, { capabilities: { tools: {} } });
		mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: state.tools }));
		mcp.setRequestHandler(CallToolRequestSchema, async (r) => {
			state.calls.push({ name: r.params.name, arguments: r.params.arguments || {}, authorization: auth });
			return { content: [{ type: 'text', text: state.reply(r.params.name, r.params.arguments || {}) }] };
		});
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
		res.on('close', () => {
			transport.close();
			mcp.close();
		});
		await mcp.connect(transport);
		await transport.handleRequest(req, res, JSON.parse((await readBody(req)) || '{}'));
	};

	const server = http.createServer((req, res) => {
		handler(req, res).catch((err) => {
			if (!res.headersSent) res.writeHead(500);
			res.end(String(err?.message || err));
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
	return { url: `${base}/mcp`, base, state, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

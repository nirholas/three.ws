// The connector probe's verdicts, pinned so a change to it cannot quietly
// start passing a server a cloud MCP client would fail on.
import { describe, it, expect } from 'vitest';
import {
	authExpectations,
	serverUrlFor,
	parseWwwAuthenticate,
	parseRpcBody,
	judgeGetStream,
	judgeServer,
	summarizeError,
} from '../scripts/mcp-client-probe.mjs';

describe('authExpectations', () => {
	it('reads the free-text auth field of /.well-known/mcp.json', () => {
		expect(authExpectations('none')).toEqual({ anonymous: true, oauth: false, apiKey: false });
		expect(authExpectations('OAuth 2.1 (end-user), API key (server-to-server), or x402 pay-per-call')).toEqual({
			anonymous: false,
			oauth: true,
			apiKey: true,
		});
		expect(authExpectations('none for the read-only tools; API key or x402 for pumpfun_upload_metadata').anonymous).toBe(true);
		expect(authExpectations('x402 pay-per-call (authenticated three.ws principals call without per-call payment)').apiKey).toBe(true);
	});
});

describe('serverUrlFor', () => {
	it('moves a published endpoint onto another origin', () => {
		expect(serverUrlFor('https://three.ws/api/mcp-3d', 'http://localhost:3000')).toBe('http://localhost:3000/api/mcp-3d');
	});
});

describe('parseWwwAuthenticate', () => {
	it('parses a quoted Bearer challenge', () => {
		const c = parseWwwAuthenticate(
			'Bearer resource_metadata="https://three.ws/.well-known/oauth-protected-resource/api/mcp-3d", resource="https://three.ws/api/mcp-3d"',
		);
		expect(c.scheme).toBe('Bearer');
		expect(c.params.resource_metadata).toBe('https://three.ws/.well-known/oauth-protected-resource/api/mcp-3d');
		expect(c.params.resource).toBe('https://three.ws/api/mcp-3d');
	});

	it('returns null for no header', () => {
		expect(parseWwwAuthenticate(null)).toBeNull();
	});
});

describe('parseRpcBody', () => {
	it('reads a JSON-RPC result from an SSE body', () => {
		const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}\n\n';
		expect(parseRpcBody(body, 'text/event-stream').result.protocolVersion).toBe('2025-06-18');
	});
});

describe('judgeGetStream', () => {
	it('accepts a stream, a 405 with Allow, or an auth challenge', () => {
		expect(judgeGetStream({ status: 200, contentType: 'text/event-stream' })).toBeNull();
		expect(judgeGetStream({ status: 405, contentType: '', allow: 'POST, OPTIONS' })).toBeNull();
		expect(judgeGetStream({ status: 401, contentType: '', wwwAuthenticate: 'Bearer resource_metadata="x"' })).toBeNull();
	});

	it('fails a 405 without Allow and anything else', () => {
		expect(judgeGetStream({ status: 405, contentType: '', allow: null })).toMatch(/Allow/);
		expect(judgeGetStream({ status: 404, contentType: 'text/html' })).toMatch(/404/);
	});
});

describe('judgeServer', () => {
	const base = { http: { initialize: { contentType: 'application/json' }, getStreamProblem: null, negotiation: [] } };

	it('passes an open server that connects and lists tools', () => {
		const r = { ...base, expects: { anonymous: true }, modes: { anonymous: { ok: true, tools: 14 }, apiKey: { skipped: 'x' } } };
		expect(judgeServer(r)).toEqual([]);
	});

	it('fails a protected server whose OAuth metadata the SDK would refuse', () => {
		const r = {
			...base,
			expects: { anonymous: false, oauth: true },
			modes: {
				anonymous: { ok: false, authRequired: true },
				oauth: { failures: ['protected resource https://three.ws/api/mcp does not cover https://three.ws/api/mcp-3d'] },
				apiKey: { skipped: 'x' },
			},
		};
		expect(judgeServer(r)).toHaveLength(1);
	});

	it('fails a protected server that serves an anonymous MCP client', () => {
		const r = { ...base, expects: { anonymous: false, oauth: true }, modes: { anonymous: { ok: true, tools: 3 }, oauth: { failures: [] }, apiKey: { skipped: 'x' } } };
		expect(judgeServer(r)[0]).toMatch(/requires auth/);
	});

	it('fails a negotiated version no SDK client supports', () => {
		const r = {
			...base,
			http: { ...base.http, negotiation: [{ requested: '2025-06-18', negotiated: '1999-01-01', clientSupportsAnswer: false }] },
			expects: { anonymous: true },
			modes: { anonymous: { ok: true, tools: 1 }, apiKey: { skipped: 'x' } },
		};
		expect(judgeServer(r)[0]).toMatch(/1999-01-01/);
	});
});

describe('summarizeError', () => {
	it('keeps the SDK prefix and the error fields of a JSON body, not the whole 402 envelope', () => {
		const body = {
			x402Version: 2,
			error: 'X-PAYMENT header is required',
			resource: { url: 'https://three.ws/api/mcp-3d', description: 'x'.repeat(2000) },
			accepts: [{ scheme: 'exact' }, { scheme: 'exact' }],
			extensions: { bazaar: { discoverable: true } },
		};
		const out = summarizeError(`Streamable HTTP error: Error POSTing to endpoint: ${JSON.stringify(body)}`);
		expect(out).toBe(
			'Streamable HTTP error: Error POSTing to endpoint: {x402Version=2, error="X-PAYMENT header is required", accepts=2}',
		);
	});

	it('carries an OAuth-style error description through', () => {
		const out = summarizeError(
			'Streamable HTTP error: Error POSTing to endpoint: {"error":"service_unavailable","error_description":"database temporarily unavailable, retry shortly","ref":"48946bcef07d256a"}',
		);
		expect(out).toContain('error="service_unavailable"');
		expect(out).toContain('error_description="database temporarily unavailable, retry shortly"');
		expect(out).not.toContain('48946bcef07d256a');
	});

	it('cuts a plain message at the limit', () => {
		expect(summarizeError('fetch failed')).toBe('fetch failed');
		expect(summarizeError('a'.repeat(500)).length).toBe(400);
		expect(summarizeError('SSE error: Non-200 status code (405) {not json')).toBe('SSE error: Non-200 status code (405) {not json');
	});
});

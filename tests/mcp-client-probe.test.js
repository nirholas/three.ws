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

	describe('a server that is open and upgrades on sign-in', () => {
		const upgradeable = (modes) => ({
			...base,
			expects: { anonymous: true, oauth: true, apiKey: true },
			signIn: 'http://localhost:3000/api/mcp-grok?auth=oauth',
			modes,
		});

		it('passes when the sign-in URL challenges correctly and a key adds tools', () => {
			const r = upgradeable({ anonymous: { ok: true, tools: 18 }, oauth: { failures: [] }, apiKey: { ok: true, tools: 34 } });
			expect(judgeServer(r)).toEqual([]);
		});

		it('fails when signing in adds no tools', () => {
			const r = upgradeable({ anonymous: { ok: true, tools: 18 }, oauth: { failures: [] }, apiKey: { ok: true, tools: 18 } });
			expect(judgeServer(r)[0]).toMatch(/no more than the 18/);
		});

		it('fails when the sign-in URL does not start OAuth', () => {
			const r = upgradeable({
				anonymous: { ok: true, tools: 18 },
				oauth: { failures: ['unauthenticated initialize answered 200, an OAuth client needs 401 to start sign-in'] },
				apiKey: { skipped: 'x' },
			});
			expect(judgeServer(r)[0]).toMatch(/^sign-in URL: unauthenticated initialize answered 200/);
		});
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

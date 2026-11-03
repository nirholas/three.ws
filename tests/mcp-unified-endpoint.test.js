/**
 * The unified MCP endpoint (api/mcp/all.js, served at /mcp and /api/mcp/all):
 * what an anonymous client sees, how a gated tool refuses, how a paid tool
 * challenges, and that tools/list agrees with the published count.
 */
import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.X402_PAY_TO_BASE ||= '0x0000000000000000000000000000000000000001';
process.env.X402_ASSET_ADDRESS_BASE ||= '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

vi.mock('../api/_lib/auth.js', () => ({
	extractBearer: () => null,
	authenticateBearer: vi.fn(async () => null),
	hasScope: () => true,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		mcpIp: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		mcpUser: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
	},
	clientIp: vi.fn(() => '203.0.113.12'),
}));
vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { default: handler } = await import('../api/mcp/all.js');
const { dispatch, unified } = await import('../api/_mcpall/server.js');

const catalog = JSON.parse(readFileSync(new URL('../public/tools.json', import.meta.url), 'utf8'));

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) {
			this.headers[String(name).toLowerCase()] = value;
		},
		end(body) {
			this.body = body ?? null;
		},
	};
}

function makeReq({ headers = {}, body = null, url = '/mcp' } = {}) {
	const payload = body == null ? '' : JSON.stringify(body);
	const req = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []);
	req.method = 'POST';
	req.url = url;
	req.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.12', ...headers };
	return req;
}

const call = (name, args = {}, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const anon = { userId: null, rateKey: null, scope: '', source: 'free' };
const signedIn = { userId: 'u1', rateKey: null, scope: '', source: 'oauth' };
const bare = (extra = {}) => ({ headers: {}, url: '/mcp', ...extra });

describe('tools/list', () => {
	it('shows an anonymous caller only the public set, which includes the overview', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, anon, bare());
		const names = r.result.tools.map((t) => t.name);
		const { registry } = unified();
		expect(names.length).toBeGreaterThan(0);
		expect(names).toContain('utility_getting_started');
		for (const n of names) expect(registry.byName.get(n).isPublic, n).toBe(true);
		expect(names.length).toBeLessThan(registry.tools.length);
	});

	it('lists read and write tools by default and holds financial ones back', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, signedIn, bare());
		const { registry } = unified();
		const names = new Set(r.result.tools.map((t) => t.name));
		const financial = registry.tools.filter((t) => t.tier === 'financial');
		expect(financial.length).toBeGreaterThan(0);
		for (const t of financial) expect(names.has(t.name), t.name).toBe(false);
		expect(r.result.tools.length).toBe(catalog.unified.default_tool_count);
	});

	it('lists exactly the published count with every group enabled', async () => {
		const groups = catalog.unified.groups.map((g) => g.id).join(',');
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, signedIn, bare({ headers: { 'x-three-tools': groups } }));
		expect(r.result.tools.length).toBe(catalog.unified.tool_count);
		expect(r.result.tools.length).toBe(unified().registry.tools.length);
	});

	it('serves every listed tool a schema and a unique valid name', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, signedIn, bare());
		expect(new Set(r.result.tools.map((t) => t.name)).size).toBe(r.result.tools.length);
		for (const t of r.result.tools) expect(t.inputSchema?.type, t.name).toBe('object');
	});
});

describe('tools/call', () => {
	it('answers the free overview to an anonymous caller', async () => {
		const r = await dispatch(call('utility_getting_started'), anon, bare());
		expect(r.result.isError).toBeUndefined();
		expect(r.result.content[0].text).toContain('Getting Started');
		expect(r.result.structuredContent.tools.length).toBe(unified().registry.tools.length);
	});

	it('resolves a legacy name that names exactly one tool', async () => {
		const r = await dispatch(call('getting_started'), anon, bare());
		expect(r.result.content[0].text).toContain('Getting Started');
	});

	it('refuses a gated tool with no key as an MCP error result, not a crash', async () => {
		const gated = unified().registry.tools.find((t) => !t.isPublic && t.tier === 'read');
		const r = await dispatch(call(gated.name), anon, bare());
		expect(r.error).toBeUndefined();
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.reason).toBe('auth_required');
		expect(r.result.content[0].text).toContain('three.ws account');
	});

	it('refuses an unknown tool with an invalid-params error', async () => {
		const r = await dispatch(call('no_such_tool'), anon, bare());
		expect(r.error.code).toBe(-32602);
	});

	it('does not run a financial tool that is not enabled', async () => {
		const fin = unified().registry.tools.find((t) => t.tier === 'financial');
		const r = await dispatch(call(fin.name), signedIn, bare());
		expect(r.result.isError).toBe(true);
	});
});

describe('POST /mcp transport', () => {
	it('answers an anonymous discovery handshake', async () => {
		const res = makeRes();
		await handler(makeReq({ body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }), res);
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body).result.tools.length).toBeGreaterThan(0);
	});

	it('serves the free overview with no key', async () => {
		const res = makeRes();
		await handler(makeReq({ body: call('utility_getting_started') }), res);
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body).result.content[0].text).toContain('Getting Started');
	});

	it('answers a paid tool with no payment as a 402 naming the unified resource', async () => {
		const paid = unified().registry.tools.find((t) => !t.isPublic && t.price({}));
		expect(paid, 'at least one priced tool').toBeTruthy();
		const res = makeRes();
		await handler(makeReq({ body: call(paid.name) }), res);
		expect(res.statusCode).toBe(402);
		const challenge = JSON.parse(res.body);
		expect(challenge.accepts.length).toBeGreaterThan(0);
		expect(challenge.accepts[0].maxAmountRequired ?? challenge.accepts[0].amount).toBe(paid.price({}));
		for (const a of challenge.accepts) expect(a.resource).toBe('https://three.ws/mcp');
	});

	it('rejects a batch over the cap', async () => {
		const res = makeRes();
		await handler(makeReq({ body: Array.from({ length: 33 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })) }), res);
		expect(JSON.parse(res.body).error.code).toBe(-32600);
	});
});

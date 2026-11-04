// POST /api/v1/tools/{tool} and GET /api/v1/tools: auth, the 401 that points at
// the x402 twins, the public price list, and a billed call through the route.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

process.env.JWT_SECRET = 'test-secret-for-tool-gateway-route-0123456789';

const state = vi.hoisted(() => ({ session: null, debits: [] }));

vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/auth.js', async (orig) => {
	const actual = await orig();
	return {
		...actual,
		getSessionUser: vi.fn(async () => state.session),
		authenticateBearer: vi.fn(async () => null),
		extractBearer: () => null,
	};
});
vi.mock('../api/_lib/rate-limit.js', () => {
	const ok = async () => ({ success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 });
	return { limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});
vi.mock('../api/_lib/dev-plans/quota.js', () => ({ devPlanGate: vi.fn(async () => ({ ok: true, release() {} })) }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn(), logger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock('../api/_lib/inference-billing.js', () => ({ assertInferenceAllowed: vi.fn(async () => {}) }));
vi.mock('../api/_lib/credits.js', () => ({
	debitCredits: vi.fn(async (o) => {
		state.debits.push(o);
		return { replay: false, balanceUsd: 0.5 };
	}),
	refundCredits: vi.fn(async () => ({ balanceUsd: 0.5 })),
	getCreditAccount: vi.fn(async () => ({ balanceUsd: 0.5 })),
}));

function mkReq(method, url, body) {
	const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
	req.method = method;
	req.url = url;
	req.query = {};
	req.headers = { host: 'three.ws', 'content-type': 'application/json' };
	req.socket = { remoteAddress: '127.0.0.1' };
	return req;
}
function mkRes() {
	return {
		statusCode: 200, headers: {}, body: '', headersSent: false, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(c) { if (c !== undefined) this.body += c; this.writableEnded = true; this.headersSent = true; },
	};
}
async function run(file, method, url, body) {
	const { default: handler } = await import(file);
	const res = mkRes();
	await handler(mkReq(method, url, body), res);
	return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null };
}

describe('POST /api/v1/tools/[tool]', () => {
	beforeEach(() => {
		state.session = null;
		state.debits = [];
	});

	it('401s an anonymous call and names the x402 twin for speech, transcription and images', async () => {
		const r = await run('../api/v1/tools/[tool].js', 'POST', '/api/v1/tools/tts', { text: 'hello' });
		expect(r.status).toBe(401);
		expect(r.body.error).toBe('unauthorized');
		expect(r.body.error_description).toContain('/api/v1/ai/tts');
		expect(state.debits).toHaveLength(0);
	});

	it('404s an unknown tool', async () => {
		state.session = { id: 'u1' };
		const r = await run('../api/v1/tools/[tool].js', 'POST', '/api/v1/tools/nope', {});
		expect(r.status).toBe(404);
		expect(r.body.error).toBe('unknown_tool');
	});

	it('runs and bills a tool for a signed-in account', async () => {
		state.session = { id: 'u1' };
		const csv = Buffer.from('a,b\n1,2\n').toString('base64');
		const r = await run('../api/v1/tools/[tool].js', 'POST', '/api/v1/tools/parse_document', { document: csv, filename: 'x.csv' });
		expect(r.status).toBe(200);
		expect(r.body.data.result.format).toBe('csv');
		expect(r.body.data.billing).toMatchObject({ tool: 'parse_document', unit: 'page' });
		expect(state.debits[0]).toMatchObject({ userId: 'u1', action: 'gateway.parse_document' });
	});

	it('returns the tool error with its status, not a 500, when the input is bad', async () => {
		state.session = { id: 'u1' };
		const r = await run('../api/v1/tools/[tool].js', 'POST', '/api/v1/tools/web_fetch', { url: 'ftp://x' });
		expect(r.status).toBe(400);
		expect(r.body.error).toBe('bad_request');
	});
});

describe('GET /api/v1/tools', () => {
	it('lists every tool with price and input schema, publicly', async () => {
		const r = await run('../api/v1/tools/index.js', 'GET', '/api/v1/tools');
		expect(r.status).toBe(200);
		const tools = r.body.data.tools;
		expect(tools.map((t) => t.tool)).toContain('web_search');
		for (const t of tools) {
			expect(t.usd_per_unit).toBeGreaterThan(0);
			expect(t.input.type).toBe('object');
		}
		expect(r.headers['cache-control']).toContain('public');
	});
});

// The Grok surface (/api/mcp-grok). Grok Bot and the xAI Responses API call MCP
// from xAI's cloud: no published tool-call timeout, no inline widget, and one
// shared egress pool for every Grok user. These tests pin the three answers to
// that: every call is bounded and hands back a pending job instead of hanging,
// the model is told to collect it and share links, and the generation caps key
// on the Mcp-Session-Id this surface issues rather than on xAI's IP.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, generate: vi.fn(), rig: vi.fn(), directPrompt: vi.fn(async () => null) };
});

const limitCalls = [];
vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const real = await importOriginal();
	const pass = (name) => async (key) => {
		limitCalls.push([name, key]);
		return { success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 };
	};
	return {
		...real,
		limits: {
			...real.limits,
			studioIp: pass('ip'),
			studioGenBurst: pass('burst'),
			studioGenHourly: pass('hourly'),
			studioGenPoolHourly: pass('pool'),
			studioGenerateGlobal: pass('global'),
		},
	};
});

import { generate } from '../api/_mcp-studio/gpt-forge-client.js';
import { dispatch, toolCatalogFor, GROK_CALL_BUDGET_MS } from '../api/_mcp-studio/dispatch.js';
import { callerSubject, grokSession } from '../api/_mcp-studio/handler.js';
import grokHandler from '../api/mcp-grok.js';

const req = { headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } };
const auth = { userId: null, rateKey: '127.0.0.1', scope: '' };
const SID = 'grk_0f8e2c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

function callMsg(name, args) {
	return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
}

// A minimal node-style req/res pair for driving the real HTTP handler.
function httpPair(body, headers = {}) {
	const payload = Buffer.from(JSON.stringify(body));
	const req = {
		method: 'POST',
		url: '/api/mcp-grok',
		headers: { host: 'three.ws', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
		socket: { remoteAddress: '203.0.113.9' },
		async *[Symbol.asyncIterator]() {
			yield payload;
		},
		on(event, cb) {
			if (event === 'data') cb(payload);
			if (event === 'end') cb();
			return this;
		},
	};
	const out = { headers: {}, body: '' };
	const res = {
		statusCode: 200,
		headersSent: false,
		setHeader(k, v) {
			out.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return out.headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete out.headers[k.toLowerCase()];
		},
		end(chunk) {
			if (chunk) out.body += chunk;
			this.headersSent = true;
		},
		write(chunk) {
			out.body += chunk;
		},
	};
	return { req, res, out };
}

afterEach(() => {
	vi.mocked(generate).mockReset();
	limitCalls.length = 0;
});

describe('grok surface catalog', () => {
	it('offers every tool the full studio surface offers, persona tools included', () => {
		const names = (s) => toolCatalogFor(s).map((t) => t.name).sort();
		expect(names('grok')).toEqual(names('full'));
		expect(names('grok')).toContain('create_agent_persona');
		expect(names('grok')).toContain('check_job');
		expect(names('grok')).toContain('get_job');
	});

	it('tells Grok to share links and collect pending jobs on initialize', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, auth, req, { surface: 'grok' });
		const text = r.result.instructions;
		expect(text).toContain('viewerUrl');
		expect(text).toContain('get_job(job_id)');
		expect(text).toContain('idempotency_key');
		expect(text).toContain('embed_url');
	});
});

describe('grok call budget', () => {
	it('bounds each generation with a deadline inside the budget', async () => {
		vi.mocked(generate).mockResolvedValue({ status: 'done', glb_url: 'https://three.ws/cdn/a.glb' });
		const before = Date.now();
		await dispatch(callMsg('forge_free', { prompt: 'a reusable rocket booster' }), auth, req, { surface: 'grok' });
		const opts = vi.mocked(generate).mock.calls[0][2];
		expect(opts.deadline).toBeGreaterThan(before);
		expect(opts.deadline).toBeLessThanOrEqual(Date.now() + GROK_CALL_BUDGET_MS);
	});

	it('returns a pending job with a get_job hint when the render outlives the budget', async () => {
		vi.mocked(generate).mockResolvedValue({ _timedOut: true, job_id: 'job-abc123', status: 'running' });
		const r = await dispatch(callMsg('forge_free', { prompt: 'a reusable rocket booster' }), auth, req, { surface: 'grok' });
		expect(r.result.structuredContent.status).toBe('pending');
		expect(r.result.structuredContent.jobId).toBe('job-abc123');
		expect(r.result.content[0].text).toContain('call the get_job tool');
		expect(r.result.structuredContent).toMatchObject({ job_id: 'job-abc123', phase: 'running' });
	});
});

describe('grok per-session generation limits', () => {
	it('reads a well-formed session id and rejects anything else', () => {
		expect(grokSession({ headers: { 'mcp-session-id': SID } })).toBe(SID);
		expect(grokSession({ headers: { 'mcp-session-id': 'grk_not-a-uuid' } })).toBeNull();
		expect(grokSession({ headers: { 'mcp-session-id': 'oai:spoof' } })).toBeNull();
		expect(grokSession({ headers: {} })).toBeNull();
	});

	it('keys only shared-egress surfaces on a subject, and the full surface stays per IP', () => {
		const grokReq = { headers: { 'mcp-session-id': SID } };
		expect(callerSubject('grok', callMsg('forge_free', {}), grokReq)).toBe(SID);
		expect(callerSubject('full', callMsg('forge_free', {}), grokReq)).toBeNull();
		const oai = { ...callMsg('forge_free', {}), params: { name: 'forge_free', arguments: {}, _meta: { 'openai/subject': 'v1/abcDEF123456' } } };
		expect(callerSubject('chatgpt', oai, req)).toBe('oai:v1/abcDEF123456');
	});

	it('issues a session id on initialize and exposes it to browser clients', async () => {
		const { req: r, res, out } = httpPair({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
		await grokHandler(r, res);
		expect(out.headers['mcp-session-id']).toMatch(/^grk_[0-9a-f-]{36}$/);
		expect(out.headers['access-control-expose-headers']).toContain('mcp-session-id');
		expect(JSON.parse(out.body).result.serverInfo.name).toBe('three-ws-3d-studio-free');
	});

	it('charges a generation to the session, behind the per-IP pool cap', async () => {
		vi.mocked(generate).mockResolvedValue({ status: 'done', glb_url: 'https://three.ws/cdn/a.glb' });
		const { req: r, res } = httpPair(callMsg('forge_free', { prompt: 'a lunar lander' }), { 'mcp-session-id': SID });
		await grokHandler(r, res);
		const byName = Object.fromEntries(limitCalls.map(([n, k]) => [n, k]));
		expect(byName.pool).toBeDefined();
		expect(byName.burst).toBe(SID);
		expect(byName.hourly).toBe(SID);
	});

	it('falls back to per-IP caps when the client never echoes a session', async () => {
		vi.mocked(generate).mockResolvedValue({ status: 'done', glb_url: 'https://three.ws/cdn/a.glb' });
		const { req: r, res } = httpPair(callMsg('forge_free', { prompt: 'a lunar lander' }));
		await grokHandler(r, res);
		const byName = Object.fromEntries(limitCalls.map(([n, k]) => [n, k]));
		expect(byName.pool).toBeUndefined();
		expect(byName.burst).not.toBe(SID);
	});
});

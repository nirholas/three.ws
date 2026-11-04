// /api/sandbox/* owner routes and the runner bridge endpoint through the real
// handlers, with the store and workspace stubbed at their module boundary.
// Covers auth, the second-account 404, path safety, attachment-only downloads,
// host-allowlist validation and the bridge's bearer check.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({
	user: { id: 'u1' },
	runs: { run_aaaaaaaaaaaa: { run_id: 'run_aaaaaaaaaaaa', user_id: 'u1', status: 'active', cost_usd: '0.5', wall_ms: '1200' } },
	files: { 'out/a.txt': Buffer.from('hello') },
	saved: null,
	killed: null,
}));
vi.mock('../../api/_lib/db.js', () => ({ sql: vi.fn(), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../../api/_lib/env.js', () => ({ env: { APP_ORIGIN: 'http://localhost:3000', ISSUER: 'http://t', MCP_RESOURCE: 'http://t' } }));
vi.mock('../../api/_lib/auth.js', () => ({ getSessionUser: async () => s.user }));
vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../../api/_lib/sandbox/store.js', () => ({
	SandboxError: class SandboxError extends Error {},
	getSandboxRun: async (id) => s.runs[id] || null,
	listSandboxRuns: async () => Object.values(s.runs),
	listExecutions: async () => [{ seq: 1, cost_usd: '0.1', charged_usd: '0.2' }],
	killSandboxRun: async (id, reason) => ((s.killed = { id, reason }), { ...s.runs[id], status: 'killed' }),
	getSandboxSettings: async () => ({ default_backend: 'cloudrun', allow_hosts: ['a.example.com'] }),
	saveSandboxSettings: async (_u, patch) => ((s.saved = patch), { default_backend: 'cloudrun', allow_hosts: patch.allow_hosts || [] }),
	getUserPlan: async () => 'free',
}));
vi.mock('../../api/_lib/sandbox/workspace.js', () => ({
	RUN_ID_RE: /^run_[a-z0-9]{12}$/,
	workspaceStore: () => ({
		list: async () => Object.keys(s.files).map((path) => ({ path, size: s.files[path].length })),
		read: async (_r, p) => s.files[p] || null,
	}),
}));

const { default: api } = await import('../../api/sandbox/[action].js');
const { default: bridge } = await import('../../api/sandbox/bridge.js');

function mkReq(method, path, body, headers = {}) {
	const q = Object.fromEntries(new URL(path, 'http://x').searchParams);
	return {
		method,
		url: path,
		query: { action: path.split('?')[0].split('/')[3], ...q },
		headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
		on(event, cb) {
			if (event === 'data' && body !== undefined) queueMicrotask(() => { cb(Buffer.from(JSON.stringify(body))); this._end?.(); });
			else if (event === 'end') this._end = cb;
		},
		destroy() {},
	};
}
function mkRes() {
	return {
		statusCode: 200, headers: {}, body: undefined, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; this.writableEnded = true; },
	};
}
async function call(handler, method, path, body, headers) {
	const res = mkRes();
	await handler(mkReq(method, path, body, headers), res);
	let parsed;
	try { parsed = JSON.parse(String(res.body)); } catch { parsed = undefined; }
	return { res, status: res.statusCode, json: parsed };
}

beforeEach(() => { s.user = { id: 'u1' }; s.saved = null; s.killed = null; });

describe('/api/sandbox owner routes', () => {
	it('requires a session', async () => {
		s.user = null;
		expect((await call(api, 'GET', '/api/sandbox/overview')).status).toBe(401);
	});

	it('returns limits, backends, settings and runs', async () => {
		const { status, json } = await call(api, 'GET', '/api/sandbox/overview');
		expect(status).toBe(200);
		expect(json.limits.plan).toBe('free');
		expect(json.settings.allow_hosts).toEqual(['a.example.com']);
		expect(json.runs[0].wall_ms).toBe(1200);
	});

	it('answers 404 for another account\'s run', async () => {
		s.user = { id: 'u2' };
		expect((await call(api, 'GET', '/api/sandbox/run?run=run_aaaaaaaaaaaa')).status).toBe(404);
		expect((await call(api, 'GET', '/api/sandbox/file?run=run_aaaaaaaaaaaa&path=out/a.txt')).status).toBe(404);
		expect((await call(api, 'POST', '/api/sandbox/run?run=run_aaaaaaaaaaaa', { action: 'kill' })).status).toBe(404);
		expect(s.killed).toBeNull();
	});

	it('stops the owner\'s own run', async () => {
		const { status, json } = await call(api, 'POST', '/api/sandbox/run?run=run_aaaaaaaaaaaa', { action: 'kill', reason: 'enough' });
		expect(status).toBe(200);
		expect(json.run.status).toBe('killed');
		expect(s.killed.reason).toBe('enough');
	});

	it('serves files as non-renderable attachments', async () => {
		const { res, status } = await call(api, 'GET', '/api/sandbox/file?run=run_aaaaaaaaaaaa&path=out/a.txt');
		expect(status).toBe(200);
		expect(res.headers['content-disposition']).toMatch(/^attachment;/);
		expect(res.headers['x-content-type-options']).toBe('nosniff');
		expect(res.headers['content-type']).toBe('application/octet-stream');
		expect(Buffer.from(res.body).toString()).toBe('hello');
	});

	it('rejects path traversal and missing files', async () => {
		expect((await call(api, 'GET', '/api/sandbox/file?run=run_aaaaaaaaaaaa&path=../../etc/passwd')).status).toBe(400);
		expect((await call(api, 'GET', '/api/sandbox/file?run=run_aaaaaaaaaaaa&path=nope.txt')).status).toBe(404);
	});

	it('normalizes and validates the host allowlist', async () => {
		const ok = await call(api, 'PATCH', '/api/sandbox/settings', { allow_hosts: ['API.Example.com', '*.cdn.example.com', 'api.example.com'] });
		expect(ok.status).toBe(200);
		expect(s.saved.allow_hosts).toEqual(['api.example.com', '*.cdn.example.com']);
		const bad = await call(api, 'PATCH', '/api/sandbox/settings', { allow_hosts: ['http://evil.com/x'] });
		expect(bad.status).toBe(400);
		expect((await call(api, 'PATCH', '/api/sandbox/settings', {})).status).toBe(400);
	});
});

describe('/api/sandbox/bridge', () => {
	it('refuses a request without a valid execution token', async () => {
		expect((await call(bridge, 'POST', '/api/sandbox/bridge', { op: 'tool' })).status).toBe(401);
		expect((await call(bridge, 'POST', '/api/sandbox/bridge', { op: 'tool' }, { authorization: 'Bearer forged' })).status).toBe(401);
	});
	it('only accepts POST', async () => {
		expect((await call(bridge, 'GET', '/api/sandbox/bridge')).status).toBe(405);
	});
});

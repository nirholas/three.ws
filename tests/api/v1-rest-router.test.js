// api/v1/rest.js: the shared contract every v1 route inherits from defineRouter
// (api/_lib/agents-v1/http.js). Auth, scope checks, 404/405, the envelope and
// Idempotency-Key replay run for real; only the database, the session/bearer
// lookup, the rate limiter and the cache are replaced at their boundary.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '../_helpers/monetization.js';

const sqlMock = vi.fn(async () => []);
vi.mock('../../api/_lib/db.js', () => ({ sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false }));

const getSessionUserMock = vi.fn(async () => null);
const authenticateBearerMock = vi.fn(async () => null);
vi.mock('../../api/_lib/auth.js', async (importOriginal) => ({
	...(await importOriginal()),
	getSessionUser: (...a) => getSessionUserMock(...a),
	authenticateBearer: (...a) => authenticateBearerMock(...a),
	extractBearer: (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null,
}));

const checkCsrfMock = vi.fn(async () => ({ ok: true }));
vi.mock('../../api/_lib/csrf.js', () => ({ checkCsrf: (...a) => checkCsrfMock(...a), requireCsrf: async () => true }));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	clientIp: () => '127.0.0.1',
	limits: new Proxy({}, { get: () => async () => ({ success: true, limit: 600, remaining: 599, reset: Date.now() + 60_000 }) }),
}));

const store = new Map();
vi.mock('../../api/_lib/cache.js', () => ({
	cacheGet: async (k) => store.get(k) ?? null,
	cacheSet: async (k, v) => void store.set(k, v),
	acquireLock: async (k) => (store.has(k) ? false : (store.set(k, 1), true)),
	releaseLock: async (k) => void store.delete(k),
}));
vi.mock('../../api/_lib/usage.js', () => ({ recordEvent: () => {} }));

const loadOwnedAgentMock = vi.fn();
vi.mock('../../api/_lib/agents-v1/agents.js', async (importOriginal) => ({
	...(await importOriginal()),
	loadOwnedAgent: (...a) => loadOwnedAgentMock(...a),
}));

const exportAgentMock = vi.fn();
vi.mock('../../api/_lib/agents-v1/agent-export.js', () => ({
	exportAgent: (...a) => exportAgentMock(...a),
	importAgent: vi.fn(),
}));

const createWebhookMock = vi.fn();
vi.mock('../../api/_lib/agents-v1/webhooks.js', async (importOriginal) => ({
	...(await importOriginal()),
	createWebhook: (...a) => createWebhookMock(...a),
}));

const { default: handler } = await import('../../api/v1/rest.js');

const USER = 'user-rest-1';
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keyAuth = { authorization: 'Bearer sk_test_key' };

function asKey(scope) {
	authenticateBearerMock.mockImplementation(async (token) =>
		token ? { userId: USER, source: 'api_key', scope, apiKeyId: 'key-1' } : null,
	);
}

beforeEach(() => {
	store.clear();
	sqlMock.mockReset().mockResolvedValue([]);
	getSessionUserMock.mockReset().mockResolvedValue(null);
	authenticateBearerMock.mockReset().mockResolvedValue(null);
	loadOwnedAgentMock.mockReset();
	exportAgentMock.mockReset();
	createWebhookMock.mockReset();
	checkCsrfMock.mockReset().mockResolvedValue({ ok: true });
});

describe('v1 router contract', () => {
	it('serves the public event catalog in the { data, meta } envelope without auth', async () => {
		const { status, body, res } = await invoke(handler, { url: '/api/v1/webhooks/events' });
		expect(status).toBe(200);
		expect(body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(res.headers['x-request-id']).toBe(body.meta.requestId);
		expect(Number.isNaN(Date.parse(body.meta.timestamp))).toBe(false);
		const runFinished = body.data.events.find((e) => e.type === 'run.finished');
		expect(runFinished).toMatchObject({ agentScoped: true });
		expect(authenticateBearerMock).not.toHaveBeenCalled();
	});

	it('answers 401 with the error envelope when no key or session is sent', async () => {
		const { status, body } = await invoke(handler, { url: '/api/v1/agents' });
		expect(status).toBe(401);
		expect(body.error.code).toBe('unauthorized');
		expect(body.meta.requestId).toBeTruthy();
	});

	it('answers 405 for a known path with the wrong method, 404 for an unknown path', async () => {
		asKey('agents:read agents:write');
		const wrong = await invoke(handler, { method: 'PUT', url: '/api/v1/agents', headers: keyAuth, body: {} });
		expect(wrong.status).toBe(405);
		expect(wrong.body.error.code).toBe('method_not_allowed');
		const missing = await invoke(handler, { url: '/api/v1/nothing-here', headers: keyAuth });
		expect(missing.status).toBe(404);
		expect(missing.body.error.code).toBe('not_found');
	});

	it('refuses a write to a key that only holds agents:read', async () => {
		asKey('agents:read');
		const { status, body } = await invoke(handler, {
			method: 'POST',
			url: '/api/v1/webhooks',
			headers: keyAuth,
			body: { url: 'https://example.com/hook' },
		});
		expect(status).toBe(403);
		expect(body.error).toMatchObject({ code: 'insufficient_scope', details: { required: 'agents:write' } });
		expect(createWebhookMock).not.toHaveBeenCalled();
	});

	it('404s a delivery id that is not a UUID before touching the database', async () => {
		asKey('agents:read');
		const { status, body } = await invoke(handler, { url: '/api/v1/webhooks/deliveries/not-a-uuid', headers: keyAuth });
		expect(status).toBe(404);
		expect(body.error.code).toBe('not_found');
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('requires a CSRF token on session writes but not on key writes', async () => {
		getSessionUserMock.mockResolvedValue({ id: USER });
		checkCsrfMock.mockResolvedValue({ ok: false, code: 'csrf_invalid', message: 'missing token' });
		const { status, body } = await invoke(handler, { method: 'POST', url: '/api/v1/webhooks', body: { url: 'https://example.com/hook' } });
		expect(status).toBe(403);
		expect(body.error.code).toBe('csrf_invalid');

		getSessionUserMock.mockResolvedValue(null);
		asKey('agents:write');
		createWebhookMock.mockResolvedValue({ id: 'wh-1', secret: 'whsec_x' });
		const ok = await invoke(handler, { method: 'POST', url: '/api/v1/webhooks', headers: keyAuth, body: { url: 'https://example.com/hook' } });
		expect(ok.status).toBe(201);
	});
});

describe('Idempotency-Key', () => {
	const send = (body, key = 'retry-1') =>
		invoke(handler, { method: 'POST', url: '/api/v1/webhooks', headers: { ...keyAuth, 'idempotency-key': key }, body });

	it('runs a write once and replays the stored response on retry', async () => {
		asKey('agents:write');
		createWebhookMock.mockResolvedValue({ id: 'wh-1', secret: 'whsec_once' });
		const first = await send({ url: 'https://example.com/hook' });
		const retry = await send({ url: 'https://example.com/hook' });
		expect(first.status).toBe(201);
		expect(retry.status).toBe(201);
		expect(retry.res.headers['idempotent-replayed']).toBe('true');
		expect(retry.body.data).toEqual(first.body.data);
		expect(createWebhookMock).toHaveBeenCalledTimes(1);
	});

	it('rejects the same key reused with a different body', async () => {
		asKey('agents:write');
		createWebhookMock.mockResolvedValue({ id: 'wh-1', secret: 'whsec_once' });
		await send({ url: 'https://example.com/hook' });
		const reused = await send({ url: 'https://example.com/other' });
		expect(reused.status).toBe(422);
		expect(reused.body.error.code).toBe('idempotency_key_reused');
		expect(createWebhookMock).toHaveBeenCalledTimes(1);
	});
});

describe('GET /agents/:id/export', () => {
	it('returns the portable document with a download filename', async () => {
		asKey('agents:read');
		loadOwnedAgentMock.mockResolvedValue({ id: AGENT, user_id: USER });
		exportAgentMock.mockResolvedValue({ format: 'three.ws/agent', version: 1, agent: { name: 'Scout' } });
		const { status, body, res } = await invoke(handler, { url: `/api/v1/agents/${AGENT}/export`, headers: keyAuth });
		expect(status).toBe(200);
		expect(body.data).toMatchObject({ format: 'three.ws/agent', version: 1 });
		expect(res.headers['content-disposition']).toBe(`inline; filename="agent-${AGENT}.json"`);
		expect(loadOwnedAgentMock).toHaveBeenCalledWith(AGENT, USER);
	});

	it('404s a non-UUID agent id', async () => {
		asKey('agents:read');
		const { status } = await invoke(handler, { url: '/api/v1/agents/scout/export', headers: keyAuth });
		expect(status).toBe(404);
		expect(loadOwnedAgentMock).not.toHaveBeenCalled();
	});
});

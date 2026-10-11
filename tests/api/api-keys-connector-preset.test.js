import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '../_helpers/monetization.js';

// POST /api/api-keys is the bearer-reachable mint route the CLI uses. The
// connector preset must stay a fixed, spend-free grant here exactly as it is on
// /api/keys, and a bearer may not mint beyond what it holds.

const authState = { session: null, bearer: null };
const sqlState = { queue: [], calls: [] };

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => authState.session),
	authenticateBearer: vi.fn(async () => authState.bearer),
	extractBearer: vi.fn(() => (authState.bearer ? 'token' : null)),
	hasScope: (granted, required) => {
		const g = new Set((granted || '').split(/\s+/).filter(Boolean));
		return required.split(/\s+/).every((s) => g.has(s));
	},
}));

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: strings.join('?'), values });
		return sqlState.queue.length ? sqlState.queue.shift() : [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 1000 })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));

const { default: handler } = await import('../../api/api-keys.js');

const ROW = { id: 'k1', name: 'Grok Bot', prefix: 'sk_live_abc', scope: 'read generate agents:write', preset: 'connector', expires_at: null, created_at: '2026-10-09T00:00:00Z' };
const FULL_BEARER = { userId: 'u1', scope: 'profile avatars:read avatars:write memory:read memory:write agents:read agents:write wallet:read' };

beforeEach(() => {
	authState.session = null;
	authState.bearer = { ...FULL_BEARER };
	sqlState.queue = [];
	sqlState.calls = [];
});

describe('POST /api/api-keys with the connector preset', () => {
	it('mints the fixed read, generate, agents:write grant and stores the preset', async () => {
		sqlState.queue.push([ROW]);
		const { status, body } = await invoke(handler, { method: 'POST', url: '/api/api-keys', body: { name: 'Grok Bot', preset: 'connector' } });
		expect(status).toBe(201);
		expect(body.data.token).toMatch(/^sk_live_/);
		expect(body.data.preset).toBe('connector');
		const { values } = sqlState.calls[0];
		expect(values).toContain('read generate agents:write');
		expect(values).toContain('connector');
		expect(values.join(' ')).not.toMatch(/wallet:write|services:write|spend/);
	});

	it('refuses a caller-supplied scope next to the preset', async () => {
		const { status } = await invoke(handler, { method: 'POST', url: '/api/api-keys', body: { name: 'x', preset: 'connector', scope: 'spend' } });
		expect(status).toBe(400);
		expect(sqlState.calls).toHaveLength(0);
	});

	it('403s a bearer that does not hold agents:write instead of escalating it', async () => {
		authState.bearer = { userId: 'u1', scope: 'profile avatars:read avatars:write memory:read memory:write agents:read wallet:read' };
		const { status, body } = await invoke(handler, { method: 'POST', url: '/api/api-keys', body: { name: 'x', preset: 'connector' } });
		expect(status).toBe(403);
		expect(body.error).toBe('insufficient_scope');
		expect(sqlState.calls).toHaveLength(0);
	});

	it('leaves a plain key mint unchanged (no preset stored)', async () => {
		sqlState.queue.push([{ ...ROW, preset: null, scope: 'avatars:read' }]);
		const { status } = await invoke(handler, { method: 'POST', url: '/api/api-keys', body: { name: 'plain', scope: 'avatars:read' } });
		expect(status).toBe(201);
		expect(sqlState.calls[0].values).toContain(null);
		expect(sqlState.calls[0].values).not.toContain('connector');
	});
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

// ── Mocks ─────────────────────────────────────────────────────────────────

const authState = {
	session: null,
	bearer: null,
};

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => authState.session),
	authenticateBearer: vi.fn(async () => authState.bearer),
	extractBearer: vi.fn(() => null),
	hasScope: vi.fn((scope, needed) => {
		if (!scope) return false;
		return scope.split(/\s+/).includes(needed);
	}),
}));

const sqlState = {
	queue: [],
	calls: [],
};

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: strings.join('?'), values });
		if (sqlState.queue.length === 0) return [];
		return sqlState.queue.shift();
	}),
}));

const rlState = { success: true };

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		authIp: vi.fn(async () => ({ success: rlState.success })),
	},
	clientIp: vi.fn(() => '127.0.0.1'),
}));

const { default: handler } = await import('../../api/api-keys.js');

// ── Helpers ───────────────────────────────────────────────────────────────

function makeReq({ method = 'GET', url = '/api/api-keys', headers = {}, body = null } = {}) {
	const base = body ? Readable.from([Buffer.from(JSON.stringify(body))]) : Readable.from([]);
	base.method = method;
	base.url = url;
	base.headers = {
		host: 'localhost',
		...(body ? { 'content-type': 'application/json' } : {}),
		...headers,
	};
	return base;
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		end(chunk) {
			if (chunk !== undefined) this.body += chunk;
			this.writableEnded = true;
		},
	};
}

async function invoke(reqOpts) {
	const req = makeReq(reqOpts);
	const res = makeRes();
	await handler(req, res);
	const payload = res.body ? JSON.parse(res.body) : null;
	return { res, status: res.statusCode, body: payload };
}

beforeEach(() => {
	authState.session = null;
	authState.bearer = null;
	sqlState.queue = [];
	sqlState.calls = [];
	rlState.success = true;
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/api-keys — list', () => {
	it('returns 401 when unauthenticated', async () => {
		const { status, body } = await invoke({ method: 'GET' });
		expect(status).toBe(401);
		expect(body.error).toBe('unauthorized');
	});

	it('does NOT return raw tokens (token_hash column not selected)', async () => {
		authState.session = { id: 'user-1' };
		sqlState.queue.push([
			{
				id: 'k1',
				name: 'My key',
				prefix: 'sk_live_abc123',
				scope: 'avatars:read avatars:write',
				last_used_at: null,
				expires_at: null,
				revoked_at: null,
				created_at: '2024-01-01T00:00:00Z',
			},
		]);

		const { status, body } = await invoke({ method: 'GET' });

		expect(status).toBe(200);
		expect(body.data).toHaveLength(1);
		expect(body.data[0].id).toBe('k1');
		// No raw `token` field, no token_hash
		expect(body.data[0].token).toBeUndefined();
		expect(body.data[0].token_hash).toBeUndefined();
		// Raw-token strings must never appear in the response
		const serialized = JSON.stringify(body);
		expect(serialized).not.toMatch(/sk_live_[a-f0-9]{32,}/);

		// Verify the SELECT doesn't include token_hash
		const selectCall = sqlState.calls[0];
		expect(selectCall.query).not.toMatch(/token_hash/);
	});
});

describe('POST /api/api-keys — create', () => {
	it('returns 401 when unauthenticated', async () => {
		const { status, body } = await invoke({
			method: 'POST',
			body: { name: 'New key' },
		});
		expect(status).toBe(401);
		expect(body.error).toBe('unauthorized');
	});

	it('returns the raw token exactly once on creation', async () => {
		authState.session = { id: 'user-2' };
		sqlState.queue.push([
			{
				id: 'k2',
				name: 'Publish',
				prefix: 'sk_live_xxxxxx',
				scope: 'avatars:read avatars:write',
				expires_at: null,
				created_at: '2024-01-01T00:00:00Z',
			},
		]);

		const { status, body } = await invoke({
			method: 'POST',
			body: { name: 'Publish' },
		});

		expect(status).toBe(201);
		expect(body.data.id).toBe('k2');
		expect(typeof body.data.token).toBe('string');
		expect(body.data.token).toMatch(/^sk_live_[A-Za-z0-9_-]+$/);
		expect(body.data.token.length).toBeGreaterThan(20);

		// The INSERT must persist a hash, never the raw token
		const insertCall = sqlState.calls.find((c) => /insert into api_keys/i.test(c.query));
		expect(insertCall).toBeTruthy();
		for (const v of insertCall.values) {
			expect(v).not.toBe(body.data.token);
		}
	});

	it('rejects unknown scopes with 400', async () => {
		authState.session = { id: 'user-3' };
		const { status, body } = await invoke({
			method: 'POST',
			body: { name: 'Bad', scope: 'avatars:read bogus:scope' },
		});
		expect(status).toBe(400);
		expect(body.error).toBe('validation_error');
	});
});

describe('method routing', () => {
	it('rejects PUT with 405', async () => {
		const { status, body } = await invoke({ method: 'PUT' });
		expect(status).toBe(405);
		expect(body.error).toBe('method_not_allowed');
	});

	it('short-circuits OPTIONS (CORS preflight) with 204', async () => {
		const { status } = await invoke({
			method: 'OPTIONS',
			headers: { origin: 'http://localhost:3000' },
		});
		expect(status).toBe(204);
	});
});

// Revoke lives at api/api-keys/[id].js — out of scope for this file's tests.
describe.todo('DELETE /api/api-keys/:id — revoke 200');
describe.todo('DELETE /api/api-keys/:id — 404 unknown id');

// Tests for POST /api/oauth/introspect (RFC 7662).
// Covers active JWT, expired/invalid JWT, and refresh token introspection.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

process.env.PUBLIC_APP_ORIGIN ||= 'https://app.test';
process.env.JWT_SECRET ||= 'test-introspect-secret-at-least-32ch';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const sqlState = { queue: [], calls: [] };

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: strings.join('?'), values });
		if (sqlState.queue.length === 0) return [];
		const next = sqlState.queue.shift();
		if (next instanceof Error) throw next;
		return next;
	}),
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		oauthToken: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '127.0.0.1',
}));

const authState = {
	verifyResult: null, // set to a payload object → returns it; null → throws
};

vi.mock('../../api/_lib/auth.js', () => ({
	verifyAccessToken: vi.fn(async () => {
		if (authState.verifyResult === null) throw new Error('invalid token');
		return authState.verifyResult;
	}),
	mintAccessToken: vi.fn(async ({ scope }) => `access.${scope}.jwt`),
	issueRefreshToken: vi.fn(async () => ({ token: 'rt', id: 'rt-id' })),
	rotateRefreshToken: vi.fn(async () => { throw Object.assign(new Error('invalid_grant'), { status: 400 }); }),
	revokeRefreshToken: vi.fn(async () => {}),
	getSessionUser: vi.fn(async () => null),
	csrfTokenFor: vi.fn(async () => null),
	verifyCsrfToken: vi.fn(async () => false),
	isSameSiteOrigin: vi.fn(() => false),
}));

vi.mock('../../api/_lib/crypto.js', () => ({
	randomToken: vi.fn(() => 'fixed-token'),
	sha256: vi.fn(async (s) => `hash:${s}`),
	sha256Base64Url: vi.fn(async () => 'PKCE_HASH'),
	constantTimeEquals: vi.fn(() => true),
}));

const { default: handler } = await import('../../api/oauth/[action].js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq({ formBody = {} } = {}) {
	const base = Readable.from([Buffer.from(new URLSearchParams(formBody).toString())]);
	base.method = 'POST';
	base.url = '/api/oauth/introspect';
	base.query = { action: 'introspect' };
	base.headers = {
		host: 'app.test',
		'content-type': 'application/x-www-form-urlencoded',
	};
	return base;
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(chunk) {
			if (chunk !== undefined) this.body += chunk;
			this.writableEnded = true;
		},
	};
}

async function invoke(opts) {
	const req = makeReq(opts);
	const res = makeRes();
	await handler(req, res);
	return { res, status: res.statusCode, body: JSON.parse(res.body) };
}

const PUBLIC_CLIENT = {
	client_id: 'mcp_pub',
	client_type: 'public',
	scope: 'avatars:read profile',
	grant_types: ['authorization_code', 'refresh_token'],
};

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

beforeEach(() => {
	sqlState.queue = [];
	sqlState.calls = [];
	authState.verifyResult = null;
});

// ── introspect ─────────────────────────────────────────────────────────────────

describe('POST /api/oauth/introspect', () => {
	it('returns 400 when token or client_id is missing', async () => {
		const { status, body } = await invoke({ formBody: { client_id: 'mcp_pub' } });
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_request');
	});

	it('returns { active: false } when client is unknown', async () => {
		sqlState.queue.push([]); // no client row
		const { status, body } = await invoke({
			formBody: { token: 'some.jwt.token', client_id: 'unknown_client' },
		});
		expect(status).toBe(200);
		expect(body.active).toBe(false);
	});

	it('returns { active: true } with claims for a valid JWT access token', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		authState.verifyResult = {
			sub: 'user-1',
			scope: 'avatars:read',
			client_id: 'mcp_pub',
			aud: 'https://app.test/api/mcp',
			iss: 'https://app.test',
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
		};

		const { status, body } = await invoke({
			formBody: { token: 'valid.jwt.token', client_id: 'mcp_pub' },
		});

		expect(status).toBe(200);
		expect(body.active).toBe(true);
		expect(body.sub).toBe('user-1');
		expect(body.scope).toBe('avatars:read');
		expect(body.client_id).toBe('mcp_pub');
		expect(body.token_type).toBe('Bearer');
	});

	it('returns { active: false } for an invalid/expired JWT (falls through to refresh token lookup which also misses)', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]); // client lookup
		// verifyAccessToken throws (authState.verifyResult = null)
		sqlState.queue.push([]); // no refresh token row
		const { status, body } = await invoke({
			formBody: { token: 'expired.or.invalid.jwt', client_id: 'mcp_pub' },
		});
		expect(status).toBe(200);
		expect(body.active).toBe(false);
	});

	it('returns { active: false } for a revoked refresh token', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		// verifyAccessToken throws → fall into refresh token path
		sqlState.queue.push([{
			user_id: 'user-1',
			scope: 'avatars:read',
			expires_at: FUTURE,
			revoked_at: PAST, // revoked
		}]);

		const { status, body } = await invoke({
			formBody: { token: 'opaque-refresh-token', client_id: 'mcp_pub' },
		});

		expect(status).toBe(200);
		expect(body.active).toBe(false);
	});

	it('returns { active: true } for a valid refresh token', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		// verifyAccessToken throws → fall into refresh token path
		sqlState.queue.push([{
			user_id: 'user-2',
			scope: 'avatars:read profile',
			expires_at: FUTURE,
			revoked_at: null,
		}]);

		const { status, body } = await invoke({
			formBody: { token: 'opaque-refresh-token', client_id: 'mcp_pub' },
		});

		expect(status).toBe(200);
		expect(body.active).toBe(true);
		expect(body.sub).toBe('user-2');
		expect(body.scope).toBe('avatars:read profile');
		expect(body.token_type).toBe('refresh_token');
	});

	it('returns { active: false } for a JWT from a different client', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		authState.verifyResult = {
			sub: 'user-1',
			scope: 'avatars:read',
			client_id: 'mcp_other', // mismatched client
			aud: 'https://app.test/api/mcp',
			iss: 'https://app.test',
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
		};

		const { status, body } = await invoke({
			formBody: { token: 'cross.client.jwt', client_id: 'mcp_pub' },
		});

		expect(status).toBe(200);
		expect(body.active).toBe(false);
	});

	it('returns { active: false } for an expired refresh token', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		sqlState.queue.push([{
			user_id: 'user-1',
			scope: 'avatars:read',
			expires_at: PAST, // expired
			revoked_at: null,
		}]);

		const { status, body } = await invoke({
			formBody: { token: 'expired-refresh-token', client_id: 'mcp_pub' },
		});

		expect(status).toBe(200);
		expect(body.active).toBe(false);
	});
});

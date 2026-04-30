// Tests for /api/oauth/token — OAuth 2.1 token endpoint.
// Focus: authorization_code grant + PKCE verification, refresh_token rotation
// with strict scope-narrowing, client authentication, and reuse detection.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

process.env.PUBLIC_APP_ORIGIN ||= 'https://app.test';
process.env.JWT_SECRET ||= 'test-secret-token-suite-only';

// ── Mocks ─────────────────────────────────────────────────────────────────

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

const rlState = { success: true };

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { oauthToken: vi.fn(async () => ({ success: rlState.success })) },
	clientIp: () => '127.0.0.1',
}));

const authState = {
	mintAccess: vi.fn(async ({ scope }) => `access.${scope.replaceAll(' ', '+')}.jwt`),
	issueRefresh: vi.fn(async ({ scope }) => ({
		token: `refresh.${scope.replaceAll(' ', '+')}`,
		id: 'rt-id',
	})),
	rotate: null,
};

vi.mock('../../api/_lib/auth.js', () => ({
	mintAccessToken: (...args) => authState.mintAccess(...args),
	issueRefreshToken: (...args) => authState.issueRefresh(...args),
	rotateRefreshToken: (...args) => authState.rotate(...args),
}));

const cryptoState = {
	// PKCE: handler computes sha256Base64Url(verifier) and compares against
	// the stored code_challenge. Tests can set what the mock returns.
	pkceComputed: 'EXPECTED_CHALLENGE',
	sha256: vi.fn(async (s) => `hash:${s}`),
	constTimeEqual: true,
};

vi.mock('../../api/_lib/crypto.js', () => ({
	sha256: (...args) => cryptoState.sha256(...args),
	sha256Base64Url: vi.fn(async () => cryptoState.pkceComputed),
	constantTimeEquals: vi.fn(() => cryptoState.constTimeEqual),
}));

const { default: handler } = await import('../../api/oauth/[action].js');

// ── Helpers ───────────────────────────────────────────────────────────────

function makeReq({ method = 'POST', headers = {}, formBody = {} } = {}) {
	const base = Readable.from([Buffer.from(new URLSearchParams(formBody).toString())]);
	base.method = method;
	base.url = '/api/oauth/token';
	base.headers = {
		host: 'app.test',
		'content-type': 'application/x-www-form-urlencoded',
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
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
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
	const json = res.body ? safeJson(res.body) : null;
	return { res, status: res.statusCode, body: json };
}

function safeJson(s) {
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
}

const PUBLIC_CLIENT = {
	client_id: 'mcp_pub',
	client_type: 'public',
	scope: 'avatars:read avatars:write profile offline_access',
	grant_types: ['authorization_code', 'refresh_token'],
};

const CONFIDENTIAL_CLIENT = {
	client_id: 'mcp_conf',
	client_type: 'confidential',
	client_secret_hash: 'hash:secret123',
	scope: 'avatars:read profile',
	grant_types: ['authorization_code', 'refresh_token'],
};

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

const AUTH_CODE_ROW = {
	code: 'auth-code-1',
	client_id: 'mcp_pub',
	user_id: 'user-1',
	redirect_uri: 'https://client.test/cb',
	scope: 'avatars:read profile',
	resource: 'https://app.test/api/mcp',
	code_challenge: 'EXPECTED_CHALLENGE',
	code_challenge_method: 'S256',
	expires_at: FUTURE,
	consumed_at: null,
};

beforeEach(() => {
	sqlState.queue = [];
	sqlState.calls = [];
	rlState.success = true;
	cryptoState.pkceComputed = 'EXPECTED_CHALLENGE';
	cryptoState.constTimeEqual = true;
	authState.mintAccess.mockClear();
	authState.issueRefresh.mockClear();
	authState.rotate = vi.fn();
});

// ── Method / preflight ────────────────────────────────────────────────────

describe('/api/oauth/token — method handling', () => {
	it('returns 405 for GET', async () => {
		const req = makeReq({ method: 'GET' });
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(405);
	});

	it('returns 204 for OPTIONS preflight', async () => {
		const req = makeReq({ method: 'OPTIONS' });
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(204);
	});
});

// ── Client identification + authentication ────────────────────────────────

describe('/api/oauth/token — client auth', () => {
	it('returns invalid_client when client_id missing', async () => {
		const { status, body } = await invoke({ formBody: { grant_type: 'authorization_code' } });
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_client');
	});

	it('rate-limits per client_id', async () => {
		rlState.success = false;
		const { status, body } = await invoke({
			formBody: { client_id: 'mcp_pub', grant_type: 'authorization_code' },
		});
		expect(status).toBe(429);
		expect(body.error).toBe('rate_limited');
	});

	it('returns invalid_client when client unknown in DB', async () => {
		sqlState.queue.push([]); // client lookup empty
		const { status, body } = await invoke({
			formBody: { client_id: 'mcp_unknown', grant_type: 'authorization_code' },
		});
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_client');
	});

	it('rejects confidential client with bad secret', async () => {
		sqlState.queue.push([CONFIDENTIAL_CLIENT]);
		cryptoState.constTimeEqual = false;
		const { status, body } = await invoke({
			formBody: {
				client_id: 'mcp_conf',
				client_secret: 'wrong',
				grant_type: 'authorization_code',
			},
		});
		expect(status).toBe(401);
		expect(body.error).toBe('invalid_client');
	});

	it('accepts confidential client secret via HTTP Basic auth header', async () => {
		sqlState.queue.push([CONFIDENTIAL_CLIENT]);
		cryptoState.constTimeEqual = true;
		// Then the unsupported_grant_type path so we don't have to fully wire auth_code.
		const basic = 'Basic ' + Buffer.from('mcp_conf:secret123').toString('base64');
		const { status, body } = await invoke({
			headers: { authorization: basic },
			formBody: { grant_type: 'unsupported_grant' },
		});
		expect(status).toBe(400);
		expect(body.error).toBe('unsupported_grant_type');
	});
});

// ── grant_type routing ────────────────────────────────────────────────────

describe('/api/oauth/token — grant_type routing', () => {
	it('rejects unknown grant_type', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		const { status, body } = await invoke({
			formBody: { client_id: 'mcp_pub', grant_type: 'password' },
		});
		expect(status).toBe(400);
		expect(body.error).toBe('unsupported_grant_type');
	});
});

// ── authorization_code grant ──────────────────────────────────────────────

describe('/api/oauth/token — authorization_code grant', () => {
	const baseForm = {
		client_id: 'mcp_pub',
		grant_type: 'authorization_code',
		code: 'auth-code-1',
		redirect_uri: 'https://client.test/cb',
		code_verifier: 'verifier-string',
	};

	it('rejects when required fields missing', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		const { code_verifier: _drop, ...withoutVerifier } = baseForm;
		const { status, body } = await invoke({ formBody: withoutVerifier });
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_request');
	});

	it('rejects unknown auth code', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		sqlState.queue.push([]); // no code row
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_grant');
		expect(body.error_description).toMatch(/unknown code/);
	});

	it('rejects already-consumed code AND revokes refresh tokens (replay defence)', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		sqlState.queue.push([{ ...AUTH_CODE_ROW, consumed_at: PAST }]);
		sqlState.queue.push([]); // revoke update
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_grant');
		const revoke = sqlState.calls.find((c) =>
			/update oauth_refresh_tokens set revoked_at/i.test(c.query),
		);
		expect(revoke).toBeTruthy();
	});

	it('rejects expired code', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		sqlState.queue.push([{ ...AUTH_CODE_ROW, expires_at: PAST }]);
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(400);
		expect(body.error_description).toMatch(/expired/);
	});

	it('rejects code issued to different client', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		sqlState.queue.push([{ ...AUTH_CODE_ROW, client_id: 'mcp_other' }]);
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(400);
		expect(body.error_description).toMatch(/client mismatch/);
	});

	it('rejects redirect_uri mismatch', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		sqlState.queue.push([AUTH_CODE_ROW]);
		const { status, body } = await invoke({
			formBody: { ...baseForm, redirect_uri: 'https://client.test/other' },
		});
		expect(status).toBe(400);
		expect(body.error_description).toMatch(/redirect_uri mismatch/);
	});

	it('rejects when PKCE verifier does not hash to stored challenge', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		sqlState.queue.push([AUTH_CODE_ROW]);
		cryptoState.pkceComputed = 'WRONG_HASH';
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(400);
		expect(body.error_description).toMatch(/PKCE verification failed/);
	});

	it('issues access + refresh on success and consumes the auth code', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]); // client
		sqlState.queue.push([AUTH_CODE_ROW]); // code lookup
		sqlState.queue.push([]); // mark code consumed
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(200);
		expect(body.token_type).toBe('Bearer');
		expect(body.expires_in).toBe(3600);
		expect(body.scope).toBe('avatars:read profile');
		expect(body.access_token).toContain('access.');
		expect(body.refresh_token).toContain('refresh.');
		// Code marked consumed.
		const consume = sqlState.calls.find((c) =>
			/update oauth_auth_codes set consumed_at/i.test(c.query),
		);
		expect(consume).toBeTruthy();
		// Access token minted with the code's scope and resource.
		expect(authState.mintAccess).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user-1',
				clientId: 'mcp_pub',
				scope: 'avatars:read profile',
			}),
		);
	});

	it('omits refresh_token when client lacks refresh_token grant', async () => {
		const noRefresh = { ...PUBLIC_CLIENT, grant_types: ['authorization_code'] };
		sqlState.queue.push([noRefresh]);
		sqlState.queue.push([AUTH_CODE_ROW]);
		sqlState.queue.push([]);
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(200);
		expect(body.refresh_token).toBeUndefined();
		expect(authState.issueRefresh).not.toHaveBeenCalled();
	});
});

// ── refresh_token grant ───────────────────────────────────────────────────

describe('/api/oauth/token — refresh_token grant', () => {
	const baseForm = {
		client_id: 'mcp_pub',
		grant_type: 'refresh_token',
		refresh_token: 'old-refresh-secret',
	};

	it('rejects missing refresh_token', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		const { status, body } = await invoke({
			formBody: { client_id: 'mcp_pub', grant_type: 'refresh_token' },
		});
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_request');
	});

	it('issues a new access+refresh on successful rotation (no scope narrowing)', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		authState.rotate = vi.fn(async ({ narrowScope }) => {
			// Caller did not pass scope → narrowScope("stored") returns stored unchanged.
			const eff = narrowScope('avatars:read profile');
			return {
				userId: 'user-1',
				scope: eff,
				resource: 'https://app.test/api/mcp',
				next: { token: 'rotated-refresh', id: 'rt-2' },
			};
		});
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(200);
		expect(body.scope).toBe('avatars:read profile');
		expect(body.refresh_token).toBe('rotated-refresh');
		expect(body.access_token).toContain('access.');
	});

	it('narrows scope when caller requests a strict subset', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		authState.rotate = vi.fn(async ({ narrowScope }) => {
			const eff = narrowScope('avatars:read profile');
			return {
				userId: 'user-1',
				scope: eff,
				resource: null,
				next: { token: 'narrowed-refresh', id: 'rt-3' },
			};
		});
		const { status, body } = await invoke({
			formBody: { ...baseForm, scope: 'avatars:read' },
		});
		expect(status).toBe(200);
		expect(body.scope).toBe('avatars:read');
	});

	it('rejects scope-widening attempt (requested scope not subset of stored)', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		// Simulate the handler calling narrowScope and the function throwing
		// invalid_scope, which the handler converts into the JSON error below.
		authState.rotate = vi.fn(async ({ narrowScope }) => {
			narrowScope('avatars:read profile'); // throws
		});
		const { status, body } = await invoke({
			formBody: { ...baseForm, scope: 'avatars:read avatars:delete' },
		});
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_scope');
		expect(body.error_description).toMatch(/exceeds granted scope/);
	});

	it('rejects empty scope subset (asks for nothing while sending scope param)', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		authState.rotate = vi.fn(async ({ narrowScope }) => {
			narrowScope('avatars:read profile'); // throws — '' is not a subset
		});
		const { status, body } = await invoke({
			formBody: { ...baseForm, scope: 'unknown:scope' },
		});
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_scope');
	});

	it('propagates invalid_grant from rotation (e.g. revoked / unknown token)', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		authState.rotate = vi.fn(async () => {
			throw Object.assign(new Error('invalid_grant'), { status: 400 });
		});
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_grant');
	});

	it('propagates refresh_reuse_detected (chain revoked) from rotation', async () => {
		sqlState.queue.push([PUBLIC_CLIENT]);
		authState.rotate = vi.fn(async () => {
			throw Object.assign(new Error('reuse'), {
				status: 400,
				code: 'refresh_reuse_detected',
			});
		});
		const { status, body } = await invoke({ formBody: baseForm });
		expect(status).toBe(400);
		expect(body.error).toBe('refresh_reuse_detected');
	});
});

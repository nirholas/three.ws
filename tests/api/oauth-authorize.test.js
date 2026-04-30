// Tests for /api/oauth/authorize — OAuth 2.1 authorization endpoint.
// Focus: PKCE enforcement, strict redirect_uri matching (§3.1.2.2),
// response_type validation, consent rendering and CSRF/Origin checks.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

// Provide the env vars the handler chain expects before importing modules.
process.env.PUBLIC_APP_ORIGIN ||= 'https://app.test';
process.env.JWT_SECRET ||= 'test-secret-for-csrf-and-jwt-only';

// ── Mocks ─────────────────────────────────────────────────────────────────

const authState = {
	session: null,
	csrf: 'csrf-token-fixed',
	csrfValid: true,
	sameSite: true,
};

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => authState.session),
	csrfTokenFor: vi.fn(async () => authState.csrf),
	verifyCsrfToken: vi.fn(
		async (_req, submitted) => authState.csrfValid && submitted === authState.csrf,
	),
	isSameSiteOrigin: vi.fn(() => authState.sameSite),
}));

const sqlState = { queue: [], calls: [] };

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: strings.join('?'), values });
		if (sqlState.queue.length === 0) return [];
		return sqlState.queue.shift();
	}),
}));

vi.mock('../../api/_lib/crypto.js', () => ({
	randomToken: vi.fn(() => 'fixed-code-1234567890abcdef'),
}));

const { default: handler } = await import('../../api/oauth/[action].js');

// ── Helpers ───────────────────────────────────────────────────────────────

function makeReq({ method = 'GET', url, headers = {}, formBody = null } = {}) {
	const base = formBody
		? Readable.from([Buffer.from(new URLSearchParams(formBody).toString())])
		: Readable.from([]);
	base.method = method;
	base.url = url;
	base.headers = {
		host: 'app.test',
		...(formBody ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
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
	return { res, status: res.statusCode, body: res.body, location: res.headers.location };
}

const VALID_QS = new URLSearchParams({
	response_type: 'code',
	client_id: 'mcp_test',
	redirect_uri: 'https://client.test/cb',
	scope: 'avatars:read',
	state: 'abc123',
	code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
	code_challenge_method: 'S256',
}).toString();

const VALID_CLIENT = {
	client_id: 'mcp_test',
	name: 'Test Client',
	redirect_uris: ['https://client.test/cb'],
	scope: 'avatars:read avatars:write profile',
	client_type: 'public',
	grant_types: ['authorization_code', 'refresh_token'],
};

function tryParseJson(s) {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

// ── Reset between tests ───────────────────────────────────────────────────

beforeEach(() => {
	authState.session = null;
	authState.csrfValid = true;
	authState.sameSite = true;
	sqlState.queue = [];
	sqlState.calls = [];
});

// ── Validation: required params and PKCE ──────────────────────────────────

describe('GET /api/oauth/authorize — request validation', () => {
	it('rejects response_type other than "code"', async () => {
		const qs = VALID_QS.replace('response_type=code', 'response_type=token');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${qs}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('unsupported_response_type');
	});

	it('rejects missing client_id', async () => {
		const params = new URLSearchParams(VALID_QS);
		params.delete('client_id');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_request');
	});

	it('rejects missing redirect_uri', async () => {
		const params = new URLSearchParams(VALID_QS);
		params.delete('redirect_uri');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_request');
	});

	it('rejects missing code_challenge (PKCE mandatory)', async () => {
		const params = new URLSearchParams(VALID_QS);
		params.delete('code_challenge');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error_description).toMatch(/code_challenge required/);
	});

	it('rejects missing code_challenge_method', async () => {
		const params = new URLSearchParams(VALID_QS);
		params.delete('code_challenge_method');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error_description).toMatch(/code_challenge_method required/);
	});

	it('rejects code_challenge_method other than S256 (e.g. "plain")', async () => {
		const qs = VALID_QS.replace('code_challenge_method=S256', 'code_challenge_method=plain');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${qs}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error_description).toMatch(/must be S256/);
	});
});

// ── Client / redirect_uri lookup ──────────────────────────────────────────

describe('GET /api/oauth/authorize — client and redirect_uri', () => {
	it('returns invalid_client when client_id is unknown', async () => {
		sqlState.queue.push([]); // no client row
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${VALID_QS}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_client');
	});

	it('rejects redirect_uri not registered (different host)', async () => {
		sqlState.queue.push([VALID_CLIENT]);
		const params = new URLSearchParams(VALID_QS);
		params.set('redirect_uri', 'https://attacker.test/cb');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_redirect_uri');
	});

	it('rejects redirect_uri with extra path segment (exact-pathname match)', async () => {
		sqlState.queue.push([VALID_CLIENT]);
		const params = new URLSearchParams(VALID_QS);
		params.set('redirect_uri', 'https://client.test/cb/extra');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_redirect_uri');
	});

	it('rejects redirect_uri with different protocol (http vs https)', async () => {
		sqlState.queue.push([VALID_CLIENT]);
		const params = new URLSearchParams(VALID_QS);
		params.set('redirect_uri', 'http://client.test/cb');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_redirect_uri');
	});

	it('rejects redirect_uri carrying a query string', async () => {
		sqlState.queue.push([VALID_CLIENT]);
		const params = new URLSearchParams(VALID_QS);
		params.set('redirect_uri', 'https://client.test/cb?injected=1');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_redirect_uri');
	});

	it('rejects redirect_uri carrying a fragment', async () => {
		sqlState.queue.push([VALID_CLIENT]);
		const params = new URLSearchParams(VALID_QS);
		params.set('redirect_uri', 'https://client.test/cb#frag');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_redirect_uri');
	});

	it('rejects redirect_uri on different port', async () => {
		sqlState.queue.push([VALID_CLIENT]);
		const params = new URLSearchParams(VALID_QS);
		params.set('redirect_uri', 'https://client.test:8443/cb');
		const { status, body } = await invoke({ url: `/api/oauth/authorize?${params}` });
		expect(status).toBe(400);
		expect(tryParseJson(body).error).toBe('invalid_redirect_uri');
	});
});

// ── Unauthenticated flow → bounce to login ────────────────────────────────

describe('GET /api/oauth/authorize — unauthenticated', () => {
	it('redirects anonymous caller to /login with consent URL preserved', async () => {
		sqlState.queue.push([VALID_CLIENT]);
		const { status, location } = await invoke({ url: `/api/oauth/authorize?${VALID_QS}` });
		expect(status).toBe(302);
		expect(location).toMatch(/^\/login\?next=/);
		// The "next" target must point back to the consent page with original params.
		const next = decodeURIComponent(location.split('next=')[1]);
		expect(next.startsWith('/oauth/consent?')).toBe(true);
		expect(next).toContain('client_id=mcp_test');
		expect(next).toContain('code_challenge=');
	});
});

// ── Authenticated GET → consent page ──────────────────────────────────────

describe('GET /api/oauth/authorize — consent page render', () => {
	it('renders an HTML consent page for an authenticated user', async () => {
		authState.session = { id: 'user-1', email: 'u@test', display_name: 'Alice' };
		sqlState.queue.push([VALID_CLIENT]);
		const { res, status, body } = await invoke({ url: `/api/oauth/authorize?${VALID_QS}` });
		expect(status).toBe(200);
		expect(res.headers['content-type']).toMatch(/text\/html/);
		expect(body).toContain('Authorize <b>Test Client</b>');
		expect(body).toContain('name="csrf"');
		// Original PKCE params are preserved as hidden inputs for POST submit.
		expect(body).toContain('name="code_challenge"');
		expect(body).toContain('name="redirect_uri"');
		// Frame protections present.
		expect(res.headers['x-frame-options']).toBe('DENY');
		expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
	});
});

// ── POST consent submission ───────────────────────────────────────────────

describe('POST /api/oauth/authorize — consent submission', () => {
	function consentForm(extra = {}) {
		return {
			response_type: 'code',
			client_id: 'mcp_test',
			redirect_uri: 'https://client.test/cb',
			scope: 'avatars:read',
			state: 'abc123',
			code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
			code_challenge_method: 'S256',
			csrf: 'csrf-token-fixed',
			decision: 'allow',
			...extra,
		};
	}

	it('issues a code and redirects with code+state on allow', async () => {
		authState.session = { id: 'user-1', email: 'u@test', display_name: 'Alice' };
		sqlState.queue.push([VALID_CLIENT]); // client lookup
		sqlState.queue.push([]); // insert auth code
		const { status, location } = await invoke({
			method: 'POST',
			url: '/api/oauth/authorize',
			formBody: consentForm(),
		});
		expect(status).toBe(302);
		expect(location.startsWith('https://client.test/cb?')).toBe(true);
		const back = new URL(location);
		expect(back.searchParams.get('code')).toBe('fixed-code-1234567890abcdef');
		expect(back.searchParams.get('state')).toBe('abc123');
		// Insert recorded with the issued code, client, user, redirect, scope, challenge.
		const insert = sqlState.calls.find((c) => /insert into oauth_auth_codes/i.test(c.query));
		expect(insert).toBeTruthy();
		expect(insert.values).toContain('fixed-code-1234567890abcdef');
		expect(insert.values).toContain('mcp_test');
		expect(insert.values).toContain('user-1');
	});

	it('redirects with error=access_denied when user denies', async () => {
		authState.session = { id: 'user-1', email: 'u@test', display_name: 'Alice' };
		sqlState.queue.push([VALID_CLIENT]);
		const { status, location } = await invoke({
			method: 'POST',
			url: '/api/oauth/authorize',
			formBody: consentForm({ decision: 'deny' }),
		});
		expect(status).toBe(302);
		const u = new URL(location);
		expect(u.origin + u.pathname).toBe('https://client.test/cb');
		expect(u.searchParams.get('error')).toBe('access_denied');
		expect(u.searchParams.get('state')).toBe('abc123');
	});

	it('rejects POST with bad CSRF token', async () => {
		authState.session = { id: 'user-1', email: 'u@test', display_name: 'Alice' };
		authState.csrfValid = false;
		sqlState.queue.push([VALID_CLIENT]);
		const { status, body } = await invoke({
			method: 'POST',
			url: '/api/oauth/authorize',
			formBody: consentForm({ csrf: 'wrong' }),
		});
		expect(status).toBe(403);
		expect(tryParseJson(body).error).toBe('forbidden');
		expect(tryParseJson(body).error_description).toMatch(/csrf/);
	});

	it('rejects cross-site POST (Origin check)', async () => {
		authState.session = { id: 'user-1', email: 'u@test', display_name: 'Alice' };
		authState.sameSite = false;
		sqlState.queue.push([VALID_CLIENT]);
		const { status, body } = await invoke({
			method: 'POST',
			url: '/api/oauth/authorize',
			formBody: consentForm(),
		});
		expect(status).toBe(403);
		expect(tryParseJson(body).error_description).toMatch(/cross-site/);
	});

	it('intersects requested scope with client-allowed scope when issuing code', async () => {
		authState.session = { id: 'user-1', email: 'u@test', display_name: 'Alice' };
		sqlState.queue.push([VALID_CLIENT]); // client lookup
		sqlState.queue.push([]); // insert
		// Request a scope NOT registered for the client — must be dropped.
		await invoke({
			method: 'POST',
			url: '/api/oauth/authorize',
			formBody: consentForm({ scope: 'avatars:read avatars:delete' }),
		});
		const insert = sqlState.calls.find((c) => /insert into oauth_auth_codes/i.test(c.query));
		expect(insert).toBeTruthy();
		// Stored scope value (positional arg) should NOT include avatars:delete.
		const storedScope = insert.values.find(
			(v) => typeof v === 'string' && v.includes('avatars:read'),
		);
		expect(storedScope).toBe('avatars:read');
		expect(storedScope).not.toMatch(/avatars:delete/);
	});
});

// ── Method handling ───────────────────────────────────────────────────────

describe('/api/oauth/authorize — HTTP method handling', () => {
	it('returns 405 on unsupported method (DELETE)', async () => {
		const { status } = await invoke({
			method: 'DELETE',
			url: `/api/oauth/authorize?${VALID_QS}`,
		});
		expect(status).toBe(405);
	});

	it('handles OPTIONS preflight with 204', async () => {
		const { status } = await invoke({
			method: 'OPTIONS',
			url: `/api/oauth/authorize?${VALID_QS}`,
		});
		expect(status).toBe(204);
	});
});

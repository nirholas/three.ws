// api/oauth/[action].js: the OAuth 2.1 authorization server the MCP clients
// connect through (/oauth/authorize, /token, /register, /revoke, /introspect).
//
// It shipped with no test coverage at all, and an audit of it found four live
// defects that these tests pin shut:
//   1. the consent screen listed the scope the client ASKED for while the code
//      it issued carried the client's registered scope, so a user could approve
//      one set of permissions and grant another;
//   2. `resource` was passed straight through to the token audience, minting a
//      credential that every consumer on the platform rejects instead of
//      failing with RFC 8707 `invalid_target`;
//   3. dynamic registration accepted `javascript:` and `data:` redirect URIs,
//      because zod's .url() is a bare `new URL()` check;
//   4. /oauth/revoke skipped the refresh-token lookup whenever the caller sent
//      `token_type_hint=access_token`, answering 200 OK while leaving the token
//      live for its full 30-day life (RFC 7009 section 2.1 requires extending
//      the search past a hint that does not resolve).
//
// Only the database is doubled. auth.js is real, so PKCE, the JWT mint/verify
// round trip, and refresh-token rotation run their production code here.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/streaks.js', () => ({ recordDailyActivity: vi.fn(async () => {}) }));
// Connected apps (DELETE /oauth/grants) checks the dashboard's CSRF token, which
// lives in its own table; that check has its own suite.
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		authIp: vi.fn(async () => ({ success: true })),
		oauthToken: vi.fn(async () => ({ success: true })),
		oauthRegisterIp: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '127.0.0.1',
}));

// ── in-memory stand-in for the three oauth tables ────────────────────────────
const db = { clients: [], codes: [], refresh: [] };
const statements = [];

function future(seconds) {
	return new Date(Date.now() + seconds * 1000).toISOString();
}

const sqlMock = vi.fn(async (strings, ...values) => {
	const text = strings.join('?').replace(/\s+/g, ' ').trim();
	statements.push({ text, values });

	if (text.startsWith('select * from oauth_clients where client_id')) {
		const [clientId] = values;
		return db.clients.filter((c) => c.client_id === clientId).slice(0, 1);
	}
	if (text.startsWith('insert into oauth_clients')) {
		const [client_id, client_secret_hash, client_type, name, logo_uri, client_uri, redirect_uris, grant_types, response_types, token_endpoint_auth, scope] = values;
		db.clients.push({ client_id, client_secret_hash, client_type, name, logo_uri, client_uri, redirect_uris, grant_types, response_types, token_endpoint_auth, scope, dynamically_registered: true });
		return [];
	}
	if (text.startsWith('insert into oauth_auth_codes')) {
		const [code, client_id, user_id, redirect_uri, scope, resource, code_challenge] = values;
		db.codes.push({ code, client_id, user_id, redirect_uri, scope, resource, code_challenge, code_challenge_method: 'S256', consumed_at: null, expires_at: future(60) });
		return [];
	}
	if (text.startsWith('select * from oauth_auth_codes where code')) {
		const [code] = values;
		return db.codes.filter((c) => c.code === code).slice(0, 1);
	}
	if (text.startsWith('update oauth_auth_codes set consumed_at')) {
		const [code] = values;
		const row = db.codes.find((c) => c.code === code && !c.consumed_at);
		if (!row) return [];
		row.consumed_at = new Date().toISOString();
		return [{ code: row.code }];
	}
	if (text.startsWith('insert into oauth_refresh_tokens')) {
		const [token_hash, client_id, user_id, scope, resource] = values;
		const row = { id: `rt-${db.refresh.length + 1}`, token_hash, client_id, user_id, scope, resource, revoked_at: null, replaced_by: null, last_used_at: null, created_at: new Date().toISOString(), expires_at: future(2_592_000) };
		db.refresh.push(row);
		return [{ id: row.id }];
	}
	if (text.startsWith('select id, user_id, scope, resource, expires_at, revoked_at from oauth_refresh_tokens')) {
		const [hash, clientId] = values;
		return db.refresh.filter((r) => r.token_hash === hash && r.client_id === clientId).slice(0, 1);
	}
	if (text.startsWith('select user_id, scope, expires_at, revoked_at from oauth_refresh_tokens')) {
		const [hash, clientId] = values;
		return db.refresh.filter((r) => r.token_hash === hash && r.client_id === clientId).slice(0, 1);
	}
	if (text.startsWith('update oauth_refresh_tokens set revoked_at = now(), replaced_by')) {
		const [replacedBy, id] = values;
		const row = db.refresh.find((r) => r.id === id);
		if (row) { row.revoked_at = new Date().toISOString(); row.replaced_by = replacedBy; }
		return [];
	}
	if (text.startsWith('update oauth_refresh_tokens set revoked_at = now() where token_hash')) {
		const [hash, clientId] = values;
		const row = db.refresh.find((r) => r.token_hash === hash && r.client_id === clientId && !r.revoked_at);
		if (!row) return [];
		row.revoked_at = new Date().toISOString();
		return [{ id: row.id, user_id: row.user_id }];
	}
	if (text.startsWith('update oauth_refresh_tokens set revoked_at = now() where user_id')) {
		const [userId, clientId] = values;
		const revoked = [];
		for (const r of db.refresh) {
			if (r.user_id === userId && r.client_id === clientId && !r.revoked_at) {
				r.revoked_at = new Date().toISOString();
				revoked.push({ id: r.id });
			}
		}
		return revoked;
	}
	// oauthGrantRevoked (api/_lib/auth.js): stamp last use on the live row, then
	// ask whether the grant was ended at or after the token was issued.
	if (text.startsWith('with touched as ( update oauth_refresh_tokens set last_used_at')) {
		const [liveUser, liveClient, userId, clientId, issuedAt] = values;
		for (const r of db.refresh) {
			if (r.user_id === liveUser && r.client_id === liveClient && !r.revoked_at) r.last_used_at = new Date().toISOString();
		}
		const revoked = db.refresh.some((r) => r.user_id === userId && r.client_id === clientId && !r.replaced_by
			&& r.revoked_at && Date.parse(r.revoked_at) >= issuedAt * 1000);
		return [{ revoked }];
	}
	// handleGrants GET: one row per client holding a live refresh token.
	if (text.startsWith('select c.client_id, c.name, c.client_uri')) {
		const [userId] = values;
		const live = db.refresh.filter((r) => r.user_id === userId && !r.revoked_at);
		return [...new Set(live.map((r) => r.client_id))].map((clientId) => {
			const c = db.clients.find((x) => x.client_id === clientId);
			const rows = live.filter((r) => r.client_id === clientId);
			return {
				client_id: clientId, name: c.name, client_uri: c.client_uri ?? null, logo_uri: null, software_id: null, software_version: null,
				authorized_at: rows[0].created_at ?? null, last_used_at: rows.map((r) => r.last_used_at).filter(Boolean).sort().pop() ?? null,
				scopes: rows.map((r) => r.scope).join(' '),
			};
		});
	}
	throw new Error(`unmodeled query: ${text}`);
});
// http.js's wrap() classifies caught errors with these predicates, so the mock
// has to export them alongside sql or every handler error becomes a crash
// inside the catch block instead of the intended status code.
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => sqlMock(strings, ...values),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

const getSessionUser = vi.fn();
vi.mock('../api/_lib/auth.js', async () => {
	const actual = await vi.importActual('../api/_lib/auth.js');
	return { ...actual, getSessionUser: (...args) => getSessionUser(...args) };
});

const { default: handler } = await import('../api/oauth/[action].js');
const { csrfTokenFor, verifyAccessToken, authenticateBearer } = await import('../api/_lib/auth.js');
const { sha256, sha256Base64Url } = await import('../api/_lib/crypto.js');

// ── request/response doubles ─────────────────────────────────────────────────
const SESSION_COOKIE = '__Host-sid=session-token-for-tests';
const ORIGIN = 'https://three.ws';
const RESOURCE = 'https://three.ws/api/mcp';

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b === undefined ? '' : b; };
	Object.defineProperty(r, 'body', { get: () => r._b ?? '' });
	Object.defineProperty(r, 'json', { value: () => JSON.parse(r._b) });
	return r;
}

async function call(action, { method = 'GET', query = {}, form, jsonBody, headers = {} } = {}) {
	const search = new URLSearchParams({ action, ...query }).toString();
	const req = {
		method,
		url: `/api/oauth/${action}?${search}`,
		query: { action, ...query },
		headers: { origin: ORIGIN, cookie: SESSION_COOKIE, ...headers },
		socket: { remoteAddress: '127.0.0.1' },
	};
	if (form) {
		req.headers['content-type'] = 'application/x-www-form-urlencoded';
		req.body = new URLSearchParams(form).toString();
	} else if (jsonBody) {
		req.headers['content-type'] = 'application/json';
		req.body = JSON.stringify(jsonBody);
	}
	const res = makeRes();
	await handler(req, res);
	return res;
}

const VERIFIER = 'a'.repeat(64);
let CHALLENGE;

function seedClient(overrides = {}) {
	const client = {
		client_id: 'mcp_test_client',
		client_secret_hash: null,
		client_type: 'public',
		name: 'Test MCP Client',
		redirect_uris: ['https://client.example/cb'],
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth: 'none',
		scope: 'avatars:read profile',
		...overrides,
	};
	db.clients.push(client);
	return client;
}

const authorizeQuery = (extra = {}) => ({
	response_type: 'code',
	client_id: 'mcp_test_client',
	redirect_uri: 'https://client.example/cb',
	code_challenge: CHALLENGE,
	code_challenge_method: 'S256',
	...extra,
});

const csrf = () => csrfTokenFor({ headers: { cookie: SESSION_COOKIE } });

async function approve(extra = {}) {
	return call('authorize', { method: 'POST', form: { ...authorizeQuery(extra), csrf: await csrf(), decision: 'allow' } });
}

const CONFIDENTIAL_SECRET = 'the-real-secret';

const basicHeader = (id, secret) => ({ authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` });

async function seedConfidentialClient() {
	return seedClient({ client_type: 'confidential', client_secret_hash: await sha256(CONFIDENTIAL_SECRET), token_endpoint_auth: 'client_secret_basic' });
}

// A `client_secret_basic` client sends its credentials in the Authorization
// header and nowhere else, so the form carries no client_id at all.
async function issueTokensOverBasicAuth() {
	const authorized = await approve();
	const code = new URL(authorized.getHeader('location')).searchParams.get('code');
	const res = await call('token', {
		method: 'POST',
		headers: basicHeader('mcp_test_client', CONFIDENTIAL_SECRET),
		form: { grant_type: 'authorization_code', code, redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER },
	});
	return res.json();
}

async function issueTokens() {
	const authorized = await approve();
	const code = new URL(authorized.getHeader('location')).searchParams.get('code');
	const res = await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_test_client', code, redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER } });
	return res.json();
}

beforeEach(async () => {
	CHALLENGE ||= await sha256Base64Url(VERIFIER);
	db.clients.length = 0;
	db.codes.length = 0;
	db.refresh.length = 0;
	statements.length = 0;
	sqlMock.mockClear();
	getSessionUser.mockReset();
	getSessionUser.mockResolvedValue({ id: 'user-1', email: 'ada@example.com', display_name: 'Ada' });
});

describe('GET /oauth/authorize', () => {
	it('renders a consent screen listing the scope that will actually be granted', async () => {
		seedClient();
		// The client asks for a scope it never registered. intersectScopes drops it
		// and falls back to the registered scope, so the screen must say so.
		const res = await call('authorize', { query: authorizeQuery({ scope: 'memory:write' }) });
		expect(res.statusCode).toBe(200);
		expect(res.getHeader('content-type')).toContain('text/html');
		expect(res.body).toContain('See your avatars');
		expect(res.body).toContain('See your name and email');
		expect(res.body).not.toContain('Save and erase');
	});

	it('allows the client origin in form-action so the post-consent 302 is not blocked', async () => {
		seedClient();
		const res = await call('authorize', { query: authorizeQuery() });
		expect(res.getHeader('content-security-policy')).toContain("form-action 'self' https://client.example");
	});

	it('sends an anonymous visitor to /login with the consent URL as the return target', async () => {
		seedClient();
		getSessionUser.mockResolvedValue(null);
		const res = await call('authorize', { query: authorizeQuery() });
		expect(res.statusCode).toBe(302);
		expect(decodeURIComponent(res.getHeader('location'))).toContain('/oauth/consent?');
	});

	it('rejects a redirect_uri the client never registered', async () => {
		seedClient();
		const res = await call('authorize', { query: authorizeQuery({ redirect_uri: 'https://attacker.example/cb' }) });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid_redirect_uri');
		expect(db.codes).toHaveLength(0);
	});

	it('rejects an unknown resource with invalid_target instead of minting an unusable token', async () => {
		seedClient();
		const res = await call('authorize', { query: authorizeQuery({ resource: 'https://someone-else.example/api' }) });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid_target');
		expect(db.codes).toHaveLength(0);
	});

	it('rejects a non-S256 PKCE challenge', async () => {
		seedClient();
		const res = await call('authorize', { query: authorizeQuery({ code_challenge_method: 'plain' }) });
		expect(res.statusCode).toBe(400);
		expect(res.json().error_description).toContain('S256');
	});
});

describe('POST /oauth/authorize', () => {
	it('issues a code carrying the intersected scope and the canonical resource', async () => {
		seedClient();
		const res = await approve({ scope: 'profile memory:write' });
		expect(res.statusCode).toBe(302);
		const back = new URL(res.getHeader('location'));
		expect(back.origin + back.pathname).toBe('https://client.example/cb');
		expect(back.searchParams.get('code')).toBeTruthy();
		expect(db.codes[0].scope).toBe('profile');
		expect(db.codes[0].resource).toBe(RESOURCE);
	});

	it('preserves state and returns access_denied when the user cancels', async () => {
		seedClient();
		const res = await call('authorize', { method: 'POST', form: { ...authorizeQuery({ state: 'xyz' }), csrf: await csrf(), decision: 'deny' } });
		const back = new URL(res.getHeader('location'));
		expect(back.searchParams.get('error')).toBe('access_denied');
		expect(back.searchParams.get('state')).toBe('xyz');
		expect(db.codes).toHaveLength(0);
	});

	it('refuses an approval without a valid CSRF token', async () => {
		seedClient();
		const res = await call('authorize', { method: 'POST', form: { ...authorizeQuery(), csrf: 'forged', decision: 'allow' } });
		expect(res.statusCode).toBe(403);
		expect(db.codes).toHaveLength(0);
	});

	it('refuses an approval posted from another origin', async () => {
		seedClient();
		const res = await call('authorize', { method: 'POST', form: { ...authorizeQuery(), csrf: await csrf(), decision: 'allow' }, headers: { origin: 'https://attacker.example' } });
		expect(res.statusCode).toBe(403);
		expect(db.codes).toHaveLength(0);
	});
});

describe('POST /oauth/token', () => {
	it('exchanges a code for a verifiable access token and a refresh token', async () => {
		seedClient();
		const out = await issueTokens();
		expect(out.token_type).toBe('Bearer');
		expect(out.scope).toBe('avatars:read profile');
		expect(out.refresh_token).toBeTruthy();
		const payload = await verifyAccessToken(out.access_token);
		expect(payload.sub).toBe('user-1');
		expect(payload.aud).toBe(RESOURCE);
		expect(payload.client_id).toBe('mcp_test_client');
	});

	it('rejects a wrong PKCE verifier without consuming the code', async () => {
		seedClient();
		const code = new URL((await approve()).getHeader('location')).searchParams.get('code');
		const res = await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_test_client', code, redirect_uri: 'https://client.example/cb', code_verifier: 'b'.repeat(64) } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid_grant');
		expect(db.codes[0].consumed_at).toBeNull();
	});

	it('rejects a redirect_uri that differs from the one the code was issued for', async () => {
		seedClient({ redirect_uris: ['https://client.example/cb', 'https://client.example/other'] });
		const code = new URL((await approve()).getHeader('location')).searchParams.get('code');
		const res = await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_test_client', code, redirect_uri: 'https://client.example/other', code_verifier: VERIFIER } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error_description).toContain('redirect_uri mismatch');
	});

	it('revokes the issued tokens when a code is replayed', async () => {
		seedClient();
		const code = new URL((await approve()).getHeader('location')).searchParams.get('code');
		const form = { grant_type: 'authorization_code', client_id: 'mcp_test_client', code, redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER };
		await call('token', { method: 'POST', form });
		const replay = await call('token', { method: 'POST', form });
		expect(replay.statusCode).toBe(400);
		expect(replay.json().error_description).toContain('already used');
		expect(db.refresh.every((r) => r.revoked_at)).toBe(true);
	});

	it('rotates a refresh token and refuses to widen the scope back', async () => {
		seedClient();
		const first = await issueTokens();

		const narrowed = await call('token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: 'mcp_test_client', refresh_token: first.refresh_token, scope: 'profile' } });
		expect(narrowed.statusCode).toBe(200);
		expect(narrowed.json().scope).toBe('profile');

		const widened = await call('token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: 'mcp_test_client', refresh_token: narrowed.json().refresh_token, scope: 'avatars:read profile' } });
		expect(widened.statusCode).toBe(400);
		expect(widened.json().error).toBe('invalid_scope');
	});

	it('detects refresh-token reuse and kills the whole chain', async () => {
		seedClient();
		const first = await issueTokens();
		await call('token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: 'mcp_test_client', refresh_token: first.refresh_token } });
		const reuse = await call('token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: 'mcp_test_client', refresh_token: first.refresh_token } });
		expect(reuse.statusCode).toBe(400);
		expect(reuse.json().error).toBe('refresh_reuse_detected');
		expect(db.refresh.every((r) => r.revoked_at)).toBe(true);
	});

	it('rejects a confidential client presenting the wrong secret', async () => {
		seedClient({ client_type: 'confidential', client_secret_hash: await sha256('the-real-secret'), token_endpoint_auth: 'client_secret_post' });
		const res = await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_test_client', client_secret: 'guessed', code: 'x', redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER } });
		expect(res.statusCode).toBe(401);
		expect(res.json().error).toBe('invalid_client');
	});

	it('reports an unsupported grant type', async () => {
		seedClient();
		const res = await call('token', { method: 'POST', form: { grant_type: 'client_credentials', client_id: 'mcp_test_client' } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('unsupported_grant_type');
	});

	it('challenges a Basic-auth client whose secret is wrong, so the 401 is not malformed', async () => {
		// RFC 6749 section 5.2: a client that authenticated through the
		// Authorization header MUST get WWW-Authenticate back naming that scheme.
		await seedConfidentialClient();
		const res = await call('token', {
			method: 'POST',
			headers: basicHeader('mcp_test_client', 'guessed'),
			form: { grant_type: 'authorization_code', code: 'x', redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER },
		});
		expect(res.statusCode).toBe(401);
		expect(res.getHeader('www-authenticate')).toMatch(/^Basic realm="oauth"/);
	});

	it('omits the challenge when the bad secret arrived in the form, not the header', async () => {
		seedClient({ client_type: 'confidential', client_secret_hash: await sha256(CONFIDENTIAL_SECRET), token_endpoint_auth: 'client_secret_post' });
		const res = await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_test_client', client_secret: 'guessed', code: 'x', redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER } });
		expect(res.statusCode).toBe(401);
		expect(res.getHeader('www-authenticate')).toBeUndefined();
	});

	it('rejects a token request naming another resource instead of minting an unusable token', async () => {
		seedClient();
		const res = await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_test_client', code: 'x', redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER, resource: 'https://evil.example/api/mcp' } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid_target');
	});

	it('accepts the canonical resource on the token request, trailing slash and all', async () => {
		seedClient();
		const authorized = await approve();
		const code = new URL(authorized.getHeader('location')).searchParams.get('code');
		const res = await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_test_client', code, redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER, resource: `${RESOURCE}/` } });
		expect(res.statusCode).toBe(200);
		expect((await verifyAccessToken(res.json().access_token)).aud).toBe(RESOURCE);
	});

	// An MCP client asks for the server it connected to (RFC 8707), so a connector
	// on /api/mcp-3d requests resource=https://three.ws/api/mcp-3d. Refusing it
	// stranded every OAuth connector on the four non-platform servers.
	it('issues a token bound to a hosted MCP server that names itself as the resource', async () => {
		seedClient();
		const authorized = await approve({ resource: 'https://three.ws/api/mcp-3d' });
		expect(db.codes[0].resource).toBe('https://three.ws/api/mcp-3d');
		const code = new URL(authorized.getHeader('location')).searchParams.get('code');
		const res = await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_test_client', code, redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER, resource: 'https://three.ws/api/mcp-3d' } });
		expect(res.statusCode).toBe(200);
		const payload = await verifyAccessToken(res.json().access_token, { audience: 'https://three.ws/api/mcp-3d' });
		expect(payload.aud).toBe('https://three.ws/api/mcp-3d');
		const introspected = await call('introspect', { method: 'POST', form: { token: res.json().access_token, client_id: 'mcp_test_client' } });
		expect(introspected.json()).toMatchObject({ active: true, aud: 'https://three.ws/api/mcp-3d' });
	});

	it('still rejects a lookalike of a hosted MCP server on another origin', async () => {
		seedClient();
		const res = await call('authorize', { query: authorizeQuery({ resource: 'https://evil.example/api/mcp-3d' }) });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid_target');
	});

	it('rejects a refresh exchange naming another resource', async () => {
		seedClient();
		const { refresh_token } = await issueTokens();
		const res = await call('token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: 'mcp_test_client', refresh_token, resource: 'https://evil.example/api/mcp' } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid_target');
	});
});

describe('POST /oauth/register', () => {
	it('registers a public client and drops privileged scopes it asked for', async () => {
		const res = await call('register', { method: 'POST', jsonBody: { redirect_uris: ['https://client.example/cb'], client_name: 'Probe', scope: 'avatars:read permissions:redeem' } });
		expect(res.statusCode).toBe(201);
		const out = res.json();
		expect(out.client_id).toMatch(/^mcp_/);
		expect(out.scope).toBe('avatars:read');
		expect(out.client_secret).toBeUndefined();
	});

	it('returns a one-time secret for a confidential client and stores only its hash', async () => {
		const res = await call('register', { method: 'POST', jsonBody: { redirect_uris: ['https://client.example/cb'], token_endpoint_auth_method: 'client_secret_basic' } });
		const out = res.json();
		expect(out.client_secret).toBeTruthy();
		expect(db.clients[0].client_secret_hash).toBe(await sha256(out.client_secret));
		expect(db.clients[0].client_secret_hash).not.toBe(out.client_secret);
	});

	it('stamps client_secret_expires_at so a client can tell the secret never expires', async () => {
		// RFC 7591 section 3.2.1 makes the field REQUIRED alongside an issued
		// secret; without it a client cannot distinguish "never expires" from a
		// field the server forgot to send.
		const res = await call('register', { method: 'POST', jsonBody: { redirect_uris: ['https://client.example/cb'], token_endpoint_auth_method: 'client_secret_basic' } });
		expect(res.json().client_secret_expires_at).toBe(0);
	});

	it('omits client_secret_expires_at for a public client that gets no secret', async () => {
		const res = await call('register', { method: 'POST', jsonBody: { redirect_uris: ['https://client.example/cb'] } });
		expect(res.json()).not.toHaveProperty('client_secret_expires_at');
	});

	it('echoes back the optional metadata it stored, so a client is not told its fields were dropped', async () => {
		// RFC 7591 section 3.2.1 makes the response the authoritative record of what
		// was registered. These four were saved to oauth_clients but never returned,
		// which reads as "rejected" and invites a re-registration under a new id.
		const sent = { redirect_uris: ['https://client.example/cb'], client_name: 'Probe', client_uri: 'https://client.example', logo_uri: 'https://client.example/logo.png', software_id: 'probe-cli', software_version: '2.1.0' };
		const out = (await call('register', { method: 'POST', jsonBody: sent })).json();
		expect(out).toMatchObject({ client_uri: sent.client_uri, logo_uri: sent.logo_uri, software_id: sent.software_id, software_version: sent.software_version });
	});

	it('leaves the optional metadata out entirely when the client sent none', async () => {
		const out = (await call('register', { method: 'POST', jsonBody: { redirect_uris: ['https://client.example/cb'] } })).json();
		for (const k of ['client_uri', 'logo_uri', 'software_id', 'software_version']) expect(out).not.toHaveProperty(k);
	});

	it.each([
		['javascript:alert(document.cookie)'],
		['data:text/html,<script>alert(1)</script>'],
		['file:///etc/passwd'],
		['vbscript:msgbox(1)'],
	])('refuses the executable redirect URI %s', async (uri) => {
		const res = await call('register', { method: 'POST', jsonBody: { redirect_uris: [uri] } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid_redirect_uri');
		expect(db.clients).toHaveLength(0);
	});

	it('still accepts loopback http and native private-use redirect URIs', async () => {
		const res = await call('register', { method: 'POST', jsonBody: { redirect_uris: ['http://127.0.0.1:8976/cb', 'http://localhost:1410/cb', 'com.example.app:/oauth2redirect', 'myapp://callback'] } });
		expect(res.statusCode).toBe(201);
	});

	it('refuses plain http on a public host', async () => {
		const res = await call('register', { method: 'POST', jsonBody: { redirect_uris: ['http://attacker.example/cb'] } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error_description).toContain('localhost');
	});

	it('refuses metadata naming a grant or response type this server does not support', async () => {
		const implicit = await call('register', { method: 'POST', jsonBody: { redirect_uris: ['https://client.example/cb'], grant_types: ['authorization_code', 'implicit'] } });
		expect(implicit.statusCode).toBe(400);
		expect(implicit.json().error).toBe('invalid_client_metadata');

		const token = await call('register', { method: 'POST', jsonBody: { redirect_uris: ['https://client.example/cb'], response_types: ['token'] } });
		expect(token.statusCode).toBe(400);
		expect(token.json().error).toBe('invalid_client_metadata');
		expect(db.clients).toHaveLength(0);
	});

	it('rejects a body that carries no redirect_uris at all', async () => {
		const res = await call('register', { method: 'POST', jsonBody: { redirect_uris: [] } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('validation_error');
	});
});

// A cloud connector (Grok Bot, claude.ai) registers from a cloud we have never
// seen, with a callback on a host nobody could list in advance. Any https URI
// has to work for it, and nothing that would carry the code in plain text or
// off to a non-browser handler may.
describe('POST /oauth/register for a cloud connector', () => {
	const GROK = { client_name: 'Grok Bot', client_uri: 'https://grok.com', redirect_uris: ['https://connectors.grok-cloud.example/oauth/callback/3f9a'], scope: 'avatars:read avatars:write profile offline_access wallet:read wallet:write' };

	it('registers Grok Bot with an https callback on an unpredictable host and keeps its name and site for consent', async () => {
		const res = await call('register', { method: 'POST', jsonBody: GROK });
		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.client_name).toBe('Grok Bot');
		expect(body.client_uri).toBe('https://grok.com');
		expect(body.redirect_uris).toEqual(GROK.redirect_uris);
		expect(db.clients[0]).toMatchObject({ name: 'Grok Bot', client_uri: 'https://grok.com', client_type: 'public' });

		const consent = await call('authorize', { query: { ...authorizeQuery({ client_id: body.client_id, redirect_uri: GROK.redirect_uris[0] }) } });
		expect(consent.statusCode).toBe(200);
		expect(consent.body).toContain('<b>Grok Bot</b> wants to connect to your three.ws account');
	});

	it.each([
		['plain http on a public host', 'http://connectors.grok-cloud.example/oauth/callback'],
		['ftp', 'ftp://connectors.grok-cloud.example/oauth/callback'],
		['an unencrypted websocket', 'ws://connectors.grok-cloud.example/oauth/callback'],
		['an encrypted websocket', 'wss://connectors.grok-cloud.example/oauth/callback'],
		['mailto', 'mailto:/attacker@example.com'],
		['javascript', 'javascript:alert(1)'],
	])('rejects %s, which is neither https nor loopback', async (_label, uri) => {
		const res = await call('register', { method: 'POST', jsonBody: { ...GROK, redirect_uris: [uri] } });
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toBe('invalid_redirect_uri');
		expect(db.clients).toHaveLength(0);
	});

	it.each([
		['localhost', 'http://localhost:6274/oauth/callback'],
		['127.0.0.1', 'http://127.0.0.1:33418/callback'],
		['IPv6 loopback', 'http://[::1]:8080/cb'],
	])('accepts plain http on %s for a desktop client', async (_label, uri) => {
		const res = await call('register', { method: 'POST', jsonBody: { ...GROK, redirect_uris: [uri] } });
		expect(res.statusCode).toBe(201);
	});
});

describe('consent screen for a cloud connector', () => {
	const grok = (overrides = {}) => seedClient({
		name: 'Grok Bot',
		client_uri: 'https://grok.com',
		redirect_uris: ['https://client.example/cb'],
		scope: 'avatars:read profile wallet:write',
		dynamically_registered: true,
		...overrides,
	});

	it('names the client, its site host and where the code goes, and says it can never spend', async () => {
		grok();
		const res = await call('authorize', { query: authorizeQuery() });
		expect(res.statusCode).toBe(200);
		expect(res.body).toContain('<b>Grok Bot</b> wants to connect');
		expect(res.body).toContain('<dd data-fact="client-host">grok.com</dd>');
		expect(res.body).toContain('<dd data-fact="return-host">client.example</dd>');
		expect(res.body).toContain('three.ws has not verified this app');
		expect(res.body).toContain('It can never spend from your wallet.');
		expect(res.body).toContain('<li>See your avatars</li>');
		expect(res.body).toContain('<li>See your name and email address</li>');
	});

	it('keeps the spend scope out of the list and behind an unticked box', async () => {
		grok();
		const res = await call('authorize', { query: authorizeQuery() });
		const list = res.body.match(/<ul data-scopes>(.*?)<\/ul>/)[1];
		expect(list).not.toContain('Spend USDC');
		expect(list).toContain('See your agent wallet balance and spending caps');
		expect(res.body).toMatch(/<input type="checkbox" id="allow-spend" name="allow_spend" value="yes">/);
		expect(res.body).not.toMatch(/id="allow-spend"[^>]*checked/);
	});

	it('shows no spend box when the client never asked to spend', async () => {
		grok({ scope: 'avatars:read profile' });
		const res = await call('authorize', { query: authorizeQuery() });
		expect(res.body).not.toContain('allow_spend');
		expect(res.body).toContain('It can never spend from your wallet.');
	});

	it('escapes a hostile client name everywhere it appears', async () => {
		grok({ name: '<img src=x onerror=alert(1)>' });
		const res = await call('authorize', { query: authorizeQuery() });
		expect(res.body).not.toContain('<img src=x');
		expect(res.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});

	it('grants wallet:read, not wallet:write, when the person leaves the box unticked', async () => {
		grok();
		await approve({ scope: 'avatars:read profile wallet:write' });
		expect(db.codes[0].scope.split(' ').sort()).toEqual(['avatars:read', 'profile', 'wallet:read']);
	});

	it('grants wallet:write only when the person ticks the box', async () => {
		grok();
		await approve({ scope: 'avatars:read profile wallet:write', allow_spend: 'yes' });
		expect(db.codes[0].scope.split(' ')).toContain('wallet:write');
	});
});

// Revoking an app has to stop it on its next call. Access tokens are JWTs,
// so before this the app kept working for up to an hour after Revoke.
describe('revocation is effective within one request', () => {
	const mcpAudience = { audience: RESOURCE };

	async function revokeInConnectedApps(clientId = 'mcp_test_client') {
		return call('grants', { method: 'DELETE', query: { client_id: clientId } });
	}

	it('rejects the access token on the very next request after Revoke in Connected apps', async () => {
		seedClient();
		const { access_token } = await issueTokens();
		expect(await authenticateBearer(access_token, mcpAudience)).toMatchObject({ userId: 'user-1', clientId: 'mcp_test_client', source: 'oauth' });

		const revoked = await revokeInConnectedApps();
		expect(revoked.statusCode).toBe(200);
		expect(revoked.json()).toEqual({ client_id: 'mcp_test_client', revoked: 1 });

		expect(await authenticateBearer(access_token, mcpAudience)).toBeNull();
		const introspected = await call('introspect', { method: 'POST', form: { token: access_token, client_id: 'mcp_test_client' } });
		expect(introspected.json()).toEqual({ active: false });
	});

	it('also refuses the revoked refresh token, so the app cannot mint a fresh access token', async () => {
		seedClient();
		const { refresh_token } = await issueTokens();
		await revokeInConnectedApps();
		const res = await call('token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: 'mcp_test_client', refresh_token } });
		expect(res.statusCode).toBe(400);
	});

	it('ends the access token when the client revokes its own refresh token (RFC 7009)', async () => {
		seedClient();
		const { access_token, refresh_token } = await issueTokens();
		await call('revoke', { method: 'POST', form: { token: refresh_token, client_id: 'mcp_test_client' } });
		expect(await authenticateBearer(access_token, mcpAudience)).toBeNull();
	});

	it('does not cut off the access token a normal refresh replaced', async () => {
		seedClient();
		const { access_token, refresh_token } = await issueTokens();
		const refreshed = await call('token', { method: 'POST', form: { grant_type: 'refresh_token', client_id: 'mcp_test_client', refresh_token } });
		expect(refreshed.statusCode).toBe(200);
		expect(await authenticateBearer(access_token, mcpAudience)).not.toBeNull();
		expect(await authenticateBearer(refreshed.json().access_token, mcpAudience)).not.toBeNull();
	});

	it('leaves another app the same person connected untouched', async () => {
		seedClient();
		seedClient({ client_id: 'mcp_other_client', name: 'Other App' });
		const mine = await issueTokens();
		const authorized = await approve({ client_id: 'mcp_other_client' });
		const code = new URL(authorized.getHeader('location')).searchParams.get('code');
		const other = (await call('token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: 'mcp_other_client', code, redirect_uri: 'https://client.example/cb', code_verifier: VERIFIER } })).json();

		await revokeInConnectedApps('mcp_test_client');
		expect(await authenticateBearer(mine.access_token, mcpAudience)).toBeNull();
		expect(await authenticateBearer(other.access_token, mcpAudience)).toMatchObject({ clientId: 'mcp_other_client' });
	});

	it('lets the person connect the app again after revoking it', async () => {
		seedClient();
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			await issueTokens();
			await revokeInConnectedApps();
			vi.setSystemTime(Date.now() + 2_000);
			db.codes.length = 0;
			const again = await issueTokens();
			expect(await authenticateBearer(again.access_token, mcpAudience)).toMatchObject({ clientId: 'mcp_test_client' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('lists the connected app with its site host and last use, then drops it after Revoke', async () => {
		seedClient({ name: 'Grok Bot', client_uri: 'https://grok.com' });
		const { access_token } = await issueTokens();
		await authenticateBearer(access_token, mcpAudience);
		const listed = (await call('grants')).json().grants;
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({ client_id: 'mcp_test_client', name: 'Grok Bot', client_host: 'grok.com', can_spend: false });
		expect(listed[0].last_used_at).toBeTruthy();

		await revokeInConnectedApps();
		expect((await call('grants')).json().grants).toEqual([]);
	});

	it('refuses to list or revoke apps without a signed-in session', async () => {
		getSessionUser.mockResolvedValue(null);
		expect((await call('grants')).statusCode).toBe(401);
		expect((await revokeInConnectedApps()).statusCode).toBe(401);
	});
});

describe('POST /oauth/revoke', () => {
	it('revokes a refresh token', async () => {
		seedClient();
		const { refresh_token } = await issueTokens();
		const res = await call('revoke', { method: 'POST', form: { token: refresh_token, client_id: 'mcp_test_client' } });
		expect(res.statusCode).toBe(200);
		expect(db.refresh[0].revoked_at).toBeTruthy();
	});

	it('revokes a refresh token even when the caller hints the wrong token type', async () => {
		seedClient();
		const { refresh_token } = await issueTokens();
		const res = await call('revoke', { method: 'POST', form: { token: refresh_token, token_type_hint: 'access_token', client_id: 'mcp_test_client' } });
		expect(res.statusCode).toBe(200);
		expect(db.refresh[0].revoked_at).toBeTruthy();
	});

	it('answers 200 for an unknown client without disclosing that it is unknown', async () => {
		const res = await call('revoke', { method: 'POST', form: { token: 'whatever', client_id: 'mcp_nope' } });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({});
	});

	// RFC 7009 section 2.1: the client authenticates here exactly as it does at
	// the token endpoint. Only the token endpoint read the Authorization header,
	// so a `client_secret_basic` client was answered 400 (no client_id in the
	// form) and 401 (bad credentials) and could never revoke anything it owned.
	it('authenticates a client_secret_basic client from the Authorization header alone', async () => {
		await seedConfidentialClient();
		const { refresh_token } = await issueTokensOverBasicAuth();
		const res = await call('revoke', { method: 'POST', headers: basicHeader('mcp_test_client', CONFIDENTIAL_SECRET), form: { token: refresh_token } });
		expect(res.statusCode).toBe(200);
		expect(db.refresh[0].revoked_at).toBeTruthy();
	});

	it('rejects a Basic header carrying the wrong secret', async () => {
		await seedConfidentialClient();
		const { refresh_token } = await issueTokensOverBasicAuth();
		const res = await call('revoke', { method: 'POST', headers: basicHeader('mcp_test_client', 'guessed'), form: { token: refresh_token } });
		expect(res.statusCode).toBe(401);
		expect(res.json().error).toBe('invalid_client');
		expect(res.getHeader('www-authenticate')).toMatch(/^Basic realm="oauth"/);
		expect(db.refresh[0].revoked_at).toBeNull();
	});
});

describe('POST /oauth/introspect', () => {
	it('reports an access token as active with its scope and subject', async () => {
		seedClient();
		const tokens = await issueTokens();
		const res = await call('introspect', { method: 'POST', form: { token: tokens.access_token, client_id: 'mcp_test_client' } });
		expect(res.json()).toMatchObject({ active: true, sub: 'user-1', scope: 'avatars:read profile', token_type: 'Bearer' });
	});

	it('reports a refresh token as active', async () => {
		seedClient();
		const tokens = await issueTokens();
		const res = await call('introspect', { method: 'POST', form: { token: tokens.refresh_token, client_id: 'mcp_test_client' } });
		expect(res.json()).toMatchObject({ active: true, sub: 'user-1', token_type: 'refresh_token' });
	});

	it('will not confirm a token that belongs to another client', async () => {
		seedClient();
		const tokens = await issueTokens();
		seedClient({ client_id: 'mcp_other', redirect_uris: ['https://other.example/cb'] });
		const res = await call('introspect', { method: 'POST', form: { token: tokens.access_token, client_id: 'mcp_other' } });
		expect(res.json()).toEqual({ active: false });
	});

	it('reports a revoked refresh token as inactive', async () => {
		seedClient();
		const tokens = await issueTokens();
		await call('revoke', { method: 'POST', form: { token: tokens.refresh_token, client_id: 'mcp_test_client' } });
		const res = await call('introspect', { method: 'POST', form: { token: tokens.refresh_token, client_id: 'mcp_test_client' } });
		expect(res.json()).toEqual({ active: false });
	});

	it('reports a garbage token as inactive rather than erroring', async () => {
		seedClient();
		const res = await call('introspect', { method: 'POST', form: { token: 'not-a-token', client_id: 'mcp_test_client' } });
		expect(res.json()).toEqual({ active: false });
	});

	// RFC 7662 section 2.1 carries the same client-authentication requirement as
	// the token endpoint, and a `client_secret_basic` client has no other way to
	// present its credentials.
	it('authenticates a client_secret_basic client from the Authorization header alone', async () => {
		await seedConfidentialClient();
		const tokens = await issueTokensOverBasicAuth();
		const res = await call('introspect', { method: 'POST', headers: basicHeader('mcp_test_client', CONFIDENTIAL_SECRET), form: { token: tokens.access_token } });
		expect(res.json()).toMatchObject({ active: true, sub: 'user-1', token_type: 'Bearer' });
	});

	it('refuses to answer a Basic header carrying the wrong secret', async () => {
		await seedConfidentialClient();
		const tokens = await issueTokensOverBasicAuth();
		const res = await call('introspect', { method: 'POST', headers: basicHeader('mcp_test_client', 'guessed'), form: { token: tokens.access_token } });
		expect(res.statusCode).toBe(401);
		expect(res.json().error).toBe('invalid_client');
		expect(res.getHeader('www-authenticate')).toMatch(/^Basic realm="oauth"/);
	});
});

describe('dispatcher', () => {
	it('404s an unknown action', async () => {
		const res = await call('bogus');
		expect(res.statusCode).toBe(404);
		expect(res.json().error).toBe('not_found');
	});

	it('rejects a method the action does not serve', async () => {
		const res = await call('token', { method: 'GET' });
		expect(res.statusCode).toBe(405);
	});
});

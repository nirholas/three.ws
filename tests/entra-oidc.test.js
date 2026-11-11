// Sign in with Microsoft (api/_lib/entra-oidc.js, api/auth/microsoft/[action].js).
//
// The multitenant `common` authority accepts tokens from every Entra tenant,
// so the issuer rule is the whole defence against a token minted in one
// directory being replayed as another: `iss` must be exactly the v2.0 issuer
// of the tenant the token names. These tests pin that rule, the nonce and
// audience checks, which email Microsoft actually vouches for, the authorize
// URL the start route sends a browser to, and that a callback with a state the
// flow cookie does not hold is refused before any code is exchanged.

import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '127.0.0.1',
}));

process.env.JWT_SECRET ||= 'entra-oidc-test-secret-entra-oidc-test-secret';
process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.MS_ENTRA_SSO_CLIENT_ID = '0f6f2d1e-3c4b-4a59-8e7d-1a2b3c4d5e6f';
process.env.MS_ENTRA_SSO_CLIENT_SECRET = 'entra-test-client-secret';

import {
	checkIssuer, claimsFromPayload, buildAuthorize, directoryRoles, tenantAdminRole, EntraError, CONSUMER_TENANT_ID,
	LOGIN_BASE,
} from '../api/_lib/entra-oidc.js';
import { signIdentityPayload } from '../api/_lib/identities.js';

const CLIENT_ID = process.env.MS_ENTRA_SSO_CLIENT_ID;
const TENANT_A = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const TENANT_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OID = '00000000-0000-4000-8000-0000000000a1';
const NOW = 1_800_000_000_000;

function payload(overrides = {}) {
	return {
		iss: `${LOGIN_BASE}/${TENANT_A}/v2.0`,
		tid: TENANT_A,
		oid: OID,
		aud: CLIENT_ID,
		nonce: 'n-1',
		iat: NOW / 1000 - 10,
		name: 'Ada Lovelace',
		preferred_username: 'ada@contoso.example',
		email: 'ada@contoso.example',
		...overrides,
	};
}

function thrown(fn) {
	try {
		fn();
	} catch (e) {
		return e;
	}
	return null;
}

describe('issuer validation', () => {
	it('rejects a token from the wrong tenant when a tenant is expected', () => {
		const err = thrown(() => checkIssuer(payload(), { expectedTenantId: TENANT_B }));
		expect(err).toBeInstanceOf(EntraError);
		expect(err.code).toBe('wrong_tenant');
		expect(err.status).toBe(403);
	});

	it('rejects a token whose iss names a different tenant than its tid', () => {
		const err = thrown(() => checkIssuer(payload({ iss: `${LOGIN_BASE}/${TENANT_B}/v2.0` })));
		expect(err?.code).toBe('invalid_token');
	});

	it('rejects the {tenantid} template issuer, the v1 issuer and a non-GUID tid', () => {
		expect(thrown(() => checkIssuer(payload({ iss: `${LOGIN_BASE}/{tenantid}/v2.0` })))?.code).toBe('invalid_token');
		expect(thrown(() => checkIssuer(payload({ iss: `https://sts.windows.net/${TENANT_A}/` })))?.code).toBe('invalid_token');
		expect(thrown(() => checkIssuer(payload({ tid: 'common', iss: `${LOGIN_BASE}/common/v2.0` })))?.code).toBe('invalid_token');
	});

	it('accepts the exact per-tenant issuer and returns the tenant', () => {
		expect(checkIssuer(payload())).toBe(TENANT_A);
		expect(checkIssuer(payload(), { expectedTenantId: TENANT_A.toUpperCase() })).toBe(TENANT_A);
	});
});

describe('claims', () => {
	it('keys the identity on tid:oid, the same subject Marketplace sign-in links', () => {
		const c = claimsFromPayload(payload(), { clientId: CLIENT_ID, nonce: 'n-1', now: NOW });
		expect(c.subject).toBe(`${TENANT_A}:${OID}`);
		expect(c.tenant_id).toBe(TENANT_A);
		expect(c.personal).toBe(false);
	});

	it('refuses a different nonce and a different audience', () => {
		expect(thrown(() => claimsFromPayload(payload(), { clientId: CLIENT_ID, nonce: 'other', now: NOW }))?.code).toBe('invalid_token');
		expect(thrown(() => claimsFromPayload(payload({ aud: 'someone-else' }), { clientId: CLIENT_ID, nonce: 'n-1', now: NOW }))?.code).toBe('invalid_token');
	});

	it('treats the email claim as unverified unless xms_edov or verified_primary_email vouches for it', () => {
		const plain = claimsFromPayload(payload(), { clientId: CLIENT_ID, now: NOW });
		expect(plain.email).toBe('ada@contoso.example');
		expect(plain.email_verified).toBe(false);
		expect(claimsFromPayload(payload({ xms_edov: true }), { clientId: CLIENT_ID, now: NOW }).email_verified).toBe(true);
		expect(claimsFromPayload(payload({ xms_edov: '1' }), { clientId: CLIENT_ID, now: NOW }).email_verified).toBe(true);
		expect(claimsFromPayload(payload({ verified_primary_email: ['Ada@Contoso.example'] }), { clientId: CLIENT_ID, now: NOW }).email_verified).toBe(true);
		expect(claimsFromPayload(payload({ verified_primary_email: ['other@contoso.example'] }), { clientId: CLIENT_ID, now: NOW }).email_verified).toBe(false);
	});

	it('marks personal accounts by the consumer tenant', () => {
		const c = claimsFromPayload(payload({ tid: CONSUMER_TENANT_ID, iss: `${LOGIN_BASE}/${CONSUMER_TENANT_ID}/v2.0` }), { clientId: CLIENT_ID, now: NOW });
		expect(c.personal).toBe(true);
	});

	it('refuses a reauth or tenant claim whose credentials were not entered just now', () => {
		const stale = payload({ iat: NOW / 1000 - 3600 });
		expect(thrown(() => claimsFromPayload(stale, { clientId: CLIENT_ID, maxAuthAgeSec: 300, now: NOW }))?.code).toBe('reauth_stale');
		expect(claimsFromPayload(payload(), { clientId: CLIENT_ID, maxAuthAgeSec: 300, now: NOW }).subject).toBeTruthy();
	});
});

describe('tenant admin proof', () => {
	const GLOBAL_ADMIN = '62e90394-69f5-4237-9190-012177145e10';
	const fakeJwt = (body) => `e30.${Buffer.from(JSON.stringify(body)).toString('base64url')}.sig`;
	const claims = () => claimsFromPayload(payload(), { clientId: CLIENT_ID, now: NOW });

	it('reads directory roles from the ID token wids', () => {
		const c = claimsFromPayload(payload({ wids: [GLOBAL_ADMIN] }), { clientId: CLIENT_ID, now: NOW });
		expect(tenantAdminRole(directoryRoles(c, null))).toBe('Global Administrator');
	});

	it('reads them from the Graph access token only when its tenant and object id match', () => {
		expect(tenantAdminRole(directoryRoles(claims(), fakeJwt({ tid: TENANT_A, oid: OID, wids: [GLOBAL_ADMIN] })))).toBe('Global Administrator');
		expect(tenantAdminRole(directoryRoles(claims(), fakeJwt({ tid: TENANT_B, oid: OID, wids: [GLOBAL_ADMIN] })))).toBeNull();
		expect(tenantAdminRole(directoryRoles(claims(), fakeJwt({ tid: TENANT_A, oid: '00000000-0000-4000-8000-0000000000ff', wids: [GLOBAL_ADMIN] })))).toBeNull();
	});

	it('a plain user role is not an admin', () => {
		expect(tenantAdminRole(['b79fbf4d-3ef9-4689-8143-76b194e85509'])).toBeNull();
	});
});

describe('authorize URL', () => {
	it('uses the common authority with PKCE S256, a nonce and the registered redirect URI', async () => {
		const a = await buildAuthorize();
		const u = new URL(a.url);
		expect(`${u.origin}${u.pathname}`).toBe(`${LOGIN_BASE}/common/oauth2/v2.0/authorize`);
		const p = Object.fromEntries(u.searchParams);
		expect(p.client_id).toBe(CLIENT_ID);
		expect(p.response_type).toBe('code');
		expect(p.redirect_uri).toMatch(/\/api\/auth\/microsoft\/callback$/);
		expect(p.scope.split(' ')).toEqual(expect.arrayContaining(['openid', 'profile', 'email']));
		expect(p.code_challenge_method).toBe('S256');
		expect(p.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(p.state).toBe(a.state);
		expect(p.nonce).toBe(a.nonce);
		expect(p.prompt).toBe('select_account');
	});

	it('forces fresh credentials for reauth and tenant claims', async () => {
		const p = new URL((await buildAuthorize({ prompt: 'login', maxAge: 0 })).url).searchParams;
		expect(p.get('prompt')).toBe('login');
		expect(p.get('max_age')).toBe('0');
	});
});

describe('callback state', () => {
	let handler;
	let mod;
	beforeAll(async () => {
		mod = await import('../api/auth/microsoft/[action].js');
		handler = mod.default;
	});

	function call(url, cookie) {
		return new Promise((resolve) => {
			const headers = {};
			const res = {
				statusCode: 200,
				headersSent: false,
				setHeader(k, v) { headers[k.toLowerCase()] = v; },
				getHeader(k) { return headers[k.toLowerCase()]; },
				removeHeader(k) { delete headers[k.toLowerCase()]; },
				writeHead(s, h) { this.statusCode = s; Object.assign(headers, h || {}); return this; },
				end(body) { resolve({ status: this.statusCode, headers, body }); },
				write() {},
			};
			const req = { method: 'GET', url, headers: { host: 'localhost', cookie: cookie || '' }, query: { action: 'callback' } };
			handler(req, res);
		});
	}

	async function flowCookie(state) {
		const v = await signIdentityPayload({ s: state, n: 'n', v: 'v', i: 'login', x: '/dashboard', e: Math.floor(Date.now() / 1000) + 600 });
		return `${mod.FLOW_COOKIE}=${encodeURIComponent(v)}`;
	}

	it('refuses a state that does not match the flow cookie, before exchanging the code', async () => {
		const out = await call('/api/auth/microsoft/callback?code=abc&state=tampered', await flowCookie('real-state'));
		expect(out.status).toBe(302);
		expect(out.headers.location).toBe('/login?error=microsoft_expired');
	});

	it('refuses a callback with no flow cookie at all', async () => {
		const out = await call('/api/auth/microsoft/callback?code=abc&state=anything');
		expect(out.headers.location).toMatch(/^\/login\?error=microsoft_expired/);
	});

	it('refuses a forged flow cookie', async () => {
		const forged = `${mod.FLOW_COOKIE}=${Buffer.from(JSON.stringify({ s: 'x', e: 9e9 })).toString('base64url')}.AAAA`;
		const out = await call('/api/auth/microsoft/callback?code=abc&state=x', forged);
		expect(out.headers.location).toMatch(/^\/login\?error=microsoft_expired/);
	});

	it('readFlow returns the flow only for the exact state', async () => {
		const c = await flowCookie('s-1');
		expect(await mod.readFlow({ headers: { cookie: c } }, 's-1')).toMatchObject({ intent: 'login', nonce: 'n' });
		expect(await mod.readFlow({ headers: { cookie: c } }, 's-2')).toBeNull();
	});
});

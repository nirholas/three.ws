// Entra app gallery rules for the multitenant OpenID Connect sign-in
// (api/auth/microsoft/[action].js over api/_lib/entra-oidc.js).
//
// A gallery OIDC app must work for any tenant, launch from My Apps through a
// stable sign-on URL that starts the Entra flow and lands the person in the
// app, and give a clear answer when the person's own tenant blocks the sign-in
// (not assigned to the app, the app disabled, a Conditional Access policy).
// The issuer and `tid` rules themselves live in tests/entra-oidc.test.js.

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '127.0.0.1',
}));

process.env.JWT_SECRET ||= 'entra-gallery-test-secret-entra-gallery-test-secret';
process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.MS_ENTRA_SSO_CLIENT_ID = '0f6f2d1e-3c4b-4a59-8e7d-1a2b3c4d5e6f';
process.env.MS_ENTRA_SSO_CLIENT_SECRET = 'entra-test-client-secret';

import { claimsFromPayload, LOGIN_BASE } from '../api/_lib/entra-oidc.js';
import { unsignIdentityPayload } from '../api/_lib/identities.js';

const CLIENT_ID = process.env.MS_ENTRA_SSO_CLIENT_ID;

let mod;
beforeAll(async () => {
	mod = await import('../api/auth/microsoft/[action].js');
});

afterEach(() => {
	process.env.MS_ENTRA_SSO_CLIENT_ID = CLIENT_ID;
	process.env.MS_ENTRA_SSO_CLIENT_SECRET = 'entra-test-client-secret';
});

function call(action, url, { headers = {} } = {}) {
	return new Promise((resolve, reject) => {
		const out = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { out[k.toLowerCase()] = v; },
			getHeader(k) { return out[k.toLowerCase()]; },
			removeHeader(k) { delete out[k.toLowerCase()]; },
			writeHead(s, h) { this.statusCode = s; Object.assign(out, h || {}); return this; },
			end(body) { resolve({ status: this.statusCode, headers: out, body }); },
			write() {},
		};
		const req = { method: 'GET', url, headers: { host: 'localhost', ...headers }, query: { action } };
		Promise.resolve(mod.default(req, res)).catch(reject);
	});
}

async function flowFrom(setCookie) {
	const raw = [].concat(setCookie).find((c) => c.startsWith(`${mod.FLOW_COOKIE}=`));
	const value = decodeURIComponent(raw.split(';')[0].slice(mod.FLOW_COOKIE.length + 1));
	return unsignIdentityPayload(value);
}

describe('any tenant', () => {
	it('accepts an ID token from a tenant three.ws has never seen, keyed to that tenant', () => {
		const tid = '3f2a9c71-5d4e-4b8a-9c1d-7e6f5a4b3c2d';
		const c = claimsFromPayload(
			{ iss: `${LOGIN_BASE}/${tid}/v2.0`, tid, oid: '00000000-0000-4000-8000-0000000000b2', aud: CLIENT_ID, iat: Date.now() / 1000 },
			{ clientId: CLIENT_ID },
		);
		expect(c.tenant_id).toBe(tid);
		expect(c.subject).toBe(`${tid}:00000000-0000-4000-8000-0000000000b2`);
	});
});

describe('My Apps launch (sign-on URL)', () => {
	it('is routed at /sso/microsoft and /api/auth/microsoft/launch', () => {
		const routes = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).routes;
		for (const src of ['/sso/microsoft', '/api/auth/microsoft/launch']) {
			const row = routes.find((r) => r.src === src);
			expect(row, src).toBeTruthy();
			expect(row.dest).toBe('/api/auth/microsoft/[action]?action=launch');
		}
	});

	it('starts the Entra flow on the common authority without forcing an account picker', async () => {
		const out = await call('launch', '/sso/microsoft');
		expect(out.status).toBe(302);
		const u = new URL(out.headers.location);
		expect(`${u.origin}${u.pathname}`).toBe(`${LOGIN_BASE}/common/oauth2/v2.0/authorize`);
		expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
		expect(u.searchParams.get('code_challenge_method')).toBe('S256');
		expect(u.searchParams.has('prompt')).toBe(false);
		const flow = await flowFrom(out.headers['set-cookie']);
		expect(flow).toMatchObject({ i: 'login', x: '/dashboard', s: u.searchParams.get('state'), n: u.searchParams.get('nonce') });
	});

	it('keeps a safe deep link and passes the tenant and account hints through', async () => {
		const out = await call('launch', '/sso/microsoft?next=%2Fteams&domain_hint=contoso.example&login_hint=grace%40contoso.example');
		const u = new URL(out.headers.location);
		expect(u.searchParams.get('domain_hint')).toBe('contoso.example');
		expect(u.searchParams.get('login_hint')).toBe('grace@contoso.example');
		expect((await flowFrom(out.headers['set-cookie'])).x).toBe('/teams');
	});

	it('drops an off-site next and malformed hints', async () => {
		const out = await call('launch', '/sso/microsoft?next=https%3A%2F%2Fevil.example%2F&domain_hint=%3Cscript%3E&login_hint=' + 'a'.repeat(400));
		const u = new URL(out.headers.location);
		expect(u.searchParams.has('domain_hint')).toBe(false);
		expect(u.searchParams.has('login_hint')).toBe(false);
		expect((await flowFrom(out.headers['set-cookie'])).x).toBe('/dashboard');
	});

	it('sends the browser to /login with a clear message when sign-in is not configured', async () => {
		delete process.env.MS_ENTRA_SSO_CLIENT_ID;
		const out = await call('launch', '/sso/microsoft');
		expect(out.status).toBe(302);
		expect(out.headers.location).toBe('/login?error=microsoft_unavailable');
	});
});

describe('tenant-side blocks get their own answer', () => {
	const cases = [
		['access_denied', 'AADSTS50105: The signed in user is not assigned to a role for the application.', 'microsoft_not_assigned'],
		['access_denied', 'AADSTS7000112: Application is disabled.', 'microsoft_app_disabled'],
		['invalid_request', 'AADSTS700016: Application with identifier was not found in the directory.', 'microsoft_app_disabled'],
		['access_denied', 'AADSTS53003: Access has been blocked by Conditional Access policies.', 'microsoft_conditional_access'],
		['interaction_required', 'AADSTS53000: Device is not in required device state: compliant.', 'microsoft_conditional_access'],
		['consent_required', 'AADSTS65001: The user or administrator has not consented to use the application.', 'microsoft_admin_consent_required'],
		['access_denied', 'AADSTS90094: An administrator of Contoso has set a policy that prevents you from granting consent.', 'microsoft_admin_consent_required'],
		['access_denied', 'AADSTS65004: User declined to consent to access the app.', 'microsoft_cancelled'],
		['server_error', 'AADSTS90033: A transient error has occurred.', 'microsoft_failed'],
	];
	it.each(cases)('%s %s -> %s', (err, description, code) => {
		expect(mod.deniedCode(err, description)).toBe(code);
	});

	it('/login explains every code the callback can send', () => {
		const html = readFileSync(new URL('../public/login.html', import.meta.url), 'utf8');
		for (const code of new Set(cases.map((c) => c[2]))) expect(html, code).toMatch(new RegExp(`\\b${code}:`));
	});
});

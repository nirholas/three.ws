// Login CSRF: the sign-in completion endpoints must only finish a flow that
// this browser started. Otherwise an attacker feeds the victim's browser the
// attacker's own widget payload, assertion or handoff link and the victim ends
// up signed in as the attacker.

import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';
process.env.JWT_SECRET ||= 'test-saml-secret-at-least-32-characters';

const state = { created: 0, verified: 0, samlValidated: 0, flowCookie: null };

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => null),
	createSession: vi.fn(async () => { state.created++; return 'tok'; }),
	destroySession: vi.fn(async () => {}),
	sessionCookie: (t) => `__Host-sid=${t}`,
	isSameSiteOrigin: () => true,
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/seed-default-agent.js', () => ({ seedDefaultAgent: vi.fn() }));
vi.mock('../api/_lib/referrals.js', () => ({ referralCodeCandidates: vi.fn(() => []) }));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/gateway/bots.js', () => ({ telegramUsername: vi.fn() }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '203.0.113.7',
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => [{ id: 'u9', deleted_at: null }]),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/account-link/telegram-login.js', async (orig) => {
	const real = await orig();
	return {
		...real,
		telegramLoginConfigured: () => true,
		verifyWidgetPayload: vi.fn(() => {
			state.verified++;
			return { payloadHash: 'h', authDate: new Date(), claims: { id: 1 } };
		}),
		recordWidgetPayload: vi.fn(async () => {}),
		claimsFrom: () => ({ subject: '1' }),
		resolveLoginUser: vi.fn(async () => ({ userId: 'u1', isNew: false })),
	};
});
vi.mock('../api/_lib/identities.js', async (orig) => {
	const real = await orig();
	return { ...real, findUserByIdentity: vi.fn(async () => ({ id: 'u1', identity_id: 'i1' })), touchIdentity: vi.fn(async () => {}) };
});

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this.headers[String(k).toLowerCase()]; },
		removeHeader() {},
		writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		end() { return this; },
	};
}

beforeEach(() => {
	state.created = 0;
	state.verified = 0;
	vi.clearAllMocks();
});

describe('telegram widget callback', () => {
	it('does not sign anyone in when the browser has no flow cookie', async () => {
		const { default: handler } = await import('../api/auth/telegram/[action].js');
		const req = {
			method: 'GET',
			url: '/api/auth/telegram/callback?id=1&hash=x&auth_date=1',
			headers: { host: 'three.ws' },
			query: { action: 'callback' },
		};
		const res = makeRes();
		await handler(req, res);
		expect(state.created).toBe(0);
		expect(String(res.headers.location || '')).toContain('/login');
		expect(String(res.headers['set-cookie'] || '')).not.toContain('__Host-sid');
	});
});

describe('saml acs', () => {
	it('does not sign anyone in when the browser did not start the login', async () => {
		vi.doMock('../api/_lib/saml.js', async (orig) => {
			const real = await orig();
			return {
				...real,
				samlConfigured: () => true,
				getSamlInstance: async () => ({
					validatePostResponseAsync: async () => {
						state.samlValidated++;
						return { profile: { nameID: 'attacker', issuer: 'idp' } };
					},
				}),
				extractSamlIdentity: () => ({ nameID: 'attacker', issuer: 'idp', email: 'a@x.io' }),
			};
		});
		vi.doMock('../api/_lib/http.js', async (orig) => ({
			...(await orig()),
			readForm: async () => ({ SAMLResponse: 'x', RelayState: await (await import('../api/_lib/saml.js')).signRelayState({ next: '/dashboard' }) }),
		}));
		const { default: handler } = await import('../api/auth/saml/[action].js');
		const req = { method: 'POST', url: '/api/auth/saml/acs', headers: {}, query: { action: 'acs' } };
		const res = makeRes();
		await handler(req, res);
		expect(state.created).toBe(0);
		expect(String(res.headers.location || '')).toContain('error=');
	});

	it('signs in when the cookie set at /login matches the RelayState', async () => {
		const { signRelayState } = await import('../api/_lib/saml.js');
		const relay = await signRelayState({ next: '/dashboard', n: 'x' });
		vi.doMock('../api/_lib/http.js', async (orig) => ({
			...(await orig()),
			readForm: async () => ({ SAMLResponse: 'x', RelayState: relay }),
		}));
		vi.resetModules();
		const { default: handler } = await import('../api/auth/saml/[action].js');
		const req = { method: 'POST', url: '/api/auth/saml/acs', headers: { cookie: `__Host-samlflow=${relay}` }, query: { action: 'acs' } };
		const res = makeRes();
		await handler(req, res);
		expect(state.created).toBe(1);
	});
});

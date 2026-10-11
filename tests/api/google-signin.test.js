// api/auth/google/[action].js: sign in with Google as a direct OIDC
// authorization-code flow with PKCE, with account linking by verified email
// behind a confirm step.
//
// Only the database and Google's two network calls (the code exchange and the
// ID-token verification) are doubled. The flow cookie, its HMAC, the state and
// nonce round trip, PKCE, session creation and the confirm cookie all run the
// production code in api/_lib/identities.js and api/_lib/auth.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../../api/_lib/streaks.js', () => ({ recordDailyActivity: vi.fn(async () => {}) }));
vi.mock('../../api/_lib/seed-default-agent.js', () => ({ seedDefaultAgent: vi.fn(async () => {}) }));
const rl = { authIp: true, identityLink: true };
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		authIp: vi.fn(async () => ({ success: rl.authIp })),
		identityLink: vi.fn(async () => ({ success: rl.identityLink })),
	},
	clientIp: () => '127.0.0.1',
}));

// ── in-memory users, identities and sessions ─────────────────────────────────
const db = { users: [], identities: [], sessions: [], wallets: [] };
let nextId = 1;

const sqlMock = vi.fn(async (strings, ...values) => {
	const text = strings.join('?').replace(/\s+/g, ' ').trim();
	if (text.startsWith('select u.id, u.deleted_at, i.id as identity_id from user_identities')) {
		const [provider, subject] = values;
		const i = db.identities.find((r) => r.provider === provider && r.subject === subject);
		if (!i) return [];
		const u = db.users.find((r) => r.id === i.user_id);
		return [{ id: u.id, deleted_at: u.deleted_at, identity_id: i.id }];
	}
	if (text.startsWith('update user_identities set last_used_at')) return [];
	if (text.startsWith('select subject from user_identities where user_id')) {
		const [userId, provider] = values;
		return db.identities.filter((r) => r.user_id === userId && r.provider === provider).map((r) => ({ subject: r.subject }));
	}
	if (text.startsWith('insert into user_identities')) {
		const [user_id, provider, subject, email, email_verified, display_name, avatar_url] = values;
		let row = db.identities.find((r) => r.user_id === user_id && r.provider === provider);
		if (row) Object.assign(row, { email, email_verified, display_name, avatar_url });
		else { row = { id: `ident-${nextId++}`, user_id, provider, subject, email, email_verified, display_name, avatar_url, linked_at: new Date().toISOString(), last_used_at: null }; db.identities.push(row); }
		return [{ id: row.id, provider, email, linked_at: row.linked_at }];
	}
	if (text.startsWith('select email from user_identities where user_id')) {
		const [userId, provider] = values;
		return db.identities.filter((r) => r.user_id === userId && r.provider === provider).map((r) => ({ email: r.email }));
	}
	if (text.startsWith('select id, deleted_at, email_verified from users where email')) {
		const [email] = values;
		return db.users.filter((u) => u.email === email).map(({ id, deleted_at, email_verified }) => ({ id, deleted_at, email_verified }));
	}
	if (text.startsWith('select id, deleted_at, email_verified from users where id')) {
		const [id] = values;
		return db.users.filter((u) => u.id === id).map(({ id, deleted_at, email_verified }) => ({ id, deleted_at, email_verified }));
	}
	if (text.startsWith('insert into users (email, display_name, email_verified)')) {
		const [email, display_name] = values;
		let u = db.users.find((r) => r.email === email);
		if (u) u.email_verified = true;
		else { u = { id: `user-${nextId++}`, email, display_name, email_verified: true, deleted_at: null, password_hash: null, privy_did: null }; db.users.push(u); }
		return [{ id: u.id, deleted_at: u.deleted_at }];
	}
	if (text.startsWith('insert into sessions')) {
		const [user_id, token_hash] = values;
		db.sessions.push({ user_id, token_hash });
		return [];
	}
	if (text.startsWith('select email, password_hash is not null as has_password')) {
		const [id] = values;
		return db.users.filter((u) => u.id === id).map((u) => ({ email: u.email, has_password: Boolean(u.password_hash), has_privy: Boolean(u.privy_did) }));
	}
	if (text.startsWith('select address, chain_type')) {
		const [id] = values;
		return db.wallets.filter((w) => w.user_id === id);
	}
	if (text.startsWith('select provider, email, email_verified, display_name, linked_at, last_used_at from user_identities')) {
		const [id] = values;
		return db.identities.filter((r) => r.user_id === id);
	}
	if (text.startsWith('select password_hash from users where id')) {
		const [id] = values;
		return db.users.filter((u) => u.id === id).map((u) => ({ password_hash: u.password_hash }));
	}
	if (text.startsWith('delete from user_identities where user_id')) {
		const [userId, provider] = values;
		const gone = db.identities.filter((r) => r.user_id === userId && r.provider === provider);
		db.identities = db.identities.filter((r) => !gone.includes(r));
		return gone.map((r) => ({ id: r.id }));
	}
	throw new Error(`unmodeled query: ${text}`);
});
vi.mock('../../api/_lib/db.js', () => ({
	sql: (strings, ...values) => sqlMock(strings, ...values),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

const getSessionUser = vi.fn();
vi.mock('../../api/_lib/auth.js', async () => {
	const actual = await vi.importActual('../../api/_lib/auth.js');
	return { ...actual, getSessionUser: (...args) => getSessionUser(...args), verifyPassword: async (plain, hash) => hash === `hash:${plain}` };
});

// Google's network: the exchange hands back an opaque id_token string; the
// verifier turns it into claims. Tests set `google.claims` per case; the real
// nonce check is reproduced by comparing against the flow's nonce.
const google = { claims: null, exchange: vi.fn(), verify: vi.fn() };
vi.mock('../../api/_lib/identities.js', async () => {
	const actual = await vi.importActual('../../api/_lib/identities.js');
	return {
		...actual,
		exchangeGoogleCode: (...args) => google.exchange(...args),
		verifyGoogleIdToken: (...args) => google.verify(...args),
	};
});

const { default: handler } = await import('../../api/auth/google/[action].js');
const { FLOW_COOKIE, REAUTH_COOKIE, IdentityError, readCookie } = await import('../../api/_lib/identities.js');

// ── request/response doubles ─────────────────────────────────────────────────
function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b === undefined ? '' : b; };
	Object.defineProperty(r, 'body', { get: () => r._b ?? '' });
	Object.defineProperty(r, 'json', { value: () => JSON.parse(r._b) });
	r.cookies = () => [].concat(r._h['set-cookie'] || []);
	return r;
}

async function call(action, { method = 'GET', query = {}, form, jsonBody, headers = {}, cookie = '' } = {}) {
	const search = new URLSearchParams({ action, ...query }).toString();
	const req = {
		method,
		url: `/api/auth/google/${action}?${search}`,
		query: { action, ...query },
		headers: { origin: 'https://three.ws', accept: 'text/html', 'sec-fetch-mode': 'navigate', cookie, ...headers },
		socket: { remoteAddress: '127.0.0.1' },
	};
	if (form) {
		req.method = 'POST';
		req.headers['sec-fetch-mode'] = 'navigate';
		req.headers['content-type'] = 'application/x-www-form-urlencoded';
		req.body = new URLSearchParams(form).toString();
	} else if (jsonBody) {
		req.method = 'POST';
		req.headers['content-type'] = 'application/json';
		req.body = JSON.stringify(jsonBody);
	}
	const res = makeRes();
	await handler(req, res);
	return res;
}

// The cookie string a browser would send back from a Set-Cookie list.
const jar = (res) => res.cookies().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

const CLAIMS = { subject: 'g-sub-1', email: 'ada@example.com', email_verified: true, display_name: 'Ada', avatar_url: null };

function configure(on = true) {
	if (on) { process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client.apps.googleusercontent.com'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret'; }
	else { delete process.env.GOOGLE_OAUTH_CLIENT_ID; delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; }
}

// Start a flow and drive Google's redirect back with the flow's own state.
async function roundTrip({ intent = 'login', next, claims = CLAIMS, sessionCookie = '', googleError } = {}) {
	const start = await call('start', { query: { intent, ...(next ? { next } : {}) }, cookie: sessionCookie });
	expect(start.statusCode).toBe(302);
	const authUrl = new URL(start.getHeader('location'));
	const state = authUrl.searchParams.get('state');
	const nonce = authUrl.searchParams.get('nonce');
	google.exchange.mockImplementation(async ({ code, verifier }) => {
		expect(code).toBe('code-from-google');
		expect(typeof verifier).toBe('string');
		return 'id-token';
	});
	google.verify.mockImplementation(async (idToken, opts) => {
		expect(idToken).toBe('id-token');
		if (opts.nonce !== nonce) throw new IdentityError('invalid_token', 'nonce mismatch', 401);
		if (claims instanceof Error) throw claims;
		return claims;
	});
	const cookie = [sessionCookie, jar(start)].filter(Boolean).join('; ');
	const query = googleError ? { state, error: googleError } : { state, code: 'code-from-google' };
	const cb = await call('callback', { query, cookie });
	return { start, authUrl, cb, cookie };
}

beforeEach(() => {
	configure(true);
	db.users.length = 0;
	db.identities.length = 0;
	db.sessions.length = 0;
	db.wallets.length = 0;
	rl.authIp = true;
	rl.identityLink = true;
	google.exchange.mockReset();
	google.verify.mockReset();
	getSessionUser.mockReset();
	getSessionUser.mockResolvedValue(null);
});

describe('GET /api/auth/google/start', () => {
	it('sends the browser to Google with PKCE S256, a nonce, a state and the flow cookie', async () => {
		const res = await call('start', { query: { next: '/oauth/consent?client_id=x' } });
		expect(res.statusCode).toBe(302);
		const url = new URL(res.getHeader('location'));
		expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(url.searchParams.get('client_id')).toBe('test-client.apps.googleusercontent.com');
		expect(url.searchParams.get('redirect_uri')).toBe('https://three.ws/api/auth/google/callback');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('scope')).toBe('openid email profile');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{16,}$/);
		expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{16,}$/);
		expect(url.searchParams.get('prompt')).toBe('select_account');
		const flow = res.cookies().find((c) => c.startsWith(`${FLOW_COOKIE}=`));
		expect(flow).toContain('HttpOnly');
		expect(flow).toContain('Secure');
		expect(flow).not.toContain(url.searchParams.get('code_challenge'));
	});

	it('sends a browser back to /login with a known error when Google is not configured', async () => {
		configure(false);
		const res = await call('start', { query: { next: '/dashboard' } });
		expect(res.statusCode).toBe(302);
		expect(res.getHeader('location')).toBe('/login?error=google_unavailable&next=%2Fdashboard');
	});

	it('answers an API caller 501 not_configured when Google is not configured', async () => {
		configure(false);
		const res = await call('start', { headers: { accept: 'application/json', 'sec-fetch-mode': 'cors' } });
		expect(res.statusCode).toBe(501);
		expect(res.json().error).toBe('not_configured');
	});

	it('rejects an unknown intent', async () => {
		const res = await call('start', { query: { intent: 'merge' } });
		expect(res.statusCode).toBe(400);
	});

	it('needs a session to link or re-authenticate', async () => {
		const res = await call('start', { query: { intent: 'link' } });
		expect(res.statusCode).toBe(302);
		expect(res.getHeader('location')).toBe('/login?next=%2Fdashboard%2Fsettings%23sign-in-methods');
	});

	it('forces fresh credentials and hints the linked address on reauth', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null, password_hash: null, privy_did: null });
		db.identities.push({ id: 'ident-1', user_id: 'user-1', provider: 'google', subject: 'g-sub-1', email: 'ada@gmail.example', email_verified: true, linked_at: new Date().toISOString() });
		getSessionUser.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
		const res = await call('start', { query: { intent: 'reauth' } });
		const url = new URL(res.getHeader('location'));
		expect(url.searchParams.get('prompt')).toBe('login');
		expect(url.searchParams.get('max_age')).toBe('0');
		expect(url.searchParams.get('login_hint')).toBe('ada@gmail.example');
	});
});

describe('GET /api/auth/google/callback', () => {
	it('signs a linked Google account straight in and lands on the requested page', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null });
		db.identities.push({ id: 'ident-1', user_id: 'user-1', provider: 'google', subject: 'g-sub-1', email: 'ada@example.com' });
		const { cb } = await roundTrip({ next: '/oauth/consent?client_id=mcp_x' });
		expect(cb.statusCode).toBe(302);
		expect(cb.getHeader('location')).toBe('/oauth/consent?client_id=mcp_x');
		expect(cb.cookies().some((c) => c.startsWith('__Host-sid='))).toBe(true);
		expect(db.sessions).toHaveLength(1);
		expect(db.sessions[0].user_id).toBe('user-1');
	});

	it('does not sign anyone in when the state does not match the flow cookie', async () => {
		const start = await call('start');
		const cb = await call('callback', { query: { state: 'forged', code: 'code-from-google' }, cookie: jar(start) });
		expect(cb.getHeader('location')).toBe('/login?error=google_expired');
		expect(google.exchange).not.toHaveBeenCalled();
		expect(db.sessions).toHaveLength(0);
	});

	it('reports a cancelled Google prompt as a clean, known error', async () => {
		const { cb } = await roundTrip({ googleError: 'access_denied', next: '/dashboard' });
		expect(cb.getHeader('location')).toBe('/login?error=google_cancelled&next=%2Fdashboard');
		expect(google.exchange).not.toHaveBeenCalled();
	});

	it('refuses an ID token whose nonce does not match', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null });
		const { cb } = await roundTrip({ claims: new IdentityError('invalid_token', 'nonce mismatch', 401) });
		expect(cb.getHeader('location')).toContain('/login?error=google_invalid_token');
		expect(db.sessions).toHaveLength(0);
	});

	it('asks before linking Google to an existing account that verified the same email', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null });
		const { cb } = await roundTrip({ next: '/oauth/consent?client_id=mcp_x' });
		expect(cb.statusCode).toBe(200);
		expect(cb.getHeader('content-type')).toContain('text/html');
		expect(cb.body).toContain('Link Google to your account?');
		expect(cb.body).toContain('ada@example.com');
		expect(cb.body).toContain('action="/api/auth/google/confirm"');
		expect(cb.cookies().some((c) => c.startsWith('__Host-glink='))).toBe(true);
		expect(db.identities).toHaveLength(0);
		expect(db.sessions).toHaveLength(0);
	});

	it('never links by email when Google did not verify the address', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null });
		const { cb } = await roundTrip({ claims: { ...CLAIMS, email_verified: false } });
		expect(cb.getHeader('location')).toBe('/login?error=google_email_unverified&next=%2Fdashboard');
		expect(db.identities).toHaveLength(0);
	});

	it('never links by email to an account this platform has not verified', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: false, deleted_at: null });
		const { cb } = await roundTrip();
		expect(cb.getHeader('location')).toBe('/login?error=google_unverified_account&next=%2Fdashboard');
		expect(db.identities).toHaveLength(0);
	});

	it('creates a verified, passwordless account for a brand-new Google user', async () => {
		const { cb } = await roundTrip({ next: '/dashboard' });
		expect(cb.getHeader('location')).toBe('/dashboard');
		expect(db.users).toHaveLength(1);
		expect(db.users[0]).toMatchObject({ email: 'ada@example.com', display_name: 'Ada', email_verified: true });
		expect(db.identities[0]).toMatchObject({ user_id: db.users[0].id, provider: 'google', subject: 'g-sub-1' });
		expect(db.sessions[0].user_id).toBe(db.users[0].id);
	});

	it('links Google to the signed-in account on the link intent', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null });
		getSessionUser.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
		const { cb } = await roundTrip({ intent: 'link', sessionCookie: '__Host-sid=s1' });
		expect(cb.getHeader('location')).toBe('/dashboard/settings?google=linked#sign-in-methods');
		expect(db.identities[0]).toMatchObject({ user_id: 'user-1', subject: 'g-sub-1' });
		expect(db.sessions).toHaveLength(0);
	});

	it('refuses to link a Google account that another three.ws account already uses', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null }, { id: 'user-2', email: 'bob@example.com', email_verified: true, deleted_at: null });
		db.identities.push({ id: 'ident-1', user_id: 'user-2', provider: 'google', subject: 'g-sub-1', email: 'ada@example.com' });
		getSessionUser.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
		const { cb } = await roundTrip({ intent: 'link', sessionCookie: '__Host-sid=s1' });
		expect(cb.getHeader('location')).toBe('/dashboard/settings?google=identity_in_use#sign-in-methods');
	});

	it('grants the unlink proof on reauth only for the linked Google account', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null });
		db.identities.push({ id: 'ident-1', user_id: 'user-1', provider: 'google', subject: 'g-sub-1', email: 'ada@example.com' });
		getSessionUser.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
		const ok = await roundTrip({ intent: 'reauth', sessionCookie: '__Host-sid=s1' });
		expect(ok.cb.getHeader('location')).toBe('/dashboard/settings?google=reauthenticated#sign-in-methods');
		expect(ok.cb.cookies().some((c) => c.startsWith(`${REAUTH_COOKIE}=`))).toBe(true);
		const other = await roundTrip({ intent: 'reauth', sessionCookie: '__Host-sid=s1', claims: { ...CLAIMS, subject: 'g-sub-other' } });
		expect(other.cb.getHeader('location')).toBe('/dashboard/settings?google=wrong_account#sign-in-methods');
	});

	it('returns a reauth started elsewhere to that page, marked confirmed', async () => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null });
		db.identities.push({ id: 'ident-1', user_id: 'user-1', provider: 'google', subject: 'g-sub-1', email: 'ada@example.com' });
		getSessionUser.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
		const { cb } = await roundTrip({ intent: 'reauth', sessionCookie: '__Host-sid=s1', next: '/commerce?tab=requests#request-r1' });
		expect(cb.getHeader('location')).toBe('/commerce?tab=requests&google=reauthenticated#request-r1');
	});
});

describe('POST /api/auth/google/confirm', () => {
	async function pendingConfirm() {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null });
		const { cb } = await roundTrip({ next: '/oauth/consent?client_id=mcp_x' });
		return jar(cb);
	}

	it('links and signs in on an explicit yes, then continues to the consent screen', async () => {
		const cookie = await pendingConfirm();
		const res = await call('confirm', { form: { decision: 'link' }, cookie });
		expect(res.statusCode).toBe(302);
		expect(res.getHeader('location')).toBe('/oauth/consent?client_id=mcp_x');
		expect(db.identities[0]).toMatchObject({ user_id: 'user-1', subject: 'g-sub-1' });
		expect(db.sessions[0].user_id).toBe('user-1');
		expect(res.cookies().some((c) => c.startsWith('__Host-glink=;'))).toBe(true);
	});

	it('changes nothing on "not my account"', async () => {
		const cookie = await pendingConfirm();
		const res = await call('confirm', { form: { decision: 'cancel' }, cookie });
		expect(res.getHeader('location')).toBe('/login?error=google_not_linked&next=%2Foauth%2Fconsent%3Fclient_id%3Dmcp_x');
		expect(db.identities).toHaveLength(0);
		expect(db.sessions).toHaveLength(0);
	});

	it('refuses a confirm without the signed pending cookie', async () => {
		const res = await call('confirm', { form: { decision: 'link' }, cookie: '__Host-glink=forged.sig' });
		expect(res.getHeader('location')).toBe('/login?error=google_expired');
		expect(db.sessions).toHaveLength(0);
	});
});

describe('status and unlink (settings card)', () => {
	beforeEach(() => {
		db.users.push({ id: 'user-1', email: 'ada@example.com', email_verified: true, deleted_at: null, password_hash: 'hash:pw', privy_did: null });
		db.identities.push({ id: 'ident-1', user_id: 'user-1', provider: 'google', subject: 'g-sub-1', email: 'ada@example.com', email_verified: true, linked_at: new Date().toISOString(), last_used_at: null });
		getSessionUser.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
	});

	it('reports every sign-in method and whether Google is configured', async () => {
		const res = await call('status', { headers: { accept: 'application/json' } });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ configured: true, password: true, email_code: false, wallets: 0, count: 2, reauthenticated: false });
		expect(res.json().google).toMatchObject({ provider: 'google', email: 'ada@example.com' });
	});

	it('unlinks with the account password', async () => {
		const res = await call('unlink', { jsonBody: { password: 'pw' } });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ unlinked: true, provider: 'google', remaining_methods: 1 });
		expect(db.identities).toHaveLength(0);
	});

	it('refuses to unlink without a fresh proof', async () => {
		const wrong = await call('unlink', { jsonBody: { password: 'nope' } });
		expect(wrong.statusCode).toBe(401);
		expect(wrong.json().error).toBe('reauth_required');
		const none = await call('unlink', { jsonBody: {} });
		expect(none.statusCode).toBe(401);
		expect(db.identities).toHaveLength(1);
	});

	it('accepts a fresh Google re-authentication as the proof', async () => {
		const { cb } = await roundTrip({ intent: 'reauth', sessionCookie: '__Host-sid=s1' });
		const reauth = jar(cb);
		expect(readCookie({ headers: { cookie: reauth } }, REAUTH_COOKIE)).toBeTruthy();
		const res = await call('unlink', { jsonBody: {}, cookie: reauth });
		expect(res.statusCode).toBe(200);
		expect(db.identities).toHaveLength(0);
	});

	it('never leaves an account with no way in', async () => {
		db.users[0].password_hash = null;
		const { cb } = await roundTrip({ intent: 'reauth', sessionCookie: '__Host-sid=s1' });
		const res = await call('unlink', { jsonBody: {}, cookie: jar(cb) });
		expect(res.statusCode).toBe(409);
		expect(res.json().error).toBe('last_sign_in_method');
		expect(db.identities).toHaveLength(1);
	});
});

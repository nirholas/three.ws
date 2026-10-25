// Account recovery must cut off every credential an attacker could still hold,
// not only browser sessions: API keys, access tokens already in flight (the
// stateless JWTs honoured through oauth_client_revocations), and the walk
// extension token. Logout-everywhere does the same except it keeps API keys
// unless the caller opts in.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));

const statements = [];
const sqlMock = vi.fn(async (strings, ...values) => {
	const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
	statements.push({ text: text.replace(/\s+/g, ' ').trim(), values });
	if (text.includes('update password_resets')) return [{ id: 'pr-1', user_id: 'user-1' }];
	if (text.includes('update api_keys')) return [{ id: 'key-1' }, { id: 'key-2' }];
	if (text.includes('update sessions')) return [{ id: 's-1' }];
	return [];
});
vi.mock('../api/_lib/db.js', () => ({ sql: (strings, ...values) => sqlMock(strings, ...values) }));

const getSessionUser = vi.fn();
vi.mock('../api/_lib/auth.js', async () => {
	const actual = await vi.importActual('../api/_lib/auth.js');
	return {
		...actual,
		getSessionUser: (...args) => getSessionUser(...args),
		hashPassword: vi.fn(async () => 'hash'),
		sessionCookie: vi.fn(() => ['__Host-sid=; Path=/; Max-Age=0']),
	};
});
const invalidateApiKey = vi.fn(async () => {});
vi.mock('../api/_lib/api-key-cache.js', async () => {
	const actual = await vi.importActual('../api/_lib/api-key-cache.js');
	return { ...actual, invalidateApiKey: (...a) => invalidateApiKey(...a) };
});
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/email.js', () => ({ sendPasswordResetEmail: vi.fn(async () => {}), sendVerificationEmail: vi.fn(async () => {}) }));
vi.mock('../api/_lib/seed-default-agent.js', () => ({ seedDefaultAgent: vi.fn() }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../api/_lib/legal.js', () => ({ tosAcceptanceFromBody: vi.fn(() => null), recordTosAcceptance: vi.fn(), TOS_VERSION: 2 }));

const { default: handler } = await import('../api/auth/[action].js');

function makeReq(action, body) {
	return {
		method: 'POST',
		url: `/api/auth/${action}`,
		query: { action },
		headers: { 'content-type': 'application/json', origin: 'https://three.ws' },
		socket: { remoteAddress: '127.0.0.1' },
		body: body === undefined ? undefined : JSON.stringify(body),
	};
}
function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b; };
	Object.defineProperty(r, 'json', { value: () => JSON.parse(r._b) });
	return r;
}
const written = (fragment) => statements.filter((s) => s.text.includes(fragment));

beforeEach(() => {
	statements.length = 0;
	sqlMock.mockClear();
	invalidateApiKey.mockClear();
	getSessionUser.mockReset();
	getSessionUser.mockResolvedValue({ id: 'user-1' });
});

describe('POST /api/auth/reset-password', () => {
	async function reset() {
		const res = makeRes();
		await handler(makeReq('reset-password', { token: 'a'.repeat(32), password: 'CorrectHorse!Battery9' }), res);
		expect(res.statusCode).toBe(200);
	}

	it('revokes the account API keys and evicts them from the key cache', async () => {
		await reset();
		expect(written('update api_keys set revoked_at')).toHaveLength(1);
		expect(invalidateApiKey).toHaveBeenCalledWith('key-1');
		expect(invalidateApiKey).toHaveBeenCalledWith('key-2');
	});

	it('stamps access-token cutoffs, including the walk extension token', async () => {
		await reset();
		const [cut] = written('insert into oauth_client_revocations');
		expect(cut).toBeTruthy();
		expect(cut.values).toEqual(expect.arrayContaining(['user-1', 'walk-extension']));
		expect(written('update sessions set revoked_at')).toHaveLength(1);
		expect(written('update oauth_refresh_tokens set revoked_at')).toHaveLength(1);
	});
});

describe('POST /api/auth/logout-everywhere', () => {
	it('revokes access tokens but keeps API keys by default', async () => {
		const res = makeRes();
		await handler(makeReq('logout-everywhere', {}), res);
		expect(res.statusCode).toBe(200);
		expect(written('insert into oauth_client_revocations')).toHaveLength(1);
		expect(written('update api_keys')).toHaveLength(0);
		expect(invalidateApiKey).not.toHaveBeenCalled();
	});

	it('revokes API keys too when asked', async () => {
		const res = makeRes();
		await handler(makeReq('logout-everywhere', { include_keys: true }), res);
		expect(res.statusCode).toBe(200);
		expect(written('update api_keys set revoked_at')).toHaveLength(1);
		expect(invalidateApiKey).toHaveBeenCalledTimes(2);
	});
});

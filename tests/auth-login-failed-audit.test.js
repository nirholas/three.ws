// Microsoft 365 Certification OS 17: invalid access attempts must be logged.
// A failed password login writes a login_failed audit row that names the
// account when it exists, never stores the submitted identifier in clear,
// and never stores the password.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { rows: [] };
const logAudit = vi.fn();

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => state.rows),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/auth.js', () => ({
	verifyPassword: vi.fn(async () => false),
	hashPassword: vi.fn(),
	createSession: vi.fn(),
	destroySession: vi.fn(),
	sessionCookie: vi.fn(),
	getSessionUser: vi.fn(),
	hasSessionCookie: vi.fn(),
	revokeRefreshToken: vi.fn(),
	revokeAccountCredentials: vi.fn(),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit }));
vi.mock('../api/_lib/rate-limit.js', async () => {
	const real = await vi.importActual('../api/_lib/rate-limit.js');
	return {
		...real,
		clientIp: () => '203.0.113.9',
		limits: new Proxy({}, { get: () => async () => ({ success: true, reset: 1000 }) }),
	};
});

const { default: handler } = await import('../api/auth/[action].js');
const { sha256 } = await import('../api/_lib/crypto.js');

function mkReq(email, password = 'hunter2-wrong') {
	const raw = Buffer.from(JSON.stringify({ email, password }));
	return {
		method: 'POST',
		url: '/api/auth/login',
		query: { action: 'login' },
		headers: { 'content-type': 'application/json' },
		socket: { remoteAddress: '127.0.0.1' },
		on(event, cb) {
			if (event === 'data') queueMicrotask(() => { cb(raw); this._end?.(); });
			else if (event === 'end') this._end = cb;
			return this;
		},
		destroy() {},
	};
}
function mkRes() {
	return {
		statusCode: 200, headers: {}, body: '',
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(b) { this.body = b; this.writableEnded = true; },
	};
}

beforeEach(() => { logAudit.mockClear(); state.rows = []; });

describe('failed login audit', () => {
	it('writes login_failed against the existing account on a wrong password', async () => {
		state.rows = [{ id: 'u-1', email: 'victim@example.com', password_hash: '$2b$11$x' }];
		const res = mkRes();
		await handler(mkReq('Victim@Example.com'), res);
		expect(res.statusCode).toBe(401);
		expect(logAudit).toHaveBeenCalledTimes(1);
		const entry = logAudit.mock.calls[0][0];
		expect(entry.action).toBe('login_failed');
		expect(entry.userId).toBe('u-1');
		expect(entry.meta.account_hash).toBe(await sha256('victim@example.com'));
		expect(entry.meta.known_account).toBe(true);
		expect(JSON.stringify(entry.meta)).not.toContain('victim');
		expect(JSON.stringify(entry.meta)).not.toContain('hunter2');
	});

	it('writes login_failed with no user for an unknown account', async () => {
		const res = mkRes();
		await handler(mkReq('nobody@example.com'), res);
		expect(res.statusCode).toBe(401);
		const entry = logAudit.mock.calls[0][0];
		expect(entry.action).toBe('login_failed');
		expect(entry.userId ?? null).toBeNull();
		expect(entry.meta.known_account).toBe(false);
	});
});

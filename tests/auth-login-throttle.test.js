// Login throttling: the per-IP bucket alone is bypassed by an attacker who
// rotates addresses (especially across an IPv6 /64) while guessing one
// account's password. Login also needs a per-account bucket, and IPv6
// callers must share a bucket per /64.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const accountCalls = [];
const state = { accountOk: true };

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
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
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/rate-limit.js', async () => {
	const real = await vi.importActual('../api/_lib/rate-limit.js');
	return {
		...real,
		clientIp: () => '2001:db8:aaaa:bbbb:1:2:3:4',
		limits: new Proxy({}, {
			get: (_, name) => async (key) => {
				if (name === 'authAccount') {
					accountCalls.push(key);
					return { success: state.accountOk, reset: 1000 };
				}
				return { success: true, reset: 1000 };
			},
		}),
	};
});

const { default: handler } = await import('../api/auth/[action].js');
const { ipRateKey } = await import('../api/_lib/rate-limit.js');

function mkReq(email) {
	const raw = Buffer.from(JSON.stringify({ email, password: 'x' }));
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

beforeEach(() => { accountCalls.length = 0; state.accountOk = true; });

describe('ipRateKey', () => {
	it('collapses an IPv6 address to its /64 and leaves IPv4 alone', () => {
		expect(ipRateKey('2001:db8:aaaa:bbbb:1:2:3:4')).toBe(ipRateKey('2001:db8:aaaa:bbbb:ffff::9'));
		expect(ipRateKey('2001:db8:aaaa:bbbb:1:2:3:4')).not.toBe(ipRateKey('2001:db8:aaaa:cccc:1:2:3:4'));
		expect(ipRateKey('203.0.113.9')).toBe('203.0.113.9');
	});
});

describe('login per-account throttle', () => {
	it('charges a bucket keyed on the normalised account, not the raw email', async () => {
		await handler(mkReq('Victim@Example.com'), mkRes());
		await handler(mkReq('victim@example.com'), mkRes());
		expect(accountCalls).toHaveLength(2);
		expect(accountCalls[0]).toBe(accountCalls[1]);
		expect(accountCalls[0]).not.toContain('@');
	});

	it('answers 429 once the account bucket is spent', async () => {
		state.accountOk = false;
		const res = mkRes();
		await handler(mkReq('victim@example.com'), res);
		expect(res.statusCode).toBe(429);
	});
});

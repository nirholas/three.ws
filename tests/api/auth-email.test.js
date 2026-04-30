// Tests for email/password auth endpoints: login, logout, register.
// Dispatched via api/auth/[action].js.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

process.env.PUBLIC_APP_ORIGIN ||= 'https://app.test';
process.env.JWT_SECRET ||= 'test-email-auth-secret-at-least-32ch';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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
	limits: {
		authIp: vi.fn(async () => ({ success: rlState.success })),
		registerIp: vi.fn(async () => ({ success: rlState.success })),
	},
	clientIp: () => '127.0.0.1',
}));

const authMock = {
	sessionToken: 'test-session-token-abc',
	verifyPassword: true,
};

vi.mock('../../api/_lib/auth.js', () => ({
	verifyPassword: vi.fn(async () => authMock.verifyPassword),
	hashPassword: vi.fn(async (p) => `hashed:${p}`),
	createSession: vi.fn(async () => authMock.sessionToken),
	destroySession: vi.fn(async () => {}),
	sessionCookie: vi.fn((token, opts) => {
		if (opts?.clear) {
			return [
				'__Host-sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
				'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
			];
		}
		return `__Host-sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
	}),
	getSessionUser: vi.fn(async () => null),
	revokeRefreshToken: vi.fn(async () => {}),
}));

vi.mock('../../api/_lib/email.js', () => ({
	sendPasswordResetEmail: vi.fn(async () => {}),
	sendVerificationEmail: vi.fn(async () => {}),
	sendWelcomeEmail: vi.fn(async () => {}),
}));

const { default: handler } = await import('../../api/auth/[action].js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq({ action, body = null, headers = {} } = {}) {
	const bodyStr = body ? JSON.stringify(body) : '';
	const base = Readable.from([Buffer.from(bodyStr)]);
	base.method = 'POST';
	base.url = `/api/auth/${action}`;
	base.query = { action };
	base.headers = {
		host: 'app.test',
		...(body !== null ? { 'content-type': 'application/json' } : {}),
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
	let json = null;
	try {
		json = JSON.parse(res.body);
	} catch {
		json = res.body;
	}
	return { res, status: res.statusCode, body: json };
}

const USER_ROW = {
	id: 'user-1',
	email: 'alice@example.com',
	password_hash: 'bcrypt-hash',
	display_name: 'Alice',
	plan: 'free',
	avatar_url: null,
};

beforeEach(() => {
	sqlState.queue = [];
	sqlState.calls = [];
	rlState.success = true;
	authMock.verifyPassword = true;
	authMock.sessionToken = 'test-session-token-abc';
	vi.mocked((await import('../../api/_lib/auth.js')).destroySession).mockClear();
	vi.mocked((await import('../../api/_lib/auth.js')).createSession).mockClear();
});

// ── login ──────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
	it('returns 200 with user and sets session cookie on valid credentials', async () => {
		sqlState.queue.push([USER_ROW]);
		const { status, body, res } = await invoke({
			action: 'login',
			body: { email: 'alice@example.com', password: 'correctpassword' },
		});
		expect(status).toBe(200);
		expect(body.user).toBeDefined();
		expect(body.user.id).toBe('user-1');
		expect(body.user.email).toBe('alice@example.com');
		expect(body.user.password_hash).toBeUndefined();
		const cookie = res.headers['set-cookie'];
		expect(cookie).toContain('__Host-sid=test-session-token-abc');
	});

	it('returns 401 for wrong password', async () => {
		sqlState.queue.push([USER_ROW]);
		authMock.verifyPassword = false;
		const { status, body } = await invoke({
			action: 'login',
			body: { email: 'alice@example.com', password: 'wrongpassword' },
		});
		expect(status).toBe(401);
		expect(body.error).toBe('invalid_credentials');
	});

	it('returns 401 when email is not found', async () => {
		sqlState.queue.push([]); // no user row
		const { status, body } = await invoke({
			action: 'login',
			body: { email: 'nobody@example.com', password: 'anypassword' },
		});
		expect(status).toBe(401);
		expect(body.error).toBe('invalid_credentials');
	});

	it('returns 429 when rate limited', async () => {
		rlState.success = false;
		const { status, body } = await invoke({
			action: 'login',
			body: { email: 'alice@example.com', password: 'pw' },
		});
		expect(status).toBe(429);
		expect(body.error).toBe('rate_limited');
	});
});

// ── logout ─────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
	it('returns 200 and clears session cookie', async () => {
		const { status, body, res } = await invoke({ action: 'logout' });
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		const cookies = res.headers['set-cookie'];
		const cookieList = Array.isArray(cookies) ? cookies : [cookies];
		expect(cookieList.some((c) => c.includes('Max-Age=0'))).toBe(true);
	});

	it('calls destroySession', async () => {
		const { destroySession } = await import('../../api/_lib/auth.js');
		vi.mocked(destroySession).mockClear();
		await invoke({ action: 'logout' });
		expect(vi.mocked(destroySession)).toHaveBeenCalledOnce();
	});
});

// ── register ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
	it('creates a user and returns 201 with session cookie', async () => {
		sqlState.queue.push([]); // no existing user
		sqlState.queue.push([{ id: 'user-new', display_name: 'Bob', plan: 'free', created_at: '2024-01-01' }]);
		const { status, body, res } = await invoke({
			action: 'register',
			body: { email: 'bob@example.com', password: 'supersecret123', display_name: 'Bob' },
		});
		expect(status).toBe(201);
		expect(body.user).toBeDefined();
		expect(body.user.id).toBe('user-new');
		const cookie = res.headers['set-cookie'];
		expect(cookie).toContain('__Host-sid=test-session-token-abc');
	});

	it('returns 409 when email is already registered', async () => {
		sqlState.queue.push([{ id: 'existing-user' }]); // existing user found
		const { status, body } = await invoke({
			action: 'register',
			body: { email: 'alice@example.com', password: 'supersecret123' },
		});
		expect(status).toBe(409);
		expect(body.error).toBe('conflict');
	});

	it('returns 400 for short password (< 10 chars)', async () => {
		const { status, body } = await invoke({
			action: 'register',
			body: { email: 'new@example.com', password: 'short' },
		});
		expect(status).toBe(400);
		expect(body.error).toBeDefined();
	});

	it('returns 429 when rate limited', async () => {
		rlState.success = false;
		const { status, body } = await invoke({
			action: 'register',
			body: { email: 'new@example.com', password: 'supersecret123' },
		});
		expect(status).toBe(429);
		expect(body.error).toBe('rate_limited');
	});
});

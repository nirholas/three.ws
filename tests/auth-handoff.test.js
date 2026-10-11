// /api/auth/handoff: the session hop from the iOS app into Safari.
//
// The code in the URL is a bearer credential for a whole account, so what these
// tests pin is everything that keeps it from being one for long: it is minted
// only from three.ws for a signed-in session, it lands only on a three.ws path,
// and the exchange consumes it in the same statement that checks it. They also
// pin the signed-out bounce, the one form of the URL that carries no code,
// because it is what keeps a bare three.ws link from being claimed straight
// back by the app through universal links.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { user: null, consumeRow: null, queries: [], limited: false };

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => state.user),
	isSameSiteOrigin: (req) => req.headers.origin === 'https://three.ws',
	createSession: vi.fn(async () => 'fresh-session-token'),
	destroySession: vi.fn(async () => {}),
	sessionCookie: (token) => `__Host-sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`,
}));

vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		sessionHandoffUser: vi.fn(async () => ({ success: !state.limited })),
		authIp: vi.fn(async () => ({ success: !state.limited })),
	},
	clientIp: () => '203.0.113.7',
}));

vi.mock('../api/_lib/db.js', () => {
	const sql = vi.fn((strings, ...values) => {
		const text = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
		state.queries.push({ text, values });
		if (text.startsWith('update session_handoffs')) return Promise.resolve(state.consumeRow ? [state.consumeRow] : []);
		return Promise.resolve([]);
	});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const { default: handler, safeHandoffPath, HANDOFF_TTL_SEC } = await import('../api/auth/handoff.js');
const { createSession, destroySession } = await import('../api/_lib/auth.js');
const { sha256 } = await import('../api/_lib/crypto.js');

function makeRes() {
	return {
		statusCode: 200,
		payload: null,
		headers: {},
		setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this.headers[String(k).toLowerCase()]; },
		removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
		writeHead(code) { this.statusCode = code; return this; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		end(chunk) {
			if (chunk) { try { this.payload = JSON.parse(String(chunk)); } catch { this.payload = String(chunk); } }
			return this;
		},
	};
}

async function mint(body, { origin = 'https://three.ws' } = {}) {
	const raw = Buffer.from(JSON.stringify(body));
	const req = {
		method: 'POST',
		url: '/api/auth/handoff',
		headers: { 'content-type': 'application/json', origin },
		body,
		rawBody: raw,
	};
	const res = makeRes();
	await handler(req, res);
	return res;
}

async function open(query) {
	const req = { method: 'GET', url: `/api/auth/handoff?${query}`, headers: { 'user-agent': 'Safari' } };
	const res = makeRes();
	await handler(req, res);
	return res;
}

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.com' };

beforeEach(() => {
	state.user = null;
	state.consumeRow = null;
	state.queries = [];
	state.limited = false;
	vi.clearAllMocks();
});

describe('safeHandoffPath', () => {
	it('keeps a same-origin path with its query and hash', () => {
		expect(safeHandoffPath('/launch?mint=abc#top')).toBe('/launch?mint=abc#top');
	});

	it.each([
		['protocol-relative', '//evil.example/launch'],
		['backslash that browsers read as //', '/\\evil.example'],
		['absolute URL', 'https://evil.example/'],
		['scheme', 'javascript:alert(1)'],
		['relative path', 'launch'],
		['control character', '/launch\nSet-Cookie: x'],
		['empty', ''],
		['non-string', 42],
		['over 2048 characters', `/${'a'.repeat(2048)}`],
	])('refuses a %s', (_label, value) => {
		expect(safeHandoffPath(value)).toBeNull();
	});
});

describe('POST /api/auth/handoff (mint)', () => {
	it('refuses a request that is not from three.ws', async () => {
		state.user = USER;
		const res = await mint({ next: '/launch' }, { origin: 'https://evil.example' });
		expect(res.statusCode).toBe(403);
		expect(state.queries).toHaveLength(0);
	});

	it('requires a signed-in session', async () => {
		const res = await mint({ next: '/launch' });
		expect(res.statusCode).toBe(401);
		expect(state.queries).toHaveLength(0);
	});

	it('refuses a landing path off three.ws', async () => {
		state.user = USER;
		const res = await mint({ next: '//evil.example' });
		expect(res.statusCode).toBe(400);
		expect(res.payload.error).toBe('invalid_next');
	});

	it('is rate limited per user', async () => {
		state.user = USER;
		state.limited = true;
		const res = await mint({ next: '/launch' });
		expect(res.statusCode).toBe(429);
	});

	it('stores only the hash of a short-lived code and returns the Safari URL', async () => {
		state.user = USER;
		const before = Date.now();
		const res = await mint({ next: '/launch/paired?x=1' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['cache-control']).toBe('no-store');

		const url = new URL(res.payload.url);
		expect(url.origin).toBe('https://three.ws');
		expect(url.pathname).toBe('/api/auth/handoff');
		expect(url.searchParams.get('next')).toBe('/launch/paired?x=1');
		const code = url.searchParams.get('code');
		expect(code).toMatch(/^[A-Za-z0-9_-]{40,}$/);

		const insert = state.queries.find((q) => q.text.startsWith('insert into session_handoffs'));
		expect(insert).toBeTruthy();
		const [codeHash, userId, next, expiresAt] = insert.values;
		expect(codeHash).toBe(await sha256(code));
		expect(insert.values).not.toContain(code);
		expect(userId).toBe(USER.id);
		expect(next).toBe('/launch/paired?x=1');
		const ttl = new Date(expiresAt).getTime() - before;
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(HANDOFF_TTL_SEC * 1000 + 1000);
	});
});

describe('GET /api/auth/handoff (exchange)', () => {
	it('signs Safari in and lands on the stored path', async () => {
		state.consumeRow = { user_id: USER.id, next_path: '/launch' };
		const res = await open('code=' + 'a'.repeat(43) + '&next=%2Fpricing');
		expect(res.statusCode).toBe(302);
		// The stored path wins over the one in the URL, which only serves the
		// expired-code fallback.
		expect(res.headers.location).toBe('https://three.ws/launch');
		expect(res.headers['set-cookie']).toContain('fresh-session-token');
		expect(res.headers['referrer-policy']).toBe('no-referrer');
		expect(destroySession).toHaveBeenCalledOnce();
		expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: USER.id }));
	});

	it('consumes the code in the same statement that checks it', async () => {
		state.consumeRow = { user_id: USER.id, next_path: '/launch' };
		const code = 'b'.repeat(43);
		await open(`code=${code}`);
		const update = state.queries.find((q) => q.text.startsWith('update session_handoffs'));
		expect(update.text).toContain('consumed_at = now()');
		expect(update.text).toContain('consumed_at is null');
		expect(update.text).toContain('expires_at > now()');
		expect(update.text).toContain('deleted_at is null');
		expect(update.values).toContain(await sha256(code));
	});

	it('sends a used or expired code to sign in, keeping the destination', async () => {
		const res = await open('code=' + 'c'.repeat(43) + '&next=%2Flaunch');
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe('https://three.ws/login?error=handoff_expired&next=%2Flaunch');
		expect(res.headers['set-cookie']).toBeUndefined();
		expect(createSession).not.toHaveBeenCalled();
	});

	it('never redirects off three.ws, even for a hostile next', async () => {
		const res = await open('code=short&next=%2F%2Fevil.example');
		expect(res.headers.location).toBe('https://three.ws/login?error=handoff_expired&next=%2F');
	});

	it('bounces a signed-out visitor straight to the page, with no session change', async () => {
		const res = await open('next=%2Flaunch%3Fmint%3Dabc');
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe('https://three.ws/launch?mint=abc');
		expect(res.headers['set-cookie']).toBeUndefined();
		expect(state.queries).toHaveLength(0);
	});

	it('refuses to exchange while rate limited', async () => {
		state.limited = true;
		state.consumeRow = { user_id: USER.id, next_path: '/launch' };
		const res = await open('code=' + 'd'.repeat(43));
		expect(res.headers.location).toMatch(/^https:\/\/three\.ws\/login\?error=rate_limited/);
		expect(createSession).not.toHaveBeenCalled();
	});
});

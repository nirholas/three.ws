// POST /api/auth/verify-email and POST /api/auth/forgot-password abuse gates.
//
// verify-email used to match a 6-digit code against EVERY account's pending
// codes with no session, so the code space was shared: a caller holding many
// unverified sign-ups could verify one of them by guessing, never reading a
// mailbox. These tests pin that the code is checked only against the signed-in
// account, that the account has its own attempt budget, and that
// forgot-password caps a single sender across addresses.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));

const statements = [];
const pending = vi.hoisted(() => ({ rows: [] }));
const sqlMock = vi.fn(async (strings, ...values) => {
	const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
	statements.push({ text: text.replace(/\s+/g, ' ').trim(), values });
	if (text.includes('from email_verifications v')) {
		const [userId, codeHash] = values;
		return pending.rows.filter((r) => r.user_id === userId && r.code_hash === codeHash);
	}
	return [];
});
vi.mock('../api/_lib/db.js', () => ({ sql: (strings, ...values) => sqlMock(strings, ...values) }));

const getSessionUser = vi.fn();
vi.mock('../api/_lib/auth.js', async () => {
	const actual = await vi.importActual('../api/_lib/auth.js');
	return { ...actual, getSessionUser: (...args) => getSessionUser(...args) };
});

const verdicts = vi.hoisted(() => ({ verifyEmailUser: true, forgotPasswordIp: true }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		authIp: vi.fn(async () => ({ success: true })),
		verifyEmailIp: vi.fn(async () => ({ success: true })),
		verifyEmailUser: vi.fn(async () => ({ success: verdicts.verifyEmailUser, reset: Date.now() + 1000 })),
		forgotPasswordIp: vi.fn(async () => ({ success: verdicts.forgotPasswordIp, reset: Date.now() + 1000 })),
		forgotPasswordEmail: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/email.js', () => ({
	sendPasswordResetEmail: vi.fn(async () => {}),
	sendVerificationEmail: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/seed-default-agent.js', () => ({ seedDefaultAgent: vi.fn() }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));

const { default: handler } = await import('../api/auth/[action].js');
const { sha256 } = await import('../api/_lib/crypto.js');

const VICTIM = '11111111-1111-4111-8111-111111111111';
const ATTACKER = '22222222-2222-4222-8222-222222222222';

function makeReq(action, body) {
	return {
		method: 'POST',
		url: `/api/auth/${action}`,
		query: { action },
		headers: { 'content-type': 'application/json', origin: 'https://three.ws' },
		socket: { remoteAddress: '127.0.0.1' },
		body: JSON.stringify(body),
	};
}
function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b; };
	r.json = () => JSON.parse(r._b);
	return r;
}

beforeEach(async () => {
	statements.length = 0;
	getSessionUser.mockReset();
	verdicts.verifyEmailUser = true;
	verdicts.forgotPasswordIp = true;
	pending.rows = [{ id: 'v-1', user_id: VICTIM, code_hash: await sha256('123456') }];
});

describe('verify-email', () => {
	it('refuses an anonymous caller before touching any code', async () => {
		getSessionUser.mockResolvedValue(null);
		const res = makeRes();
		await handler(makeReq('verify-email', { code: '123456' }), res);
		expect(res.statusCode).toBe(401);
		expect(statements.some((s) => s.text.includes('email_verifications'))).toBe(false);
	});

	it("never verifies another account's pending code", async () => {
		getSessionUser.mockResolvedValue({ id: ATTACKER });
		const res = makeRes();
		await handler(makeReq('verify-email', { code: '123456' }), res);
		expect(res.statusCode).toBe(400);
		expect(statements.some((s) => s.text.startsWith('update users set email_verified'))).toBe(false);
	});

	it("verifies the signed-in account's own code", async () => {
		getSessionUser.mockResolvedValue({ id: VICTIM });
		const res = makeRes();
		await handler(makeReq('verify-email', { code: '123456' }), res);
		expect(res.statusCode).toBe(200);
		const update = statements.find((s) => s.text.startsWith('update users set email_verified'));
		expect(update.values).toContain(VICTIM);
	});

	it('stops guessing once the account budget is spent', async () => {
		getSessionUser.mockResolvedValue({ id: VICTIM });
		verdicts.verifyEmailUser = false;
		const res = makeRes();
		await handler(makeReq('verify-email', { code: '123456' }), res);
		expect(res.statusCode).toBe(429);
		expect(statements.some((s) => s.text.includes('email_verifications'))).toBe(false);
	});
});

describe('forgot-password', () => {
	it('caps one sender walking a list of addresses', async () => {
		verdicts.forgotPasswordIp = false;
		const res = makeRes();
		await handler(makeReq('forgot-password', { email: 'someone@example.com' }), res);
		expect(res.statusCode).toBe(429);
		expect(statements).toHaveLength(0);
	});
});

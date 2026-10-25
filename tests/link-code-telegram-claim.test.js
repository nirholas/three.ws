// The public link-code claim route must never accept a caller-described
// Telegram identity: it would bind an arbitrary chat to the minting account.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const queue = [];
const calls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: Object.assign(
		async (strings, ...vals) => {
			calls.push({ text: strings.join('?').replace(/\s+/g, ' '), vals });
			const next = queue.shift();
			return typeof next === 'function' ? next() : (next ?? []);
		},
		{ json: (v) => v },
	),
}));
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { linkCodeClaimIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.9',
}));

const lc = await import('../api/_lib/account-link/link-codes.js');
const { default: handler } = await import('../api/auth/link-codes/[action].js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b; };
	Object.defineProperty(r, 'json', { value: () => JSON.parse(r._b) });
	return r;
}
const claimReq = (body) => ({
	method: 'POST',
	url: '/api/auth/link-codes/claim',
	query: { action: 'claim' },
	headers: { 'content-type': 'application/json', 'user-agent': 'curl/8' },
	socket: { remoteAddress: '203.0.113.9' },
	body: JSON.stringify(body),
});

beforeEach(() => {
	queue.length = 0;
	calls.length = 0;
});

describe('link-code claim and Telegram identity', () => {
	it('describeClaim drops a self-described telegram identity', () => {
		const d = lc.describeClaim({ name: 'x', telegram: { chat_id: '777', platform_user_id: '777' } });
		expect(d).not.toHaveProperty('telegram');
	});

	it('the public claim route refuses a telegram code and stores nothing', async () => {
		queue.push([{ id: 'c1', status: 'issued', device_kind: 'telegram' }]);
		const res = makeRes();
		await handler(claimReq({ code: 'BCDF-GHJK', device_kind: 'telegram', device: { name: 'x', telegram: { chat_id: '777', platform_user_id: '777' } } }), res);
		expect(res.statusCode).toBe(409);
		expect(res.json().error).toBe('wrong_kind');
		expect(calls.some((c) => /set status = 'claimed'/.test(c.text))).toBe(false);
	});

	it('the public claim route refuses a telegram code even when the caller omits device_kind', async () => {
		queue.push([{ id: 'c1', status: 'issued', device_kind: 'telegram' }]);
		const res = makeRes();
		await handler(claimReq({ code: 'BCDF-GHJK', device: { telegram: { chat_id: '777', platform_user_id: '777' } } }), res);
		expect(res.statusCode).toBe(409);
		expect(calls.some((c) => /set status = 'claimed'/.test(c.text))).toBe(false);
	});

	it('the authenticated gateway path can still claim a telegram code with its own identity', async () => {
		queue.push([{ id: 'c1', status: 'issued', device_kind: 'telegram' }], [{ id: 'c1', status: 'claimed', device_kind: 'telegram', expires_at: new Date(Date.now() + 60000) }]);
		const out = await lc.claimLinkCode({ code: 'BCDF-GHJK', expectKind: 'telegram', claim: { telegram: { chat_id: '55', platform_user_id: '55' } } });
		expect(out.claim_secret).toBeTruthy();
	});

	it('a normal device claim still works through the route', async () => {
		queue.push([{ id: 'c1', status: 'issued', device_kind: 'cli' }], [{ id: 'c1', status: 'claimed', device_kind: 'cli', expires_at: new Date(Date.now() + 60000) }]);
		const res = makeRes();
		await handler(claimReq({ code: 'BCDF-GHJK', device_kind: 'cli', device: { name: 'laptop' } }), res);
		expect(res.statusCode).toBe(200);
	});
});

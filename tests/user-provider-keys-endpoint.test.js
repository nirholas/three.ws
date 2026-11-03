/**
 * /api/user/provider-keys stores the caller's BYOK credentials. Contract pins:
 *  - a whitespace-only value must be refused, not stored as an encrypted empty
 *    string that then reports `set: true` and breaks every forge call;
 *  - the credential write rides a rate limit (a stolen session could otherwise
 *    hammer encryption and the users row without bound);
 *  - every set/clear is audited by provider name, never by value;
 *  - the write is a single atomic jsonb merge, so two concurrent PATCHes for
 *    different providers cannot overwrite each other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlCalls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlCalls.push({ query: strings.join('?'), values });
		return [{ provider_keys: { openai: 'enc' } }];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => ({ id: 'user-1' })),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/provider-keys.js', async () => {
	const actual = await vi.importActual('../api/_lib/provider-keys.js');
	return { ...actual, encryptProviderKey: vi.fn(async (v) => `enc(${v})`) };
});
const rl = { ok: true };
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		apiKeyList: vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 1000 })),
		apiKeyManage: vi.fn(async () =>
			rl.ok
				? { success: true, limit: 30, remaining: 29, reset: Date.now() + 1000 }
				: { success: false, limit: 30, remaining: 0, reset: Date.now() + 1000 },
		),
	},
	clientIp: () => '127.0.0.1',
}));
const audits = [];
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn((e) => audits.push(e)) }));

const { default: handler } = await import('../api/user/provider-keys.js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null, writableEnded: false, headersSent: false };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b ?? r._b; r.writableEnded = true; };
	r.json = () => (r._b ? JSON.parse(r._b) : undefined);
	return r;
}
async function call(method, body) {
	const res = makeRes();
	await handler(
		{
			method,
			url: '/api/user/provider-keys',
			headers: { origin: 'https://three.ws', 'content-type': 'application/json' },
			socket: { remoteAddress: '127.0.0.1' },
			body,
		},
		res,
	);
	return res;
}

beforeEach(() => {
	sqlCalls.length = 0;
	audits.length = 0;
	rl.ok = true;
});

describe('PATCH /api/user/provider-keys', () => {
	it('refuses a whitespace-only key instead of storing an empty credential', async () => {
		const res = await call('PATCH', { openai: '   ' });
		expect(res.statusCode).toBe(400);
		expect(sqlCalls).toHaveLength(0);
	});

	it('is rate limited', async () => {
		rl.ok = false;
		const res = await call('PATCH', { openai: 'sk-test' });
		expect(res.statusCode).toBe(429);
		expect(sqlCalls).toHaveLength(0);
	});

	it('writes with one atomic jsonb merge, not read-modify-write', async () => {
		await call('PATCH', { openai: 'sk-test', meshy: null });
		const writes = sqlCalls.filter((c) => /UPDATE users/i.test(c.query));
		expect(writes).toHaveLength(1);
		expect(sqlCalls.filter((c) => /SELECT provider_keys/i.test(c.query)).length).toBe(0);
		expect(writes[0].query).toMatch(/\|\|/);
	});

	it('audits provider names, never values', async () => {
		await call('PATCH', { openai: 'sk-secret-value', meshy: null });
		expect(audits).toHaveLength(1);
		expect(audits[0].action).toBe('update_provider_keys');
		expect(JSON.stringify({ ...audits[0], req: undefined })).not.toContain('sk-secret-value');
		expect(audits[0].meta).toEqual({ set: ['openai'], cleared: ['meshy'] });
	});
});

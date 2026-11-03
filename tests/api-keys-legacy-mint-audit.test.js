/**
 * POST /api/api-keys (the legacy mint route, still callable by bearer tokens)
 * must leave the same audit trail as POST /api/keys, and must refuse an
 * expires_at already in the past (that mints a credential that is dead on
 * arrival while reporting 201).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => ({ id: 'user-1' })),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
	hasScope: vi.fn(() => true),
}));
const sqlCalls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlCalls.push({ query: strings.join('?'), values });
		return [{ id: 'k1', name: 'n', prefix: 'sk_live_abc', scope: 'avatars:read', created_at: 'now' }];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
const audits = [];
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn((e) => audits.push(e)) }));

const { default: handler } = await import('../api/api-keys.js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null, writableEnded: false, headersSent: false };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b ?? r._b; r.writableEnded = true; };
	r.json = () => (r._b ? JSON.parse(r._b) : undefined);
	return r;
}
async function mint(body) {
	const res = makeRes();
	await handler(
		{
			method: 'POST',
			url: '/api/api-keys',
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
});

describe('POST /api/api-keys', () => {
	it('writes a create_api_key audit row without the secret', async () => {
		const res = await mint({ name: 'ci', scope: 'avatars:read' });
		expect(res.statusCode).toBe(201);
		expect(audits).toHaveLength(1);
		expect(audits[0].action).toBe('create_api_key');
		const token = res.json().data.token;
		expect(JSON.stringify({ ...audits[0], req: undefined })).not.toContain(token);
	});

	it('refuses an expires_at in the past', async () => {
		const res = await mint({ name: 'ci', scope: 'avatars:read', expires_at: '2020-01-01T00:00:00Z' });
		expect(res.statusCode).toBe(400);
		expect(sqlCalls).toHaveLength(0);
	});
});

// The <agent-3d> element reads two public endpoints from whatever site embeds it:
// GET /api/avatars/:id (the `avatar-id` attribute) and the pump.fun trade stream
// (the `tracked-mint` attribute). Both used the credentialed allowlist, which
// sends no `access-control-allow-origin` to a stranger, so the browser blocked
// the read on every site but three.ws. An anonymous GET only ever sees public
// data, so it answers any origin; a session-bearing read and every write keep
// the allowlist.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn(async () => []) }));
vi.mock('../../api/_lib/db.js', () => ({
	sql: sqlMock,
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => null,
	authenticateBearer: async () => null,
	extractBearer: () => null,
	hasScope: () => false,
}));
vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: async () => ({ success: true }), mcpIp: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../../api/_lib/usage.js', () => ({ recordEvent: () => {} }));
vi.mock('../../api/_lib/avatars.js', () => ({
	getAvatar: async () => ({ id: AVATAR_ID, visibility: 'public', name: 'Public body' }),
	resolveAvatarUrl: async () => ({ url: 'https://cdn.test/body.glb' }),
	stripOwnerFor: (a) => a,
	deleteAvatar: async () => null,
	updateAvatar: async () => null,
}));
vi.mock('../../api/_lib/r2.js', () => ({
	r2: {},
	headObject: async () => null,
	publicUrl: (k) => `https://cdn.test/${k}`,
	thumbnailUrl: (k) => `https://cdn.test/${k}`,
}));

const AVATAR_ID = '22222222-2222-4222-8222-222222222222';
const STRANGER = 'https://bookshop.example';

function makeReq({ method = 'GET', url, query = {}, headers = {} }) {
	return {
		method,
		url,
		query,
		headers: { host: 'three.ws', origin: STRANGER, ...headers },
		on() {},
	};
}

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		setHeader(k, v) {
			this._h[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this._h[k.toLowerCase()];
		},
		end(chunk) {
			if (chunk !== undefined) this.body = chunk;
			this.writableEnded = true;
		},
	};
}

describe('GET /api/avatars/:id from another site', () => {
	it('answers an anonymous read with a wildcard origin so avatar-id embeds load anywhere', async () => {
		const { default: handler } = await import('../../api/avatars/[id].js');
		const res = makeRes();
		await handler(makeReq({ url: `/api/avatars/${AVATAR_ID}`, query: { id: AVATAR_ID } }), res);
		expect(res.statusCode).toBe(200);
		expect(res._h['access-control-allow-origin']).toBe('*');
		expect(res._h['access-control-allow-credentials']).toBeUndefined();
	});

	it('gives a stranger no CORS grant for a read that carries a session cookie', async () => {
		const { default: handler } = await import('../../api/avatars/[id].js');
		const res = makeRes();
		await handler(
			makeReq({ url: `/api/avatars/${AVATAR_ID}`, query: { id: AVATAR_ID }, headers: { cookie: 'sid=1' } }),
			res,
		);
		expect(res._h['access-control-allow-origin']).toBeUndefined();
	});

	it('refuses a stranger\'s preflight for a write', async () => {
		const { default: handler } = await import('../../api/avatars/[id].js');
		const res = makeRes();
		await handler(
			makeReq({
				method: 'OPTIONS',
				url: `/api/avatars/${AVATAR_ID}`,
				query: { id: AVATAR_ID },
				headers: { 'access-control-request-method': 'PATCH' },
			}),
			res,
		);
		expect(res.statusCode).toBe(204);
		expect(res._h['access-control-allow-origin']).toBeUndefined();
	});
});

describe('GET /api/agents/pumpfun-feed from another site', () => {
	it('answers the anonymous preflight with a wildcard origin so tracked-mint embeds can stream trades', async () => {
		const { default: handler } = await import('../../api/agents/pumpfun.js');
		const res = makeRes();
		await handler(
			makeReq({
				method: 'OPTIONS',
				url: '/api/agents/pumpfun-feed?kind=trades&mint=THREEsynthetic1111111111111111111111111111',
				query: { _handler: 'feed' },
				headers: { 'access-control-request-method': 'GET' },
			}),
			res,
		);
		expect(res.statusCode).toBe(204);
		expect(res._h['access-control-allow-origin']).toBe('*');
	});
});

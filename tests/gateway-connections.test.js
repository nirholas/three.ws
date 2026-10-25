// A chat pairing code must never bind a chat to an account the owner has not
// seen. Redeeming requires the confirm token that only a preview of the same
// code, by the same signed-in user, mints.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

process.env.JWT_SECRET = 'test-secret-for-gateway-connections-0123456789';

vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
const authState = { user: { id: 'owner-1', email: 'o@example.com' } };
vi.mock('../api/_lib/auth.js', async (orig) => {
	const actual = await orig();
	return { ...actual, getRequestUser: vi.fn(async () => authState.user) };
});
vi.mock('../api/_lib/rate-limit.js', () => {
	const ok = async () => ({ success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 });
	return { limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/db.js', () => ({
	sql: Object.assign(vi.fn(async () => []), { transaction: vi.fn(async () => []) }),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
const store = vi.hoisted(() => ({
	redeemChatCode: vi.fn(async () => ({ id: 'link-1', platform: 'telegram' })),
	peekChatCode: vi.fn(async () => ({
		platform: 'telegram', chat_title: 'Synthetic Group', chat_type: 'group', platform_username: 'synthetic_user',
	})),
}));
vi.mock('../api/_lib/gateway/store.js', async (orig) => {
	const actual = await orig();
	return {
		...actual,
		redeemChatCode: store.redeemChatCode,
		peekChatCode: store.peekChatCode,
		listLinksForUser: vi.fn(async () => [{ id: 'link-1', platform: 'telegram' }]),
	};
});

function mkReq(body) {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]);
	req.method = 'POST';
	req.url = '/api/gateway/connections';
	req.query = {};
	req.headers = { host: 'three.ws', 'content-type': 'application/json' };
	req.socket = { remoteAddress: '127.0.0.1' };
	return req;
}
function mkRes() {
	return {
		statusCode: 200, headers: {}, body: '', headersSent: false, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(c) { if (c !== undefined) this.body += c; this.writableEnded = true; this.headersSent = true; },
	};
}
async function call(body) {
	const { default: handler } = await import('../api/gateway/connections.js');
	const res = mkRes();
	await handler(mkReq(body), res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

describe('gateway pairing needs an explicit confirmation of the chat', () => {
	beforeEach(() => {
		store.redeemChatCode.mockClear();
		authState.user = { id: 'owner-1', email: 'o@example.com' };
	});

	it('refuses a redeem that carries no confirm token', async () => {
		const r = await call({ action: 'redeem', code: 'ABCD-EFGH' });
		expect(r.status).toBe(400);
		expect(r.body.error).toBe('confirm_required');
		expect(store.redeemChatCode).not.toHaveBeenCalled();
	});

	it('refuses a forged confirm token', async () => {
		const r = await call({ action: 'redeem', code: 'ABCD-EFGH', confirm: 'forged.token' });
		expect(r.status).toBe(400);
		expect(store.redeemChatCode).not.toHaveBeenCalled();
	});

	it('previews the chat identity without consuming the code, then redeems with the token', async () => {
		const p = await call({ action: 'preview', code: 'ABCD-EFGH' });
		expect(p.status).toBe(200);
		expect(p.body.chat).toMatchObject({ platform: 'telegram', chat_title: 'Synthetic Group', platform_username: 'synthetic_user' });
		expect(store.redeemChatCode).not.toHaveBeenCalled();
		const r = await call({ action: 'redeem', code: 'ABCD-EFGH', confirm: p.body.confirm });
		expect(r.status).toBe(201);
		expect(store.redeemChatCode).toHaveBeenCalledTimes(1);
	});

	it('a token minted for one code or one user does not redeem another', async () => {
		const p = await call({ action: 'preview', code: 'ABCD-EFGH' });
		const other = await call({ action: 'redeem', code: 'WXYZ-2345', confirm: p.body.confirm });
		expect(other.status).toBe(400);
		authState.user = { id: 'someone-else', email: 's@example.com' };
		const stolen = await call({ action: 'redeem', code: 'ABCD-EFGH', confirm: p.body.confirm });
		expect(stolen.status).toBe(400);
		expect(store.redeemChatCode).not.toHaveBeenCalled();
	});
});

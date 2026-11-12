// POST /api/tx/submit and GET /api/tx/:id through the real handler, the real
// custody principal check and the real submitExternalTx. Only the session and
// bearer lookup, the database and the rate limiter are faked: an anonymous
// caller gets a 401 before any work, a caller with only wallet:read cannot
// submit, and a well-formed tx_id that matches no prepared row for this
// account is a 404 on both verbs.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';

const UNKNOWN_TX = '00000000-0000-4000-8000-000000000000';
let session = null;
let bearer = null;

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => session),
	authenticateBearer: vi.fn(async () => bearer),
	extractBearer: vi.fn(() => (bearer ? 'token' : null)),
	hasScope: (granted, scope) => String(granted || '').split(/\s+/).includes(scope),
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		custodyWrite: vi.fn(async () => ({ success: true })),
		walletRead: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/solana/connection.js', () => ({ solanaConnection: vi.fn() }));

const { default: handler } = await import('../api/tx/submit.js');

function request(method, url, body) {
	const req = new PassThrough();
	req.method = method;
	req.url = url;
	req.headers = { 'content-type': 'application/json', host: 'localhost' };
	req.end(body === undefined ? '' : JSON.stringify(body));
	return req;
}

function response() {
	return {
		statusCode: 200, headers: {}, body: '', headersSent: false, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		writeHead(code, h = {}) { this.statusCode = code; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); return this; },
		write(chunk) { this.body += chunk; return true; },
		end(chunk) { if (chunk) this.body += chunk; this.writableEnded = true; this.headersSent = true; },
	};
}

async function call(method, url, body) {
	const res = response();
	await handler(request(method, url, body), res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

const submitBody = { tx_id: UNKNOWN_TX, signed_transaction: 'AQID' };

describe('/api/tx/submit', () => {
	beforeEach(() => {
		session = null;
		bearer = null;
	});

	it('answers 401 to an anonymous submit', async () => {
		const out = await call('POST', '/api/tx/submit', submitBody);
		expect(out.status).toBe(401);
		expect(out.body.error).toBe('unauthorized');
	});

	it('answers 403 to a bearer token holding only wallet:read', async () => {
		bearer = { userId: 'user-1', scope: 'wallet:read' };
		const out = await call('POST', '/api/tx/submit', submitBody);
		expect(out.status).toBe(403);
		expect(out.body.error).toBe('insufficient_scope');
	});

	it('answers 404 when a wallet:write caller submits a tx_id with no prepared row', async () => {
		bearer = { userId: 'user-1', scope: 'wallet:write' };
		const out = await call('POST', '/api/tx/submit', submitBody);
		expect(out.status).toBe(404);
		expect(out.body.error).toBe('not_found');
	});

	it('answers 404 to GET /api/tx/:id for an unknown id', async () => {
		session = { id: 'user-1' };
		const out = await call('GET', `/api/tx/${UNKNOWN_TX}`);
		expect(out.status).toBe(404);
		expect(out.body.error).toBe('not_found');
	});

	it('answers 400 to a tx_id that is not a prepared-transaction id', async () => {
		session = { id: 'user-1' };
		const out = await call('POST', '/api/tx/submit', { tx_id: 'nope', signed_transaction: 'AQID' });
		expect(out.status).toBe(400);
		expect(out.body.error).toBe('invalid_parameter');
	});
});

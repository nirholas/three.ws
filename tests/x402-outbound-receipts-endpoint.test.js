// GET /api/x402/outbound-receipts: account-session (or wallet:write-bearer)
// read endpoint listing what the caller's agents spent at external x402
// merchants. Auth, query parsing, and the empty-state shape are the contract
// under test; the resolve/aggregate logic itself lives in
// api/_lib/x402/outbound-receipts.js and is covered there.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUserMock = vi.fn();
const authenticateBearerMock = vi.fn();
const extractBearerMock = vi.fn();
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: (...a) => getSessionUserMock(...a),
	authenticateBearer: (...a) => authenticateBearerMock(...a),
	extractBearer: (...a) => extractBearerMock(...a),
}));

const authIpLimit = vi.fn();
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: (...a) => authIpLimit(...a) },
	clientIp: () => '127.0.0.1',
}));

const listOutboundReceiptsMock = vi.fn();
const summarizeOutboundReceiptsMock = vi.fn();
vi.mock('../api/_lib/x402/outbound-receipts.js', () => ({
	listOutboundReceipts: (...a) => listOutboundReceiptsMock(...a),
	summarizeOutboundReceipts: (...a) => summarizeOutboundReceiptsMock(...a),
}));

const { default: handler } = await import('../api/x402/outbound-receipts.js');

function mkReq({ method = 'GET', url = '/api/x402/outbound-receipts', headers = {} } = {}) {
	return { method, url, headers, on() {}, destroy() {} };
}
function mkRes() {
	return {
		statusCode: 200, headers: {}, body: undefined, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(b) { this.body = b; this.writableEnded = true; },
	};
}
const parse = (res) => (res.body ? JSON.parse(res.body) : undefined);

beforeEach(() => {
	getSessionUserMock.mockReset().mockResolvedValue({ id: 'user-1' });
	authenticateBearerMock.mockReset().mockResolvedValue(null);
	extractBearerMock.mockReset().mockReturnValue(null);
	authIpLimit.mockReset().mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: 0 });
	listOutboundReceiptsMock.mockReset().mockResolvedValue({ receipts: [], nextCursor: null });
	summarizeOutboundReceiptsMock.mockReset().mockResolvedValue({ total: 0, totalSpendUsd: 0, verified: 0, unverified: 0, uniqueMerchants: 0 });
});

describe('GET /api/x402/outbound-receipts', () => {
	it('rejects an unauthenticated caller', async () => {
		getSessionUserMock.mockResolvedValueOnce(null);
		const res = mkRes();
		await handler(mkReq(), res);
		expect(res.statusCode).toBe(401);
	});

	it('rejects a non-GET method', async () => {
		const res = mkRes();
		await handler(mkReq({ method: 'POST' }), res);
		expect(res.statusCode).toBe(405);
	});

	it('returns the designed empty state when there is nothing to show', async () => {
		const res = mkRes();
		await handler(mkReq(), res);
		expect(res.statusCode).toBe(200);
		const body = parse(res);
		expect(body.receipts).toEqual([]);
		expect(body.nextCursor).toBeNull();
		expect(body.summary.total).toBe(0);
	});

	it('passes network, host, cursor and a clamped limit through to the lib', async () => {
		const res = mkRes();
		await handler(
			mkReq({ url: '/api/x402/outbound-receipts?network=solana&host=example.test&cursor=2026-10-01T00:00:00.000Z&limit=500' }),
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(listOutboundReceiptsMock).toHaveBeenCalledWith('user-1', {
			limit: 100,
			cursor: '2026-10-01T00:00:00.000Z',
			network: 'solana',
			host: 'example.test',
		});
	});

	it('rejects a cursor that is not a valid timestamp', async () => {
		const res = mkRes();
		await handler(mkReq({ url: '/api/x402/outbound-receipts?cursor=not-a-date' }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('invalid_cursor');
	});

	it('accepts a wallet:write bearer when there is no session', async () => {
		getSessionUserMock.mockResolvedValueOnce(null);
		extractBearerMock.mockReturnValueOnce('tok');
		authenticateBearerMock.mockResolvedValueOnce({ userId: 'agent-1', scope: 'wallet:write' });
		const res = mkRes();
		await handler(mkReq(), res);
		expect(res.statusCode).toBe(200);
		expect(listOutboundReceiptsMock).toHaveBeenCalledWith('agent-1', expect.any(Object));
	});
});

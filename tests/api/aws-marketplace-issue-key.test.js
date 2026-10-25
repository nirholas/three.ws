// /api/aws-marketplace/issue-key must bind an unclaimed marketplace row to the
// caller before minting a key. Without the claim, a signed-in user who learned
// a row id could mint the key and a later buyer link got 403.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../../api/_lib/db.js', () => ({
	sql: Object.assign((...a) => sqlMock(...a), { transaction: (...a) => sqlMock(...a) }),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const getSessionUserMock = vi.fn();
vi.mock('../../api/_lib/auth.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, getSessionUser: (...a) => getSessionUserMock(...a) };
});

const findMock = vi.fn();
const claimMock = vi.fn();
vi.mock('../../api/_lib/aws-marketplace-store.js', () => ({
	findCustomerByHandle: (...a) => findMock(...a),
	claimCustomerForUser: (...a) => claimMock(...a),
}));

const issueMock = vi.fn();
vi.mock('../../api/_lib/aws-marketplace-bridge.js', () => ({
	issueSubscriptionForCustomer: (...a) => issueMock(...a),
}));

const { default: handler } = await import('../../api/aws-marketplace/issue-key.js');

function makeReq() {
	return {
		method: 'POST',
		url: '/api/aws-marketplace/issue-key',
		headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
		rawBody: Buffer.from(JSON.stringify({ customer: 'row-1' })),
		query: {},
	};
}
function makeRes() {
	const headers = {};
	let body = '';
	const res = {
		statusCode: 200, headersSent: false, writableEnded: false,
		setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
		getHeader: (k) => headers[k.toLowerCase()],
		end: (c) => { body = c ?? ''; res.writableEnded = true; },
		_get: () => ({ status: res.statusCode, body: body ? JSON.parse(body) : null }),
	};
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	getSessionUserMock.mockResolvedValue({ id: 'u1' });
	issueMock.mockResolvedValue({ subscriptionId: 's', keyPrefix: 'k', token: 't', rateLimitPerMinute: 1, alreadyIssued: false });
});

describe('issue-key ownership', () => {
	it('claims an unclaimed row for the caller before issuing', async () => {
		const row = { id: 'row-1', user_id: null, subscription_status: 'active' };
		findMock.mockResolvedValue(row);
		claimMock.mockResolvedValue({ ...row, user_id: 'u1' });
		const res = makeRes();
		await handler(makeReq(), res);
		expect(claimMock).toHaveBeenCalledWith('row-1', 'u1');
		expect(issueMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1' }));
		expect(res._get().status).toBe(200);
	});

	it('refuses when the claim loses a race', async () => {
		findMock.mockResolvedValue({ id: 'row-1', user_id: null, subscription_status: 'active' });
		claimMock.mockResolvedValue(null);
		const res = makeRes();
		await handler(makeReq(), res);
		expect(issueMock).not.toHaveBeenCalled();
		expect(res._get().status).toBe(403);
	});
});

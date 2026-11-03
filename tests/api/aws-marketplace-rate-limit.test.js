// register, link and issue-key each reach AWS (ResolveCustomer) or mint keys and
// must be throttled per client IP before doing any work.

import { describe, it, expect, vi } from 'vitest';

const authIp = vi.fn();
vi.mock('../../api/_lib/rate-limit.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, limits: new Proxy(actual.limits, { get: (t, k) => (k === 'authIp' ? authIp : t[k]) }) };
});
const getSessionUserMock = vi.fn(async () => ({ id: 'u1' }));
vi.mock('../../api/_lib/auth.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, getSessionUser: (...a) => getSessionUserMock(...a) };
});
const resolveMock = vi.fn();
vi.mock('../../api/_lib/aws-marketplace.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, resolveCustomer: (...a) => resolveMock(...a), awsMarketplaceConfigured: () => true };
});
vi.mock('../../api/_lib/aws-marketplace-store.js', () => ({
	findCustomerByHandle: vi.fn(),
	claimCustomerForUser: vi.fn(),
	upsertResolvedCustomer: vi.fn(),
}));

function req(path, body, ctype) {
	return {
		method: 'POST',
		url: path,
		headers: { 'content-type': ctype, 'user-agent': 'vitest', 'x-forwarded-for': '203.0.113.9' },
		rawBody: Buffer.from(body),
		query: {},
	};
}
function res() {
	const headers = {};
	const r = {
		statusCode: 200, headersSent: false, writableEnded: false,
		setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
		getHeader: (k) => headers[k.toLowerCase()],
		end: () => { r.writableEnded = true; },
	};
	return r;
}

describe('aws-marketplace entry points are rate limited', () => {
	it.each([
		['register', '../../api/aws-marketplace/register.js', 'x-amzn-marketplace-token=abc', 'application/x-www-form-urlencoded'],
		['link', '../../api/aws-marketplace/link.js', JSON.stringify({ customer: 'row-1' }), 'application/json'],
		['issue-key', '../../api/aws-marketplace/issue-key.js', JSON.stringify({ customer: 'row-1' }), 'application/json'],
	])('%s answers 429 and does no work when the bucket is empty', async (name, mod, body, ctype) => {
		authIp.mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: Date.now() + 60000 });
		const { default: handler } = await import(mod);
		const r = res();
		await handler(req(`/api/aws-marketplace/${name}`, body, ctype), r);
		expect(r.statusCode).toBe(429);
		expect(resolveMock).not.toHaveBeenCalled();
	});
});

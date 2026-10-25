// A connector key keeps agents:write but must never move value (x-grok order
// 026, design rule 2). Listing an agent can sweep its wallet to a chosen payout
// address and accepting a bid hands the custodial wallet to the buyer, so the REST
// routes that do either need the spend scope for any bearer, not just agents:write.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const authState = { bearer: null };
vi.mock('../../api/_lib/auth.js', async (importOriginal) => ({
	...(await importOriginal()),
	getSessionUser: vi.fn(async () => null),
	authenticateBearer: vi.fn(async () => authState.bearer),
	extractBearer: vi.fn(() => 'sk_live_test'),
}));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { apiV1: vi.fn(async () => ({ success: true, limit: 120, remaining: 119, reset: Date.now() + 1000 })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));
const svcCalls = [];
vi.mock('../../api/_lib/agent-market/service.js', () => {
	const record = (name) => vi.fn(async () => { svcCalls.push(name); return { ok: true }; });
	return {
		createListing: record('createListing'),
		delistListing: record('delistListing'),
		acceptBid: record('acceptBid'),
		resumeTransfer: record('resumeTransfer'),
		rejectBid: record('rejectBid'),
	};
});

const BID = '11111111-1111-4111-8111-111111111111';
const ROUTES = [
	['createListing', '/api/v1/marketplace/agents/listings'],
	['delistListing', `/api/v1/marketplace/agents/listings/${BID}/delist`],
	['acceptBid', `/api/v1/marketplace/agents/bids/${BID}/accept`],
	['resumeTransfer', `/api/v1/marketplace/agents/transfers/${BID}/resume`],
];

function call(url) {
	const req = Readable.from([Buffer.from('{}')]);
	req.method = 'POST';
	req.url = url;
	req.headers = { host: 'localhost', 'content-type': 'application/json', authorization: 'Bearer sk_live_test' };
	const res = {
		statusCode: 200, headers: {}, body: '', writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(chunk) { if (chunk != null) this.body += chunk; this.writableEnded = true; },
	};
	return import('../../api/v1/marketplace/agents/[...route].js').then(async ({ default: handler }) => {
		await handler(req, res);
		let json = {};
		try { json = JSON.parse(res.body); } catch { /* empty */ }
		return { res, json };
	});
}

beforeEach(() => { svcCalls.length = 0; });

describe('connector-scoped bearers on the agent marketplace', () => {
	for (const [svcName, url] of ROUTES) {
		it(`${svcName} refuses a bearer holding agents:write without the spend scope`, async () => {
			authState.bearer = { userId: 'u1', source: 'apikey', scope: 'avatars:read agents:read agents:write' };
			const { res, json } = await call(url);
			expect(res.statusCode).toBe(403);
			expect(json.error).toBe('insufficient_scope');
			expect(svcCalls).toEqual([]);
		});

		it(`${svcName} accepts a bearer that holds wallet:write`, async () => {
			authState.bearer = { userId: 'u1', source: 'apikey', scope: 'agents:write wallet:write' };
			const { res } = await call(url);
			expect(res.statusCode).toBe(200);
			expect(svcCalls).toEqual([svcName]);
		});
	}
});

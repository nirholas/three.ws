// Public, unauthenticated reads that took any agent UUID and answered for private
// or deleted agents too:
//   - /api/agent-screen-stream streamed a private or deleted agent's name, activity
//     log and reactions to anyone holding the id (ids leak through share links and
//     OG cards). Now: deleted agents are 404, private agents stream only to their
//     owner, and a malformed id is a 400 instead of a raw DB cast error.
//   - /api/agents/networth returned the custodial wallet and USD net worth of
//     private agents. Now only public agents are resolved.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from './_helpers/monetization.js';

let sessionUser = null;
const sqlCalls = [];
let sqlRows = [];

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => sessionUser),
	getRequestUser: vi.fn(async () => sessionUser),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlCalls.push({ text: strings.join('?'), values });
		return sqlRows;
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../api/_lib/rate-limit.js', () => {
	const ok = async () => ({ success: true, reset: Date.now() + 1000, limit: 100, remaining: 99 });
	return { limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});
vi.mock('../api/_lib/balances.js', () => ({
	getBalances: vi.fn(async () => ({ tokens: [] })),
	walletUsdTotal: () => 0,
}));

const AGENT = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
	sessionUser = null;
	sqlCalls.length = 0;
	sqlRows = [];
});

async function stream(url) {
	const { default: handler } = await import('../api/agent-screen-stream.js');
	const r = await invoke(handler, { method: 'GET', url, headers: { host: 'three.ws' } });
	return r;
}

describe('agent-screen-stream visibility', () => {
	it('rejects a malformed agent id with 400', async () => {
		const r = await stream('/api/agent-screen-stream?agentId=not-a-uuid');
		expect(r.status).toBe(400);
	});

	it('does not stream a private agent to an anonymous viewer', async () => {
		sqlRows = [{ name: 'Secret', is_public: false, user_id: 'owner-1' }];
		const r = await stream(`/api/agent-screen-stream?agentId=${AGENT}`);
		expect(r.status).toBe(404);
	});

	it('does not stream a private agent to a different signed-in user', async () => {
		sessionUser = { id: 'someone-else' };
		sqlRows = [{ name: 'Secret', is_public: false, user_id: 'owner-1' }];
		const r = await stream(`/api/agent-screen-stream?agentId=${AGENT}`);
		expect(r.status).toBe(404);
	});

	it('excludes deleted agents in the lookup', async () => {
		sqlRows = [];
		const r = await stream(`/api/agent-screen-stream?agentId=${AGENT}`);
		expect(r.status).toBe(404);
		expect(sqlCalls[0].text).toMatch(/deleted_at is null/i);
	});
});

describe('agents/networth visibility', () => {
	it('only resolves public agents', async () => {
		const { default: handler } = await import('../api/agents/networth.js');
		await invoke(handler, { method: 'GET', url: `/api/agents/networth?ids=${AGENT}` });
		expect(sqlCalls).toHaveLength(1);
		expect(sqlCalls[0].text).toMatch(/is_public/i);
	});
});

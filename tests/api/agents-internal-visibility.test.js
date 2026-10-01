// Platform-internal agents never reach a public discovery surface.
//
// An agent the platform creates for its own plumbing (the marketplace chat bot's
// AI-budget meter, owned by a service account and never published) inherits
// is_public = true from the column default. On 2026-10-01 that put it on
// /api/agents/public and ranked it #1 on /api/trending off the bot's own traffic,
// with a description that says "Not a public agent". The rule both endpoints now
// apply is "published, or owned by a person", expressed against users.service_account
// rather than any agent id, so the next internal agent is covered too.
//
// This renders every agent query each endpoint runs (all sorts, both windows, the
// live wall's header totals) and asserts the rule is in each one.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../../api/_lib/r2.js', () => ({
	thumbnailUrl: (key) => `https://cdn.example/${key}`,
	publicUrl: (key) => `https://cdn.example/${key}`,
}));
vi.mock('../../api/_lib/trust/wallet-reputation.js', () => ({ scoreAgentsLite: async () => new Map() }));

const calls = [];
vi.mock('../../api/_lib/db.js', () => ({
	sql: Object.assign(
		(strings, ...values) => {
			calls.push(strings.join(' ? '));
			return Promise.resolve([]);
		},
		{ transaction: async () => [] },
	),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const { default: publicAgents } = await import('../../api/agents/public.js');
const { default: trending } = await import('../../api/trending.js');

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
		end(body) {
			this._body = body;
		},
	};
}

async function call(handler, url) {
	const res = makeRes();
	await handler({ method: 'GET', url, headers: { host: 'three.ws', origin: 'https://three.ws' } }, res);
	return res;
}

// Whitespace-insensitive, so the assertion pins the rule and not its indentation.
const squash = (s) => s.replace(/\s+/g, ' ');
const INTERNAL_RULE =
	/not \(i\.is_published is not true and exists \( select 1 from users su where su\.id = i\.user_id and su\.service_account \)\)/;

function agentQueries() {
	return calls.map(squash).filter((q) => /from agent_identities i|join agent_identities i/.test(q));
}

beforeEach(() => {
	calls.length = 0;
});

describe('internal agents stay off public listings', () => {
	for (const sort of ['popular', 'newest', 'name', 'live']) {
		it(`/api/agents/public?sort=${sort} applies the rule to every agent query`, async () => {
			const res = await call(publicAgents, `/api/agents/public?sort=${sort}`);
			expect(res.statusCode).toBe(200);
			const queries = agentQueries();
			// The live sort also runs its header-totals query on the first page.
			expect(queries.length).toBe(sort === 'live' ? 2 : 1);
			for (const q of queries) expect(q).toMatch(INTERNAL_RULE);
		});
	}

	for (const win of ['24h', '7d', 'all']) {
		it(`/api/trending?window=${win} applies the rule to the agent ranking`, async () => {
			const res = await call(trending, `/api/trending?window=${win}`);
			expect(res.statusCode).toBe(200);
			const queries = agentQueries();
			expect(queries.length).toBe(1);
			expect(queries[0]).toMatch(INTERNAL_RULE);
		});
	}

	it('keys the rule on ownership and publication, never on a specific agent id', async () => {
		await call(publicAgents, '/api/agents/public');
		await call(trending, '/api/trending');
		for (const q of agentQueries()) {
			expect(q).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
			expect(q).not.toMatch(/llm-gateway-meter/);
		}
	});
});

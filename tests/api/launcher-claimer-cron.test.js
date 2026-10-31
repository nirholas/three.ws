// api/cron/launcher-claimer.js: the pump.fun creator-fee sweep.
//
// The claimer reaches owner-scoped endpoints (/api/pump/fee-info and
// /api/pump/collect-creator-fee-agent) by minting a real session for the coin
// owner, because those endpoints authenticate by session cookie. It used to
// mint one per REQUEST, which meant:
//   · two live sessions per coin checked, up to 40 every five minutes, none of
//     them ever revoked; and
//   · two recordDailyActivity() calls per coin, so a cron on a timer kept every
//     launcher owner's cross-surface streak alive without them opening the site.
// One session per owner per tick now, minted with recordActivity:false and
// revoked when the tick ends, even if a claim throws mid-sweep.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sqlMock = vi.fn(async () => []);
const createSession = vi.fn(async () => `tok-${createSession.mock.calls.length}`);
const revokeSessionToken = vi.fn(async () => {});

vi.mock('../../api/_lib/db.js', () => ({
	sql: sqlMock,
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));
vi.mock('../../api/_lib/auth.js', () => ({ createSession, revokeSessionToken }));
// THREE_TOKEN_* are read at import time by api/_lib/token/config.js, which the
// claimer now reaches transitively (ATOMICS_PER_TOKEN = 10n ** BigInt(decimals)).
vi.mock('../../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'https://three.ws', THREE_TOKEN_MINT: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump', THREE_TOKEN_DECIMALS: 6 },
}));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn() }));
vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: vi.fn() }));

const { default: handler } = await import('../../api/cron/launcher-claimer.js');
const { collectFeeAgentSchema } = await import('../../api/_lib/pump-fee-schemas.js');

const OWNER_A = '11111111-1111-1111-1111-111111111111';
const OWNER_B = '22222222-2222-2222-2222-222222222222';
const runRow = (id, ownerUserId, mint) => ({
	id, mint, agent_id: `agent-${id}`, network: 'mainnet', buyback_bps: 5000,
	owner_user_id: ownerUserId, agent_name: `Agent ${id}`,
});

function call(method = 'GET', auth = 'Bearer test-cron-secret') {
	const res = {
		statusCode: 0,
		body: null,
		headers: {},
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ? JSON.parse(b) : null; },
		get headersSent() { return this.body !== null; },
		get writableEnded() { return this.body !== null; },
	};
	const req = { method, url: '/api/cron/launcher-claimer', headers: { authorization: auth } };
	return handler(req, res).then(() => res);
}

// The claimer's SELECT is the only query that returns rows; every other call
// (create table, create index, insert claim) resolves empty.
function withRuns(rows) {
	sqlMock.mockImplementation(async (strings) => {
		const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
		if (text.includes('from launcher_runs')) return rows;
		return [];
	});
}

const originalFetch = global.fetch;
let requests;

beforeEach(() => {
	process.env.CRON_SECRET = 'test-cron-secret';
	requests = [];
	sqlMock.mockReset();
	createSession.mockClear();
	revokeSessionToken.mockClear();
	withRuns([]);
	global.fetch = vi.fn(async (url, opts = {}) => {
		requests.push({ url: String(url), cookie: opts.headers?.cookie });
		if (String(url).includes('fee-info')) {
			return { ok: true, status: 200, json: async () => ({ claimable_lamports: '50000000' }) };
		}
		return {
			ok: true, status: 201,
			json: async () => ({ ok: true, signature: 'sig-1', lamports: 50_000_000 }),
		};
	});
});
afterEach(() => {
	delete process.env.CRON_SECRET;
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe('GET/POST /api/cron/launcher-claimer', () => {
	it('rejects a method it does not serve', async () => {
		const res = await call('DELETE');
		expect(res.statusCode).toBe(405);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('rejects a bad cron secret before minting anything', async () => {
		const res = await call('GET', 'Bearer wrong');
		expect(res.statusCode).toBe(401);
		expect(createSession).not.toHaveBeenCalled();
	});

	it('mints nothing when no run is eligible', async () => {
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ ok: true, checked: 0, claimed: 0 });
		expect(createSession).not.toHaveBeenCalled();
	});

	it('mints one session per owner, not one per request, and never records activity', async () => {
		withRuns([
			runRow('run-1', OWNER_A, 'MintOne'),
			runRow('run-2', OWNER_A, 'MintTwo'),
			runRow('run-3', OWNER_B, 'MintThree'),
		]);
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(res.body.checked).toBe(3);
		expect(res.body.claimed).toBe(3);

		// Two owners, three coins, six HTTP calls, but only two sessions.
		expect(requests).toHaveLength(6);
		expect(createSession).toHaveBeenCalledTimes(2);
		expect(createSession.mock.calls.map((c) => c[0].userId)).toEqual([OWNER_A, OWNER_B]);
		for (const [args] of createSession.mock.calls) {
			expect(args.recordActivity).toBe(false);
		}
		// Both of owner A's coins reused the same cookie.
		const aCookies = new Set(requests.slice(0, 4).map((r) => r.cookie));
		expect(aCookies.size).toBe(1);
	});

	it('revokes every minted session when the tick ends', async () => {
		withRuns([runRow('run-1', OWNER_A, 'MintOne'), runRow('run-3', OWNER_B, 'MintThree')]);
		await call();
		expect(revokeSessionToken).toHaveBeenCalledTimes(2);
		expect(new Set(revokeSessionToken.mock.calls.map((c) => c[0])).size).toBe(2);
	});

	it('still revokes when a claim throws mid-sweep', async () => {
		withRuns([runRow('run-1', OWNER_A, 'MintOne')]);
		global.fetch = vi.fn(async () => { throw new Error('network down'); });
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(res.body.errors).toBe(1);
		expect(revokeSessionToken).toHaveBeenCalledTimes(1);
	});

	it('reports why a coin was skipped instead of swallowing the reason', async () => {
		withRuns([runRow('run-1', OWNER_A, 'MintOne')]);
		global.fetch = vi.fn(async (url) => {
			requests.push({ url: String(url) });
			return { ok: true, status: 200, json: async () => ({ claimable_lamports: '1000' }) };
		});
		const res = await call();
		expect(res.body.skipped).toBe(1);
		expect(res.body.details[0]).toMatchObject({ runId: 'run-1', status: 'below-threshold' });
	});

	// The claim endpoint validates its body with collectFeeAgentSchema before it
	// does anything else. This stub applies that same schema and answers 400 the
	// way the real handler does, so a body the endpoint cannot read fails here
	// instead of in production (the claimer used to send `agentId`, which the
	// schema does not know, and every automatic claim came back 400).
	it('posts a claim body the real collect-creator-fee-agent schema accepts', async () => {
		const agentId = '33333333-3333-4333-8333-333333333333';
		const mint = 'THREEsynthetic11111111111111111111111111111';
		withRuns([{ ...runRow('run-9', OWNER_A, mint), agent_id: agentId }]);
		const claimBodies = [];
		global.fetch = vi.fn(async (url, opts = {}) => {
			if (String(url).includes('fee-info')) {
				return { ok: true, status: 200, json: async () => ({ claimable_lamports: '50000000' }) };
			}
			const body = JSON.parse(opts.body || '{}');
			claimBodies.push(body);
			const parsed = collectFeeAgentSchema.safeParse(body);
			if (!parsed.success) {
				return { ok: false, status: 400, json: async () => ({ error: 'validation_error' }) };
			}
			return { ok: true, status: 201, json: async () => ({ ok: true, signature: 'sig-9', lamports: 50_000_000 }) };
		});
		const res = await call();
		expect(res.body.details[0]).toMatchObject({ runId: 'run-9', status: 'claimed', sig: 'sig-9' });
		expect(claimBodies).toHaveLength(1);
		expect(claimBodies[0]).toMatchObject({ agent_id: agentId, mint, network: 'mainnet' });
	});
});

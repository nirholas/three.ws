// RPC-burn fix for the x402 ring leak scanner (api/cron/x402-ring-leak-scan.js).
//
// Order 400, 2026-10-11: the lease + time budget from the prior fix still let a
// single run start nearly the entire 2,006-wallet registry (each cold wallet is
// one cheap getSignaturesForAddress call, well inside the 200 s budget), so RPC
// demand only dropped from "~8 overlapping full scans" to "~1 full scan every
// lease window" instead of the intended partial rotation. These pin the fix: a
// hard per-run cap on cold wallets, a ledger-active priority tier scanned every
// run regardless of rotation position, and a checked_at stamp on a zero-signature
// wallet so rotation coverage is visible without re-walking the chain.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = {
	lockHeld: false,
	registry: [],
	ledgerActive: [],
	offset: 0,
	roles: { payer: null, treasury: null, sponsor: null },
	sigsByWallet: {},
	sigCallOrder: [],
	cursorInserts: [],
	cacheSetCalls: [],
};

vi.mock('../api/_lib/cache.js', () => ({
	acquireLock: vi.fn(async () => !state.lockHeld),
	cacheGet: vi.fn(async () => state.offset),
	cacheSet: vi.fn(async (key, val) => { state.cacheSetCalls.push({ key, val }); }),
}));

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn((strings, ...values) => {
		const text = Array.isArray(strings) ? strings.join('|') : String(strings);
		if (text.includes('FROM x402_ring_wallets WHERE enabled')) {
			return Promise.resolve(state.registry.map((w) => ({ pubkey: w })));
		}
		if (text.includes('FROM x402_ring_ledger')) {
			return Promise.resolve(state.ledgerActive.map((w) => ({ wallet: w })));
		}
		if (text.includes('SELECT last_signature')) {
			return Promise.resolve([]); // no wallet ever has a prior cursor in these tests
		}
		if (text.includes('INSERT INTO x402_ring_scan_cursor')) {
			const kind = text.includes('last_signature') ? 'save' : 'touch';
			state.cursorInserts.push({ kind, wallet: values[0] });
			return Promise.resolve([]);
		}
		return Promise.resolve([]);
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));

vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn(async () => {}) }));

vi.mock('../api/_lib/x402/ring-allowlist.js', () => ({
	ringAllowedAddresses: vi.fn(async () => new Set()),
	ringRoleWallets: vi.fn(async () => state.roles),
}));

vi.mock('@solana/web3.js', () => ({
	PublicKey: class { constructor(value) { this.value = value; } },
}));

vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: vi.fn(() => ({
		getSignaturesForAddress: vi.fn(async (pk) => {
			const wallet = pk.value;
			state.sigCallOrder.push(wallet);
			return state.sigsByWallet[wallet] || [];
		}),
		getParsedTransactions: vi.fn(async () => []),
	})),
}));

const { default: handler } = await import('../api/cron/x402-ring-leak-scan.js');

function call() {
	const req = { method: 'GET', url: '/api/cron/x402-ring-leak-scan', headers: { authorization: 'Bearer test-cron-secret' } };
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b ?? ''; this.writableEnded = true; this.headersSent = true; },
	};
	return handler(req, res).then(() => JSON.parse(res.body));
}

beforeEach(() => {
	process.env.CRON_SECRET = 'test-cron-secret';
	state.lockHeld = false;
	state.registry = [];
	state.ledgerActive = [];
	state.offset = 0;
	state.roles = { payer: null, treasury: null, sponsor: null };
	state.sigsByWallet = {};
	state.sigCallOrder = [];
	state.cursorInserts = [];
	state.cacheSetCalls = [];
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('x402 ring leak scan: single-flight lease', () => {
	it('skips without touching the chain while another run holds the lease', async () => {
		state.lockHeld = true;
		const body = await call();
		expect(body).toEqual({ ok: true, skipped: true, reason: 'lease_held' });
		expect(state.sigCallOrder).toEqual([]);
	});
});

describe('x402 ring leak scan: wallet priority', () => {
	it('scans role wallets, then ledger-active wallets, then the cold rotation', async () => {
		state.roles = { payer: null, treasury: 'ROLE_TREASURY', sponsor: null };
		state.registry = ['ROLE_TREASURY', 'LEDGER_ACTIVE_1', 'COLD_1', 'COLD_2', 'COLD_3'];
		state.ledgerActive = ['LEDGER_ACTIVE_1'];

		await call();

		expect(state.sigCallOrder).toEqual(['ROLE_TREASURY', 'LEDGER_ACTIVE_1', 'COLD_1', 'COLD_2', 'COLD_3']);
	});

	it('stamps checked_at for every wallet scanned with zero new signatures', async () => {
		state.roles = { payer: null, treasury: 'ROLE_TREASURY', sponsor: null };
		state.registry = ['ROLE_TREASURY', 'LEDGER_ACTIVE_1', 'COLD_1', 'COLD_2', 'COLD_3'];
		state.ledgerActive = ['LEDGER_ACTIVE_1'];

		await call();

		const touched = state.cursorInserts.filter((c) => c.kind === 'touch').map((c) => c.wallet);
		expect(touched.sort()).toEqual(['COLD_1', 'COLD_2', 'COLD_3', 'LEDGER_ACTIVE_1', 'ROLE_TREASURY'].sort());
	});
});

describe('x402 ring leak scan: run budget', () => {
	it('reports a partial run and still saves cursors for every wallet that completed', async () => {
		state.registry = ['W1', 'W2', 'W3', 'W4', 'W5'];

		let clock = 1_000;
		vi.spyOn(Date, 'now').mockImplementation(() => clock);
		// Every chain read costs enough wall-clock that the FIRST one already blows
		// the 200 s run budget for every wallet still queued behind it - pins that a
		// slow/degraded RPC lane stops STARTING new wallets rather than letting a
		// single lease window try to cover the whole registry regardless of cost.
		const BUMP_MS = 250_000;

		const req = { method: 'GET', url: '/api/cron/x402-ring-leak-scan', headers: { authorization: 'Bearer test-cron-secret' } };
		const res = {
			statusCode: 200, headers: {}, body: '', headersSent: false, writableEnded: false,
			setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
			getHeader(k) { return this.headers[k.toLowerCase()]; },
			end(b) { this.body = b ?? ''; this.writableEnded = true; this.headersSent = true; },
		};

		// Reach into the mocked connection to bump the fake clock per chain read,
		// instead of the module-level state.clockBumpMs hook (kept simple for the
		// other tests above).
		const conn = await import('../api/_lib/solana/connection.js');
		conn.solanaConnection.mockReturnValueOnce({
			getSignaturesForAddress: vi.fn(async (pk) => {
				state.sigCallOrder.push(pk.value);
				clock += BUMP_MS;
				return [];
			}),
			getParsedTransactions: vi.fn(async () => []),
		});

		await handler(req, res);
		const body = JSON.parse(res.body);

		expect(body.partial).toBe(true);
		expect(body.remaining).toBe(1);
		expect(state.sigCallOrder).toHaveLength(4);
		const touched = state.cursorInserts.filter((c) => c.kind === 'touch').map((c) => c.wallet);
		expect(touched.sort()).toEqual(['W1', 'W2', 'W3', 'W4']);
	});
});

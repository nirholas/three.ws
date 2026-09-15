import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
// vi.mock factories are hoisted above imports, so the doubles they reference must
// be created with vi.hoisted().
const h = vi.hoisted(() => ({
	recentClaims: vi.fn(),
	graduations: vi.fn(),
	getClaims: vi.fn(),
	getWhales: vi.fn(),
	getMints: vi.fn(),
	getSignals: vi.fn(),
	sql: vi.fn(),
	state: { botEnabled: true },
}));

vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => h.sql(...a), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/pumpfun-mcp.js', () => ({
	pumpfunMcp: {
		recentClaims: (...a) => h.recentClaims(...a),
		graduations: (...a) => h.graduations(...a),
	},
	pumpfunBotEnabled: () => h.state.botEnabled,
}));
vi.mock('../api/_lib/channel-feed-sources.js', () => ({
	getClaims: (...a) => h.getClaims(...a),
	getWhales: (...a) => h.getWhales(...a),
	getMints: (...a) => h.getMints(...a),
	getSignals: (...a) => h.getSignals(...a),
}));
vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://test', ISSUER: 'http://test', MCP_RESOURCE: 'http://test' },
}));

const { default: dispatcher } = await import('../api/cron/[name].js');
const handler = (req, res) =>
	dispatcher({ ...req, query: { ...(req.query || {}), name: 'pumpfun-signals' } }, res);

// ── faithful in-memory Postgres double ────────────────────────────────────────
// The previous test returned [{id:1}] for every sql call, which masked the
// tx_signature-unique bug. This double enforces the real unique(tx_signature,
// kind) constraint and persists cursor state across calls so cursor behaviour is
// actually exercised.
let cursorState; // Map<source, last_seen_ms>
let insertedKeys; // Set<"tx:kind">
let insertedRows; // [{ wallet, agent_asset, kind, weight, tx_signature }]
let cursorWrites; // [{ source, last_seen_ms, last_signature }]
let linkedRows; // rows returned by the user_wallets → agent_identities lookup

function installSqlRouter() {
	h.sql.mockImplementation((strings, ...vals) => {
		const q = Array.isArray(strings) ? strings.join(' ? ') : String(strings);

		if (/from pumpfun_signals_cursor/.test(q)) {
			return Promise.resolve(
				[...cursorState.entries()].map(([source, last_seen_ms]) => ({ source, last_seen_ms })),
			);
		}
		if (/into pumpfun_signals_cursor/.test(q)) {
			const [source, ms, sig] = vals;
			cursorState.set(source, Math.max(cursorState.get(source) ?? 0, Number(ms) || 0));
			cursorWrites.push({ source, last_seen_ms: Number(ms) || 0, last_signature: sig ?? null });
			return Promise.resolve([]);
		}
		if (/from user_wallets/.test(q)) {
			return Promise.resolve(linkedRows);
		}
		if (/into pumpfun_signals\b/.test(q)) {
			// values: (wallet, agent_asset, kind, weight, payload, tx_signature)
			const [wallet, agent_asset, kind, weight, , tx_signature] = vals;
			const key = `${tx_signature}:${kind}`;
			if (insertedKeys.has(key)) return Promise.resolve([]); // unique(tx_signature, kind)
			insertedKeys.add(key);
			insertedRows.push({ wallet, agent_asset, kind, weight, tx_signature });
			return Promise.resolve([{ id: insertedKeys.size }]);
		}
		return Promise.resolve([]);
	});
}

function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; },
	};
}

const SECRET = 'topsecret';
async function run() {
	process.env.CRON_SECRET = SECRET;
	const req = { headers: { authorization: `Bearer ${SECRET}` }, method: 'POST' };
	const res = mockRes();
	await handler(req, res);
	return { res, body: JSON.parse(res.body) };
}

describe('pumpfun-signals cron', () => {
	beforeEach(() => {
		cursorState = new Map();
		insertedKeys = new Set();
		insertedRows = [];
		cursorWrites = [];
		linkedRows = [];
		h.state.botEnabled = true;
		h.recentClaims.mockReset().mockResolvedValue({ ok: true, data: [] });
		h.graduations.mockReset().mockResolvedValue({ ok: true, data: [] });
		h.getClaims.mockReset().mockResolvedValue([]);
		h.getWhales.mockReset().mockResolvedValue([]);
		h.getMints.mockReset().mockResolvedValue([]);
		h.getSignals.mockReset().mockResolvedValue([]);
		installSqlRouter();
		delete process.env.CRON_SECRET;
	});

	it('writes typed signals only for linked wallets, one row per (tx, kind)', async () => {
		h.recentClaims.mockResolvedValue({
			ok: true,
			data: [
				{
					tx_signature: 'sig1', signature: 'sig1', timestamp: 1000,
					claimer: 'WALLET_A', first_time_claim: true, tier: 'influencer',
					attribution_status: 'verified_repository',
					github_account_age_days: 5,
				},
				{ tx_signature: 'sig2', signature: 'sig2', timestamp: 1001, claimer: 'WALLET_UNKNOWN', first_time_claim: true },
			],
		});
		linkedRows = [{ address: 'WALLET_A', agent_asset: 'AGENT_A' }];

		const { body } = await run();

		expect(body.sources.claims).toBe(2);
		expect(body.skipped_unlinked).toBeGreaterThanOrEqual(1); // WALLET_UNKNOWN
		// WALLET_A: first_claim + influencer + new_account — three DISTINCT rows
		// for one tx, which the old single-column tx_signature unique forbade.
		expect(body.inserted).toBe(3);
		expect(insertedRows.map((r) => r.kind).sort()).toEqual(['first_claim', 'influencer', 'new_account']);
		expect(insertedRows.every((r) => r.agent_asset === 'AGENT_A')).toBe(true);
	});

	it('cursor skips already-seen events on the next run', async () => {
		h.recentClaims.mockResolvedValue({
			ok: true,
			data: [
				{ tx_signature: 'c1', signature: 'c1', timestamp: 100, claimer: 'W', first_time_claim: true, attribution_status: 'verified_repository' },
				{ tx_signature: 'c2', signature: 'c2', timestamp: 200, claimer: 'W', first_time_claim: true, attribution_status: 'verified_repository' },
			],
		});
		linkedRows = [{ address: 'W', agent_asset: 'A' }];

		const first = await run();
		expect(first.body.inserted).toBe(2);
		expect(first.body.skipped_by_cursor).toBe(0);
		// cursor advanced to the newest event (200s → 200000ms) for the claims lane
		expect(cursorState.get('claims')).toBe(200000);

		const second = await run();
		// Nothing new persists: c1 is strictly older than the cursor (skipped), c2
		// is at the boundary and collides on (tx, kind).
		expect(second.body.inserted).toBe(0);
		expect(second.body.skipped_by_cursor).toBeGreaterThanOrEqual(1);
	});

	it('does not turn an unverified first withdrawal into positive reputation', async () => {
		h.recentClaims.mockResolvedValue({
			ok: true,
			data: [{
				tx_signature: 'unverified1', timestamp: 300, claimer: 'W',
				first_time_claim: true, tier: 'influencer', attribution_status: 'identity_mismatch',
			}],
		});
		linkedRows = [{ address: 'W', agent_asset: 'A' }];

		const { body } = await run();
		expect(body.inserted).toBe(0);
		expect(insertedRows).toEqual([]);
	});

	it('emits whale_buy and launch signals from the redis lanes', async () => {
		h.getWhales.mockResolvedValue([
			{ signature: 'w1', timestamp: 10, mint: 'M1', amount_sol: 12.5, buyer: 'WB' },
		]);
		h.getMints.mockResolvedValue([
			{ signature: 'm1', timestamp: 11, mint: 'M2', name: 'Tok', symbol: 'TK', creator: 'WC' },
		]);
		linkedRows = [
			{ address: 'WB', agent_asset: 'AB' },
			{ address: 'WC', agent_asset: 'AC' },
		];

		const { body } = await run();

		expect(body.inserted).toBe(2);
		const byKind = Object.fromEntries(insertedRows.map((r) => [r.kind, r]));
		expect(byKind.whale_buy?.agent_asset).toBe('AB');
		expect(byKind.launch?.agent_asset).toBe('AC');
	});

	it('runs without the upstream bot — graduations still emit, claims are not fetched', async () => {
		h.state.botEnabled = false;
		h.graduations.mockResolvedValue({
			ok: true,
			data: [{ tx_signature: 'g1', signature: 'g1', timestamp: 7, mint: 'GM', symbol: 'GS', name: 'GN', creator: 'GW' }],
		});
		linkedRows = [{ address: 'GW', agent_asset: 'GA' }];

		const { body } = await run();

		expect(h.recentClaims).not.toHaveBeenCalled();
		expect(body.bot).toBe(false);
		expect(body.inserted).toBe(1);
		expect(insertedRows[0]).toMatchObject({ kind: 'graduation', agent_asset: 'GA' });
	});

	it('rejects without cron secret when CRON_SECRET set', async () => {
		process.env.CRON_SECRET = SECRET;
		const req = { headers: {}, method: 'POST' };
		const res = mockRes();
		await handler(req, res);
		expect(res.statusCode).toBe(401);
	});
});

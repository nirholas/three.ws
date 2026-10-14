// Tests for GET /api/pump/launch-receipt (api/pump/launch-receipt.js).
//
// The receipt composes four independent sources (token-stats, fee-info,
// the trade safety firewall, and a creation-transaction RPC walk). Each
// section is isolated: a source that throws must mark only its own section
// `{ available: false, reason }`, never invent a figure, and never take the
// rest of the receipt down with it. These tests pin that contract plus the
// full-success shape and the content_hash's stability.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
	stats: null,
	statsErr: null,
	feeInfo: null,
	feeErr: null,
	assessment: null,
	assessErr: null,
	sigPages: [],
	txResult: null,
};

vi.mock('../../api/pump/token-stats.js', () => ({
	buildStats: vi.fn(async () => {
		if (state.statsErr) throw state.statsErr;
		return state.stats;
	}),
}));

vi.mock('../../api/pump/[action].js', () => ({
	computeFeeInfo: vi.fn(async () => {
		if (state.feeErr) throw state.feeErr;
		return state.feeInfo;
	}),
}));

vi.mock('../../api/_lib/trade-firewall.js', () => ({
	assessTradeSafety: vi.fn(async () => {
		if (state.assessErr) throw state.assessErr;
		return state.assessment;
	}),
}));

vi.mock('../../api/_lib/pump.js', () => ({
	getConnection: vi.fn(() => ({
		_rpcRequest: vi.fn(async (method) => {
			if (method === 'getSignaturesForAddress') {
				const page = state.sigPages.shift() ?? [];
				return { result: page };
			}
			if (method === 'getTransaction') {
				if (state.txResult === 'error') return { error: { message: 'tatum gateway rejected the request' } };
				return { result: state.txResult };
			}
			throw new Error(`unexpected rpc method ${method}`);
		}),
	})),
}));

const { buildReceipt } = await import('../../api/pump/launch-receipt.js');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const FULL_STATS = {
	authorities: {
		mint_authority: null,
		freeze_authority: null,
		decimals: 6,
		supply: '1000000000000000',
	},
	holders: {
		count: 15,
		top10_pct: 0.25,
	},
};

const FULL_FEE_INFO = {
	fee_destination: 'CreatorVault111',
	creator: 'Creator111',
	is_graduated: true,
	claimable_sol: 1.23,
	sharing_config: null,
	is_cashback_coin: false,
	is_holder_reward: false,
	has_sharing_config: false,
};

const FULL_ASSESSMENT = {
	verdict: 'ok',
	score: 92,
	reasons: [],
	checks: [{ name: 'authority', status: 'pass' }],
};

// A real base64-encoded legacy wire transaction: 1 byte version marker-free
// (legacy format has no version prefix), signature, message header, two
// account keys, a blockhash, zero instructions. Built once rather than
// pulled off-chain so the test stays offline.
function buildLegacyTxBase64() {
	const sig = Buffer.alloc(64, 1);
	const header = Buffer.from([1, 1, 0]); // numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned
	const keys = Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 2), Buffer.alloc(32, 3)]);
	const blockhash = Buffer.alloc(32, 4);
	const instructions = Buffer.from([0]);
	const message = Buffer.concat([header, keys, blockhash, instructions]);
	const tx = Buffer.concat([Buffer.from([1]), sig, message]);
	return tx.toString('base64');
}

const LEGACY_TX_B64 = buildLegacyTxBase64();

function resetState() {
	state.stats = FULL_STATS;
	state.statsErr = null;
	state.feeInfo = FULL_FEE_INFO;
	state.feeErr = null;
	state.assessment = FULL_ASSESSMENT;
	state.assessErr = null;
	state.sigPages = [[{ signature: 'CREATE_SIG' }]];
	state.txResult = {
		slot: 100,
		blockTime: 1_700_000_000,
		transaction: [LEGACY_TX_B64],
	};
}

beforeEach(() => {
	resetState();
});

describe('buildReceipt: full success', () => {
	it('composes every section from its real source with no invented data', async () => {
		const r = await buildReceipt(MINT, 'mainnet');

		expect(r.mint).toBe(MINT);
		expect(r.network).toBe('mainnet');

		expect(r.authorities.mint_authority.enabled).toBe(false);
		expect(r.authorities.mint_authority.sentence).toMatch(/fixed/);
		expect(r.authorities.freeze_authority.enabled).toBe(false);

		expect(r.supply).toMatchObject({ available: true, raw: '1000000000000000', decimals: 6 });
		expect(r.supply.formatted).toBeCloseTo(1_000_000_000);

		expect(r.holders).toMatchObject({ available: true, top10_pct: 0.25, holder_count: 15 });
		expect(r.holders.sentence).toMatch(/25\.00%/);

		expect(r.fee_routing).toMatchObject({ available: true, applicable: true, destination: 'CreatorVault111' });
		expect(r.fee_routing.sentence).toMatch(/creator wallet/);

		expect(r.creation).toMatchObject({ available: true, signature: 'CREATE_SIG', slot: 100 });
		expect(r.creation.version_label).toBeTruthy();

		expect(r.risk).toMatchObject({ available: true, verdict: 'ok', score: 92 });

		expect(typeof r.generated_at).toBe('string');
		expect(r.content_hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('produces a stable content_hash for identical inputs, holding generated_at fixed', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));
		const a = await buildReceipt(MINT, 'mainnet');
		state.sigPages = [[{ signature: 'CREATE_SIG' }]];
		const b = await buildReceipt(MINT, 'mainnet');
		vi.useRealTimers();
		expect(a.content_hash).toBe(b.content_hash);
	});
});

describe('buildReceipt: per-section degradation', () => {
	it('marks only authorities/supply/holders unavailable when token-stats throws', async () => {
		state.statsErr = new Error('postgres pool exhausted');
		const r = await buildReceipt(MINT, 'mainnet');

		expect(r.authorities).toEqual({ available: false, reason: 'could not read the mint account from chain' });
		expect(r.supply).toEqual({ available: false, reason: 'could not read supply and decimals from the mint account' });
		expect(r.holders.available).toBe(false);

		// Unrelated sections still carry real data, not a fabricated stand-in.
		expect(r.fee_routing.available).toBe(true);
		expect(r.risk.available).toBe(true);
		expect(r.creation.available).toBe(true);
	});

	it('marks fee_routing unavailable (not a fake destination) when fee-info throws', async () => {
		state.feeErr = new Error('pump sdk rpc timeout');
		const r = await buildReceipt(MINT, 'mainnet');

		expect(r.fee_routing).toEqual({ available: false, reason: 'pump sdk rpc timeout' });
		expect(r.authorities.available).toBe(true);
		expect(r.risk.available).toBe(true);
	});

	it('reports fee_routing as not applicable (not unavailable) for a non-pump.fun mint', async () => {
		state.feeInfo = null;
		const r = await buildReceipt(MINT, 'mainnet');

		expect(r.fee_routing).toMatchObject({ available: true, applicable: false });
		expect(r.fee_routing.sentence).toMatch(/did not launch through pump\.fun/);
	});

	it('marks risk unavailable when the trade safety firewall throws', async () => {
		state.assessErr = new Error('firewall simulation RPC failed');
		const r = await buildReceipt(MINT, 'mainnet');

		expect(r.risk).toEqual({ available: false, reason: 'firewall simulation RPC failed' });
		expect(r.authorities.available).toBe(true);
		expect(r.fee_routing.available).toBe(true);
	});

	it('marks creation unavailable without a signature when the mint has no history', async () => {
		state.sigPages = [[]];
		const r = await buildReceipt(MINT, 'mainnet');

		expect(r.creation).toEqual({ available: false, reason: 'this mint has no transaction history on this RPC' });
	});

	it('marks creation unavailable when the RPC rejects getTransaction, surfacing the real reason', async () => {
		state.txResult = 'error';
		const r = await buildReceipt(MINT, 'mainnet');

		expect(r.creation.available).toBe(false);
		expect(r.creation.reason).toMatch(/tatum gateway rejected/);
	});

	it('never throws even when every source fails at once', async () => {
		state.statsErr = new Error('db down');
		state.feeErr = new Error('rpc down');
		state.assessErr = new Error('firewall down');
		state.sigPages = [[]];

		const r = await buildReceipt(MINT, 'mainnet');

		expect(r.authorities.available).toBe(false);
		expect(r.supply.available).toBe(false);
		expect(r.holders.available).toBe(false);
		expect(r.fee_routing.available).toBe(false);
		expect(r.risk.available).toBe(false);
		expect(r.creation.available).toBe(false);
		expect(r.content_hash).toMatch(/^[0-9a-f]{64}$/);
	});
});

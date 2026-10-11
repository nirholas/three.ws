// Unit tests for api/_lib/agent-trade-guards.js — the shared per-agent spend
// policy + custody ledger that governs withdraw / x402 / snipe / trade.
//
// Covers: Solana address validation (base58, on-curve, PDA rejection),
// spend-limit normalization, and enforcement of the per-tx + daily USD ceilings
// and the withdraw allowlist. The DB + SOL price feed are mocked so these are
// deterministic and fast.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';

// ── mocks ─────────────────────────────────────────────────────────────────────
const sqlState = { queue: [], calls: [], handler: null };
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const query = strings.join('?');
		sqlState.calls.push({ query, values });
		const handled = sqlState.handler ? sqlState.handler(query, values) : undefined;
		if (handled !== undefined) return handled;
		return sqlState.queue.length ? sqlState.queue.shift() : [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

vi.mock('../api/_lib/avatar-wallet.js', () => ({
	solUsdPrice: vi.fn(async () => 200), // $200 / SOL
}));

vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));

// The behavioral anomaly guard is an additive layer composed into enforceSpendLimit
// / reserveSpendUsd; it has its own dedicated tests (wallet-anomaly*.test.js). Stub
// it here so these USD-ceiling unit tests stay isolated from its async DB calls.
vi.mock('../api/_lib/anomaly-events.js', () => ({
	guardOutboundAnomaly: vi.fn(async () => ({ decision: 'allow', verdict: null, anomalyId: null, froze: false })),
}));

const guards = await import('../api/_lib/agent-trade-guards.js');
const {
	validateSolanaAddress, normalizeSpendLimits, enforceSpendLimit, SpendLimitError,
	getDailySpendUsd, lamportsToUsd, getSpendLimits,
} = guards;

beforeEach(() => {
	sqlState.queue = [];
	sqlState.calls = [];
	sqlState.handler = null;
});

// The destination allowlist is table-backed: serve the settings row and the
// matching destination entry (if any) from the fake database.
function serveAllowlist({ enforced = true, entry = null } = {}) {
	sqlState.handler = (query) => {
		if (query.includes('destination_whitelist_settings')) return [{ agent_id: 'a', cooldown_seconds: 86400, enforced, pending_change: null }];
		if (query.includes('destination_whitelist_entries')) return entry ? [entry] : [];
		return undefined;
	};
}
const activeEntry = (address) => ({
	id: 'e1', agent_id: 'a', chain: 'solana', address, address_key: address, label: 'Cold', status: 'active',
	proposed_by: 'owner', activates_at: new Date(Date.now() - 1000).toISOString(), per_tx_cap_usd: null, daily_cap_usd: null,
});

// ── address validation ─────────────────────────────────────────────────────────
describe('validateSolanaAddress', () => {
	it('accepts a real on-curve wallet address', () => {
		const addr = Keypair.generate().publicKey.toBase58();
		const r = validateSolanaAddress(addr);
		expect(r.valid).toBe(true);
		expect(r.onCurve).toBe(true);
		expect(r.base58).toBe(addr);
	});

	it('flags a program-derived (off-curve) address as not on-curve', () => {
		const [pda] = PublicKey.findProgramAddressSync([Buffer.from('custody-test')], SystemProgram.programId);
		const r = validateSolanaAddress(pda.toBase58());
		expect(r.valid).toBe(true);
		expect(r.onCurve).toBe(false);
	});

	it('rejects non-base58 input', () => {
		expect(validateSolanaAddress('not an address!').valid).toBe(false);
		expect(validateSolanaAddress('not an address!').reason).toBe('not_base58');
	});

	it('rejects empty / non-string input', () => {
		expect(validateSolanaAddress('').valid).toBe(false);
		expect(validateSolanaAddress(null).valid).toBe(false);
		expect(validateSolanaAddress(undefined).valid).toBe(false);
	});

	it('rejects a base58 string that is the wrong byte length', () => {
		// 5 base58 chars passes the length pre-filter's lower bound? No — min 32.
		expect(validateSolanaAddress('abc').valid).toBe(false);
	});
});

// ── limit normalization ─────────────────────────────────────────────────────────
describe('normalizeSpendLimits', () => {
	it('defaults to unset ceilings + empty allowlist', () => {
		const n = normalizeSpendLimits(undefined);
		expect(n.daily_usd).toBeNull();
		expect(n.per_tx_usd).toBeNull();
		expect(n.withdraw_allowlist).toEqual([]);
	});

	it('coerces numeric strings and rejects negatives', () => {
		expect(normalizeSpendLimits({ daily_usd: '50', per_tx_usd: 25 }).daily_usd).toBe(50);
		expect(normalizeSpendLimits({ daily_usd: -5 }).daily_usd).toBeNull();
		expect(normalizeSpendLimits({ per_tx_usd: 'abc' }).per_tx_usd).toBeNull();
	});

	it('filters invalid + de-dupes allowlist addresses', () => {
		const a = Keypair.generate().publicKey.toBase58();
		const n = normalizeSpendLimits({ withdraw_allowlist: [a, 'garbage', a] });
		expect(n.withdraw_allowlist).toEqual([a]);
	});

	it('getSpendLimits reads off meta.spend_limits', () => {
		const a = Keypair.generate().publicKey.toBase58();
		const lim = getSpendLimits({ spend_limits: { daily_usd: 100, withdraw_allowlist: [a] } });
		expect(lim.daily_usd).toBe(100);
		expect(lim.withdraw_allowlist).toEqual([a]);
	});
});

// ── enforcement ─────────────────────────────────────────────────────────────────
describe('enforceSpendLimit', () => {
	const noLimits = { daily_usd: null, per_tx_usd: null, withdraw_allowlist: [] };

	it('passes when no ceilings are set', async () => {
		const r = await enforceSpendLimit({ agentId: 'a', limits: noLimits, category: 'x402', usdValue: 9999 });
		expect(r.ok).toBe(true);
	});

	it('blocks an over-limit single transaction with a 403 SpendLimitError', async () => {
		await expect(
			enforceSpendLimit({ agentId: 'a', limits: { ...noLimits, per_tx_usd: 10 }, category: 'x402', usdValue: 25 }),
		).rejects.toMatchObject({ name: 'SpendLimitError', code: 'per_tx_exceeded', status: 403 });
	});

	it('allows a transaction at the per-tx ceiling', async () => {
		const r = await enforceSpendLimit({ agentId: 'a', limits: { ...noLimits, per_tx_usd: 10 }, category: 'x402', usdValue: 10 });
		expect(r.ok).toBe(true);
	});

	it('blocks a withdraw to a non-allowlisted destination', async () => {
		const other = Keypair.generate().publicKey.toBase58();
		serveAllowlist({ entry: null });
		await expect(
			enforceSpendLimit({ agentId: 'a', limits: noLimits, category: 'withdraw', usdValue: 1, destination: other }),
		).rejects.toMatchObject({ code: 'destination_not_whitelisted' });
	});

	it('allows a withdraw to an allowlisted destination', async () => {
		const allowed = Keypair.generate().publicKey.toBase58();
		serveAllowlist({ entry: activeEntry(allowed) });
		const r = await enforceSpendLimit({ agentId: 'a', limits: noLimits, category: 'withdraw', usdValue: 1, destination: allowed });
		expect(r.ok).toBe(true);
	});

	it('does not gate non-withdraw paths on the withdraw allowlist', async () => {
		const allowed = Keypair.generate().publicKey.toBase58();
		const r = await enforceSpendLimit({ agentId: 'a', limits: { ...noLimits, withdraw_allowlist: [allowed] }, category: 'x402', usdValue: 1, destination: 'whatever' });
		expect(r.ok).toBe(true);
	});

	it('blocks when the rolling daily total would exceed the cap', async () => {
		sqlState.queue.push([{ usd: 30 }]); // already spent today
		await expect(
			enforceSpendLimit({ agentId: 'a', limits: { ...noLimits, daily_usd: 50 }, category: 'snipe', usdValue: 25, network: 'mainnet' }),
		).rejects.toMatchObject({ code: 'daily_exceeded' });
	});

	it('allows when the daily total stays within the cap', async () => {
		sqlState.queue.push([{ usd: 10 }]);
		const r = await enforceSpendLimit({ agentId: 'a', limits: { ...noLimits, daily_usd: 50 }, category: 'snipe', usdValue: 25 });
		expect(r.ok).toBe(true);
		expect(r.dailySpentUsd).toBe(10);
	});

	it('skips the USD ceilings for an unpriceable asset (allowlist still applies)', async () => {
		// usdValue null → daily/per-tx ceilings can't be evaluated and must not throw.
		// The behavioral anomaly guard still runs (it scores destination/velocity, which
		// matter regardless of price), but the daily USD ledger must never be summed.
		const r = await enforceSpendLimit({ agentId: 'a', limits: { ...noLimits, daily_usd: 1, per_tx_usd: 1 }, category: 'withdraw', usdValue: null, destination: Keypair.generate().publicKey.toBase58() });
		expect(r.ok).toBe(true);
		const summedLedger = sqlState.calls.some((c) => /SUM\(usd\)/.test(c.query) && /agent_custody_events/.test(c.query));
		expect(summedLedger).toBe(false); // never summed the USD ledger for an unpriceable spend
	});

	it('SpendLimitError is the exported class with the breach detail', async () => {
		try {
			await enforceSpendLimit({ agentId: 'a', limits: { daily_usd: null, per_tx_usd: 5, withdraw_allowlist: [] }, category: 'trade', usdValue: 50 });
			throw new Error('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(SpendLimitError);
			expect(e.detail.per_tx_usd).toBe(5);
			expect(e.detail.usd).toBe(50);
		}
	});
});

// ── ledger reads ────────────────────────────────────────────────────────────────
describe('getDailySpendUsd / lamportsToUsd', () => {
	it('returns the summed USD from the ledger', async () => {
		sqlState.queue.push([{ usd: 123.45 }]);
		expect(await getDailySpendUsd('a', 'mainnet')).toBe(123.45);
	});

	it('treats a null sum as zero', async () => {
		sqlState.queue.push([{ usd: null }]);
		expect(await getDailySpendUsd('a')).toBe(0);
	});

	it('converts lamports to USD at the live price', async () => {
		// 1 SOL at the mocked $200
		expect(await lamportsToUsd(1_000_000_000n)).toBeCloseTo(200, 6);
	});
});

// ── wallet freeze (kill switch) ──────────────────────────────────────────────
describe('wallet freeze', () => {
	it('normalizes frozen to a strict boolean (default false)', () => {
		expect(normalizeSpendLimits({}).frozen).toBe(false);
		expect(normalizeSpendLimits({ frozen: true }).frozen).toBe(true);
		expect(normalizeSpendLimits({ frozen: 'yes' }).frozen).toBe(false); // only literal true freezes
	});

	it('blocks an autonomous trade when frozen', async () => {
		const limits = normalizeSpendLimits({ frozen: true });
		await expect(
			enforceSpendLimit({ agentId: 'a', limits, category: 'trade', usdValue: 1 }),
		).rejects.toMatchObject({ code: 'wallet_frozen', status: 403 });
	});

	it('blocks snipe and x402 when frozen', async () => {
		const limits = normalizeSpendLimits({ frozen: true });
		for (const category of ['snipe', 'x402']) {
			await expect(
				enforceSpendLimit({ agentId: 'a', limits, category, usdValue: 5 }),
			).rejects.toMatchObject({ code: 'wallet_frozen' });
		}
	});

	it('NEVER blocks the owner withdraw when frozen (funds must stay evacuable)', async () => {
		const limits = normalizeSpendLimits({ frozen: true });
		const r = await enforceSpendLimit({ agentId: 'a', limits, category: 'withdraw', usdValue: 10, destination: Keypair.generate().publicKey.toBase58() });
		expect(r.ok).toBe(true);
	});

	it('does not block any path when not frozen', async () => {
		const limits = normalizeSpendLimits({ frozen: false });
		const r = await enforceSpendLimit({ agentId: 'a', limits, category: 'trade', usdValue: 1 });
		expect(r.ok).toBe(true);
	});
});

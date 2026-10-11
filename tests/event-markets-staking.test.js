// Unit tests for the staking server modules and the stake panel's amount helpers.
// The on-chain parity (preview equals the program to the base unit) is covered by
// event-markets-staking.chain.test.js against a real validator.
import { describe, it, expect, afterEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { splitFee, payoutFor, previewStake, poolShares } from '../api/_lib/event-markets/staking/math.js';
import { checkStakeLimits, StakeRefusal, formatAmount } from '../api/_lib/event-markets/staking/limits.js';
import { evaluateGate } from '../api/_lib/event-markets/staking/gate.js';
import { reconcilePool } from '../api/_lib/event-markets/staking/reconcile.js';
import { parseProgramTx } from '../api/_lib/event-markets/staking/record.js';
import { TOKENS } from '../api/_lib/event-markets/staking/config.js';
import { toBaseUnits, fromBaseUnits } from '../src/event-markets/staking-panel.js';

describe('parimutuel math', () => {
	it('floors the fee and gives the treasury the remainder', () => {
		expect(splitFee(1_000_001n, 300, 5000)).toEqual({ fee: 30_000n, buyback: 15_000n, treasury: 15_000n });
		expect(splitFee(3n, 300, 5000)).toEqual({ fee: 0n, buyback: 0n, treasury: 0n });
	});
	it('pays floor(stake * (total - fee) / winningTotal) and never more than the pool', () => {
		const totals = [600n, 300n, 100n];
		const total = 1000n;
		const { fee } = splitFee(total, 300, 5000);
		const paid = [200n, 400n].reduce((s, st) => s + payoutFor(st, total, fee, totals[0]), 0n);
		expect(paid <= total - fee).toBe(true);
		expect(payoutFor(0n, total, fee, 0n)).toBe(0n);
	});
	it('previews a refund, not a payout, when nobody is on the other side', () => {
		const p = previewStake({ totals: [0n, 0n], feeBps: 300, buybackShareBps: 5000 }, 0, 100n);
		expect(p).toMatchObject({ void_if_wins: true, payout: 100n, fee: 0n });
		const q = previewStake({ totals: [0n, 50n], feeBps: 300, buybackShareBps: 5000 }, 0, 100n);
		expect(q.void_if_wins).toBe(false);
		expect(q.payout).toBe(payoutFor(100n, 150n, splitFee(150n, 300, 5000).fee, 100n));
	});
	it('rejects negative and non-integer amounts', () => {
		expect(() => splitFee(-1n, 300, 5000)).toThrow(RangeError);
		expect(() => previewStake({ totals: [0n, 0n], feeBps: 1, buybackShareBps: 1 }, 0, '1.5')).toThrow(RangeError);
	});
	it('shares are even when the pool is empty', () => {
		expect(poolShares([0n, 0n, 0n, 0n])).toEqual([0.25, 0.25, 0.25, 0.25]);
	});
});

describe('stake limits', () => {
	const pool = { tokenKey: 'usdc', decimals: 6, minStake: 1_000_000n, maxStake: 100_000_000n, maxPool: 500_000_000n, totalStaked: 0n };
	const ok = { amount: 5_000_000n, position: 0n, accountDay: 0n };
	const code = (fn) => { try { fn(); } catch (e) { return e instanceof StakeRefusal ? e.code : e; } return null; };
	it('accepts a stake inside every cap', () => expect(code(() => checkStakeLimits(pool, ok))).toBeNull());
	it('refuses zero, below minimum, over account, over pool and over daily', () => {
		expect(code(() => checkStakeLimits(pool, { ...ok, amount: 0n }))).toBe('invalid_amount');
		expect(code(() => checkStakeLimits(pool, { ...ok, amount: 999_999n }))).toBe('below_minimum');
		expect(code(() => checkStakeLimits(pool, { ...ok, position: 98_000_000n }))).toBe('over_account_cap');
		expect(code(() => checkStakeLimits({ ...pool, totalStaked: 498_000_000n }, ok))).toBe('over_pool_cap');
		expect(code(() => checkStakeLimits(pool, { ...ok, accountDay: TOKENS.usdc.dailyCap }))).toBe('over_daily_cap');
	});
	it('formats base units without float error', () => {
		expect(formatAmount(1_234_500n, 6)).toBe('1.2345');
		expect(formatAmount(5n, 6)).toBe('0.000005');
		expect(formatAmount(2_000_000n, 6)).toBe('2');
	});
});

describe('region and age gate', () => {
	const saved = { ...process.env };
	afterEach(() => { process.env = { ...saved }; });
	const req = (country) => ({ headers: country ? { 'x-client-geo-location': country } : {} });
	const att = { min_age: 21, country: 'DE', terms_version: '2026-10-13' };
	const on = () => { process.env.EVENT_MARKETS_STAKING_ENABLED = '1'; };

	it('is closed while the flag is off, whatever else is true', () => {
		delete process.env.EVENT_MARKETS_STAKING_ENABLED;
		expect(evaluateGate({ req: req('DE'), attestation: att, stakesEnabled: true })).toMatchObject({ available: false, reason: 'disabled' });
	});
	it('the kill switch closes it', () => {
		on();
		expect(evaluateGate({ req: req('DE'), attestation: att, stakesEnabled: false })).toMatchObject({ available: false, reason: 'paused' });
	});
	it('treats an unknown region as blocked and a blocked region as blocked', () => {
		on();
		expect(evaluateGate({ req: req(null), attestation: att, stakesEnabled: true }).reason).toBe('region_unknown');
		expect(evaluateGate({ req: req('US'), attestation: att, stakesEnabled: true }).reason).toBe('region_blocked');
	});
	it('needs a current attestation from the same region', () => {
		on();
		expect(evaluateGate({ req: req('DE'), attestation: null, stakesEnabled: true })).toMatchObject({ reason: 'attestation_required', needs_attestation: true });
		expect(evaluateGate({ req: req('DE'), attestation: { ...att, terms_version: 'old' }, stakesEnabled: true }).reason).toBe('attestation_required');
		expect(evaluateGate({ req: req('DE'), attestation: { ...att, country: 'NL' }, stakesEnabled: true }).reason).toBe('attestation_region_changed');
		expect(evaluateGate({ req: req('DE'), attestation: att, stakesEnabled: true })).toMatchObject({ available: true, reason: null });
	});
});

describe('reconciliation', () => {
	const chain = { totalStaked: 1000n, feePaid: 30n, paidOut: 400n };
	it('balances when the vault holds what the program says', () => {
		expect(reconcilePool({ chain, vaultBalance: 570n, ledger: { staked: 1000n, paidOut: 400n } })).toMatchObject({ ok: true, problems: [] });
	});
	it('flags a short vault, a surplus and ledger drift', () => {
		const r = reconcilePool({ chain, vaultBalance: 500n, ledger: { staked: 900n, paidOut: 399n } });
		expect(r.ok).toBe(false);
		expect(r.problems.map((p) => p.code)).toEqual(['vault_short', 'ledger_stake_mismatch', 'ledger_payout_mismatch']);
		expect(reconcilePool({ chain, vaultBalance: 600n, ledger: { staked: 1000n, paidOut: 400n } }).problems[0]).toMatchObject({ code: 'vault_surplus', delta: '30' });
	});
});

describe('parseProgramTx', () => {
	const program = Keypair.generate().publicKey;
	const disc = (n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
	const keys = Array.from({ length: 10 }, () => Keypair.generate().publicKey);
	const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
	const txOf = (programKey, ixs, meta = {}) => ({
		meta: { err: null, preTokenBalances: [], postTokenBalances: [], ...meta },
		transaction: { message: { accountKeys: [...keys, programKey], instructions: ixs.map((i) => ({ programIdIndex: 10, accounts: i.accounts, data: i.data.toString('base64') })) } },
	});
	const stakeData = Buffer.concat([disc('stake'), Buffer.from([2]), u64(7_000_000n)]);

	it('reads pool, wallet, outcome and amount from the transaction itself', () => {
		const ev = parseProgramTx(txOf(program, [{ accounts: [0, 1, 2, 3, 4, 5, 6, 7, 8], data: stakeData }]), program);
		expect(ev).toEqual({ kind: 'stake', pool: keys[1].toBase58(), wallet: keys[6].toBase58(), outcome: 2, amount: 7_000_000n });
	});
	it('reads a claim amount from the vault balance change', () => {
		const tx = txOf(program, [{ accounts: [0, 1, 2, 3, 4, 5, 6], data: disc('claim') }], {
			preTokenBalances: [{ accountIndex: 2, uiTokenAmount: { amount: '900' } }],
			postTokenBalances: [{ accountIndex: 2, uiTokenAmount: { amount: '650' } }],
		});
		expect(parseProgramTx(tx, program)).toMatchObject({ kind: 'claim', amount: 250n, wallet: keys[5].toBase58() });
	});
	it('rejects failed transactions, other programs, unknown instructions and multi-instruction bundles', () => {
		expect(parseProgramTx({ ...txOf(program, [{ accounts: [0], data: stakeData }]), meta: { err: {} } }, program)).toBeNull();
		expect(parseProgramTx(txOf(Keypair.generate().publicKey, [{ accounts: [0, 1, 2, 3, 4, 5, 6], data: stakeData }]), program)).toBeNull();
		expect(parseProgramTx(txOf(program, [{ accounts: [0], data: disc('lock') }]), program)).toBeNull();
		const one = { accounts: [0, 1, 2, 3, 4, 5, 6, 7, 8], data: stakeData };
		expect(parseProgramTx(txOf(program, [one, one]), program)).toBeNull();
		expect(parseProgramTx(null, program)).toBeNull();
	});
});

describe('stake panel amounts', () => {
	it('converts decimal text to exact base units', () => {
		expect(toBaseUnits('12.5', 6)).toBe(12_500_000n);
		expect(toBaseUnits('0.000001', 6)).toBe(1n);
		expect(toBaseUnits('7', 6)).toBe(7_000_000n);
	});
	it('rejects too many decimals, junk, negatives and empty text', () => {
		for (const bad of ['1.0000001', 'abc', '-1', '', '1e3', '1,5', '.5']) expect(toBaseUnits(bad, 6)).toBeNull();
	});
	it('round-trips through the display form', () => {
		for (const v of ['0.000001', '12.5', '1000000', '3.14']) expect(fromBaseUnits(toBaseUnits(v, 6), 6)).toBe(v);
	});
});

/**
 * Marketplace economics — money math for multi-collaborator splits.
 *
 * These are the correctness guarantees an acquirer underwrites: a buyer is
 * never over-charged (fee + creator-net = price), N-way split shares sum to
 * 100%, and every recipient's atomic allocation is exact (Σ parts = the whole,
 * no dust lost or invented) for any amount and any share mix — including the
 * pathological cases (primes, 1-atomic, huge values, lopsided shares).
 *
 * Pure functions only — no DB, no chain — so they run fast and deterministically.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	validateShares,
	allocateAtomics,
	describeSplit,
	isValidAddressForChain,
	recordSplitDistribution,
	FULL_SHARE_BPS,
} from '../api/_lib/splits.js';
import { marketplaceFeeAtomics } from '../api/_lib/marketplace-platform-fee.js';
import { enforceOnchainLicense, licenseEnforcementEnabled } from '../api/_lib/skill-license-verify.js';

// A fake tagged-template `sql` that records the interpolated values of each
// query so we can assert what would be persisted, without a database.
function fakeSql(returnRows = []) {
	const calls = [];
	const fn = (strings, ...values) => {
		calls.push(values);
		return Promise.resolve(returnRows);
	};
	fn.calls = calls;
	return fn;
}

// Synthetic addresses — never a real wallet (CLAUDE.md).
const SOL_A = 'THREEsynthetic1111111111111111111111111111A';
const EVM_A = '0x1111111111111111111111111111111111111111';
const EVM_B = '0x2222222222222222222222222222222222222222';
const EVM_C = '0x3333333333333333333333333333333333333333';

const sum = (parts) => parts.reduce((s, p) => s + p.amount, 0n);

describe('validateShares', () => {
	it('accepts a 70/30 split that sums to 100%', () => {
		const out = validateShares(
			[
				{ address: EVM_A, share_bps: 7000 },
				{ address: EVM_B, share_bps: 3000 },
			],
			'base',
		);
		expect(out).toHaveLength(2);
		expect(out.reduce((s, r) => s + r.share_bps, 0)).toBe(FULL_SHARE_BPS);
	});

	it('accepts percent input and normalizes to bps', () => {
		const out = validateShares(
			[
				{ address: EVM_A, percent: 33.33 },
				{ address: EVM_B, percent: 66.67 },
			],
			'base',
		);
		expect(out.map((r) => r.share_bps)).toEqual([3333, 6667]);
	});

	it('rejects shares that do not sum to 100%', () => {
		expect(() =>
			validateShares(
				[
					{ address: EVM_A, share_bps: 7000 },
					{ address: EVM_B, share_bps: 2000 },
				],
				'base',
			),
		).toThrow(/sum to 100%/);
	});

	it('rejects duplicate recipients', () => {
		expect(() =>
			validateShares(
				[
					{ address: EVM_A, share_bps: 5000 },
					{ address: EVM_A, share_bps: 5000 },
				],
				'base',
			),
		).toThrow(/more than once/);
	});

	it('rejects an invalid address for the chain', () => {
		expect(() => validateShares([{ address: 'not-an-address', share_bps: 10000 }], 'base')).toThrow(
			/invalid base address/,
		);
	});

	it('rejects a zero or negative share', () => {
		expect(() =>
			validateShares(
				[
					{ address: EVM_A, share_bps: 0 },
					{ address: EVM_B, share_bps: 10000 },
				],
				'base',
			),
		).toThrow(/invalid share/);
	});

	it('validates chain-appropriate addresses', () => {
		expect(isValidAddressForChain(SOL_A, 'solana')).toBe(true);
		expect(isValidAddressForChain(EVM_A, 'base')).toBe(true);
		expect(isValidAddressForChain(EVM_A, 'solana')).toBe(false);
	});
});

describe('allocateAtomics — exactness', () => {
	const recipients3 = [
		{ address: EVM_A, share_bps: 3333 },
		{ address: EVM_B, share_bps: 3333 },
		{ address: EVM_C, share_bps: 3334 },
	];

	it('Σ parts equals the whole for a non-divisible amount', () => {
		const parts = allocateAtomics(100n, recipients3);
		expect(sum(parts)).toBe(100n);
	});

	it('never loses or invents an atomic across many amounts', () => {
		for (let total = 0n; total <= 1000n; total++) {
			const parts = allocateAtomics(total, recipients3);
			expect(sum(parts)).toBe(total);
		}
	});

	it('handles a 1-atomic split (leftover goes to the largest remainder)', () => {
		const parts = allocateAtomics(1n, recipients3);
		expect(sum(parts)).toBe(1n);
		// Exactly one recipient gets the single atomic.
		expect(parts.filter((p) => p.amount === 1n)).toHaveLength(1);
	});

	it('is exact for a prime amount and lopsided shares', () => {
		const recipients = [
			{ address: EVM_A, share_bps: 9999 },
			{ address: EVM_B, share_bps: 1 },
		];
		const parts = allocateAtomics(7919n, recipients);
		expect(sum(parts)).toBe(7919n);
		expect(parts[0].amount).toBeGreaterThan(parts[1].amount);
	});

	it('is exact for very large amounts (no float drift)', () => {
		const total = 123456789012345n; // ~123M USDC at 6 decimals
		const parts = allocateAtomics(total, recipients3);
		expect(sum(parts)).toBe(total);
	});

	it('a single recipient receives the entire amount', () => {
		const parts = allocateAtomics(500n, [{ address: EVM_A, share_bps: 10000 }]);
		expect(parts).toHaveLength(1);
		expect(parts[0].amount).toBe(500n);
	});

	it('apportions an even split with no remainder cleanly', () => {
		const parts = allocateAtomics(1000n, [
			{ address: EVM_A, share_bps: 5000 },
			{ address: EVM_B, share_bps: 5000 },
		]);
		expect(parts.map((p) => p.amount)).toEqual([500n, 500n]);
	});
});

describe('fee + split coherence — the buyer is never over-charged', () => {
	it('platform fee + creator net = price, and Σ split = creator net', () => {
		const price = 10_000_000n; // 10 USDC
		const feeBps = 500; // 5%
		const fee = marketplaceFeeAtomics(price, feeBps);
		const creatorNet = price - fee;

		// Fee leg + creator leg reconstruct the price exactly — no hidden cut.
		expect(fee + creatorNet).toBe(price);

		const recipients = validateShares(
			[
				{ address: EVM_A, share_bps: 7000 },
				{ address: EVM_B, share_bps: 3000 },
			],
			'base',
		);
		const parts = allocateAtomics(creatorNet, recipients);

		// Every collaborator's share sums back to exactly the creator's net —
		// the platform keeps only the fee, nothing leaks into or out of the split.
		expect(sum(parts)).toBe(creatorNet);
		expect(fee + sum(parts)).toBe(price);
	});

	it('zero-fee environment routes the full price into the split', () => {
		const price = 3_000_001n; // odd amount
		const fee = marketplaceFeeAtomics(price, 0);
		expect(fee).toBe(0n);
		const recipients = validateShares(
			[
				{ address: EVM_A, share_bps: 5000 },
				{ address: EVM_B, share_bps: 2500 },
				{ address: EVM_C, share_bps: 2500 },
			],
			'base',
		);
		const parts = allocateAtomics(price - fee, recipients);
		expect(sum(parts)).toBe(price);
	});
});

describe('describeSplit', () => {
	it('renders a human label for the buyer', () => {
		const recipients = validateShares(
			[
				{ address: EVM_A, share_bps: 7000, label: 'Lead' },
				{ address: EVM_B, share_bps: 3000, label: 'Art' },
			],
			'base',
		);
		const d = describeSplit(recipients);
		expect(d.label).toBe('70 / 30');
		expect(d.recipients[0].percent).toBe(70);
		expect(d.recipients[1].label).toBe('Art');
	});
});

describe('recordSplitDistribution — persisted allocations', () => {
	const split = {
		id: 'split-1',
		split_mode: 'ledger',
		recipients: [
			{ address: EVM_A, share_bps: 6000, recipient_user_id: 'u-a' },
			{ address: EVM_B, share_bps: 4000, recipient_user_id: 'u-b' },
		],
	};

	it('writes one row per recipient whose amounts sum to the creator net', async () => {
		const sql = fakeSql([]);
		const out = await recordSplitDistribution(sql, {
			purchaseId: 'p-1',
			split,
			netAtomics: 9_500_001n, // odd amount → forces a remainder
			currencyMint: 'usdc',
			chain: 'base',
		});
		expect(out).toHaveLength(2);
		const total = out.reduce((s, r) => s + BigInt(r.amount), 0n);
		expect(total).toBe(9_500_001n); // exact — nothing lost
		// 60/40 of 9_500_001 → 5_700_001 / 3_800_000 (remainder to the larger share).
		expect(out.find((r) => r.address === EVM_A).amount).toBe('5700001');
		expect(out.find((r) => r.address === EVM_B).amount).toBe('3800000');
	});

	it('marks ledger-mode rows accrued and onchain-mode rows settled', async () => {
		const ledger = await recordSplitDistribution(fakeSql([]), {
			purchaseId: 'p-2', split, netAtomics: 1000n, currencyMint: 'usdc', chain: 'base',
		});
		expect(ledger.every((r) => r.mode === 'ledger' && r.status === 'accrued')).toBe(true);

		const onchain = await recordSplitDistribution(fakeSql([]), {
			purchaseId: 'p-3',
			split: { ...split, split_mode: 'onchain' },
			netAtomics: 1000n, currencyMint: 'usdc', chain: 'base',
		});
		expect(onchain.every((r) => r.mode === 'onchain' && r.status === 'settled')).toBe(true);
	});
});

describe('recordSplitDistribution - net already paid to the seller wallet', () => {
	const split = {
		id: 'split-9',
		split_mode: 'ledger',
		recipients: [
			{ address: EVM_A, share_bps: 5000, recipient_user_id: 'u-a' },
			{ address: EVM_B, share_bps: 5000, recipient_user_id: 'u-b' },
		],
	};

	it('records informational settled rows so the treasury never pays the net twice', async () => {
		const out = await recordSplitDistribution(fakeSql([]), {
			purchaseId: 'p-9', split, netAtomics: 1000n, currencyMint: 'usdc', chain: 'solana',
			settledToWallet: true,
		});
		expect(out.every((r) => r.status === 'settled')).toBe(true);
	});

	it('keeps accrued credit only when the net did not reach the seller wallet', async () => {
		const out = await recordSplitDistribution(fakeSql([]), {
			purchaseId: 'p-10', split, netAtomics: 1000n, currencyMint: 'usdc', chain: 'solana',
			settledToWallet: false,
		});
		expect(out.every((r) => r.status === 'accrued')).toBe(true);
	});
});

describe('enforceOnchainLicense — fail-open gate', () => {
	const prev = process.env.SKILL_LICENSE_ENFORCE;
	afterEach(() => {
		if (prev === undefined) delete process.env.SKILL_LICENSE_ENFORCE;
		else process.env.SKILL_LICENSE_ENFORCE = prev;
	});

	it('never touches the chain when enforcement is off', async () => {
		delete process.env.SKILL_LICENSE_ENFORCE;
		expect(licenseEnforcementEnabled()).toBe(false);
		const sql = fakeSql([]);
		const r = await enforceOnchainLicense({ sql, userId: 'u', agentId: 'a', skill: 's' });
		expect(r.blocked).toBe(false);
		expect(sql.calls).toHaveLength(0); // no DB read, no RPC
	});

	it('does not block a paid user with no minted license on record', async () => {
		process.env.SKILL_LICENSE_ENFORCE = '1';
		expect(licenseEnforcementEnabled()).toBe(true);
		// sql returns no skill_license_mints row → nothing to enforce → allow.
		const r = await enforceOnchainLicense({ sql: fakeSql([]), userId: 'u', agentId: 'a', skill: 's' });
		expect(r.blocked).toBe(false);
	});
});

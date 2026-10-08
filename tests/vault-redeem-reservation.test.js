// Vault redemptions and fee claims reserve BEFORE they pay.
//
// Both paths used to read the position (or the accrued fee) with a plain SELECT,
// pay USDC, and only then debit the books. N concurrent requests, each with its
// own idempotency key, all saw the same balance and each paid it in full out of
// the pooled vault USDC, i.e. out of the other backers' principal. These tests
// pin the order: an atomic reservation first, the payout only when it succeeds,
// and the reservation handed back when the payout does not happen.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const VAULT = { id: 'v1', network: 'mainnet', total_shares: '1000000', performance_fee_bps: 0, owner_user_id: 'owner', accrued_fee_atomics: '500000', vault_address: 'VaultAddr', encrypted_secret: 'enc' };
const order = [];
const store = {
	getVaultWithSecret: vi.fn(async () => ({ ...VAULT })),
	getBacker: vi.fn(async () => ({ shares: '1000000', cost_basis_atomics: '1000000', backer_agent_id: 'agent-b' })),
	getOpenPositions: vi.fn(async () => []),
	recordVaultEvent: vi.fn(async () => { order.push('event'); return 7; }),
	updateVaultEvent: vi.fn(async () => {}),
	applyBackerDelta: vi.fn(async () => ({})),
	applyVaultShareDelta: vi.fn(async () => ({})),
	applyAccruedFee: vi.fn(async () => '0'),
	reserveBackerShares: vi.fn(async () => { order.push('reserve'); return { shares: '0' }; }),
	releaseBackerShares: vi.fn(async () => { order.push('release'); }),
	reserveAccruedFee: vi.fn(async () => { order.push('reserveFee'); return '0'; }),
};
vi.mock('../api/_lib/vault-store.js', () => store);
vi.mock('../api/_lib/vault-wallet.js', () => ({
	recoverVaultKeypair: vi.fn(async () => {
		const { Keypair } = await import('@solana/web3.js');
		return Keypair.generate();
	}),
	computeVaultNav: vi.fn(async () => ({ navAtomics: 1_000_000n, freeAtomics: 1_000_000n, priced: true })),
	readVaultUsdcAtomics: vi.fn(async () => 1_000_000n),
}));
const submitProtected = vi.fn(async () => { order.push('pay'); return { signature: 'sig1' }; });
vi.mock('../api/_lib/execution-engine.js', () => ({ submitProtected: (...a) => submitProtected(...a) }));
vi.mock('../api/_lib/agent-pumpfun.js', () => ({ solanaConnection: vi.fn(() => ({})) }));
vi.mock('../api/_lib/agent-usdc-transfer.js', () => ({ transferUsdcGuarded: vi.fn() }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => [{ addr: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' }]),
}));

const { redeemFromVault, claimVaultFees } = await import('../api/_lib/vault-transfer.js');

beforeEach(() => {
	order.length = 0;
	vi.clearAllMocks();
	store.reserveBackerShares.mockImplementation(async () => { order.push('reserve'); return { shares: '0' }; });
	store.reserveAccruedFee.mockImplementation(async () => { order.push('reserveFee'); return '0'; });
	submitProtected.mockImplementation(async () => { order.push('pay'); return { signature: 'sig1' }; });
});

describe('redeemFromVault', () => {
	it('burns the shares before it pays and does not burn them again after', async () => {
		const r = await redeemFromVault({ vaultId: 'v1', userId: 'u1', shares: 'max', idempotencyKey: 'k1' });
		expect(r.status).toBe('ok');
		expect(order.indexOf('reserve')).toBeLessThan(order.indexOf('pay'));
		expect(store.applyBackerDelta).toHaveBeenCalledWith(expect.objectContaining({ sharesDelta: 0n }));
	});

	it('never pays when a concurrent redemption already took the shares', async () => {
		store.reserveBackerShares.mockImplementation(async () => null);
		const r = await redeemFromVault({ vaultId: 'v1', userId: 'u1', shares: 'max', idempotencyKey: 'k2' });
		expect(r).toMatchObject({ status: 'failed', code: 'in_flight' });
		expect(submitProtected).not.toHaveBeenCalled();
	});

	it('hands the shares back when the payout fails', async () => {
		submitProtected.mockImplementation(async () => { throw Object.assign(new Error('rpc'), { code: 'send_failed' }); });
		const r = await redeemFromVault({ vaultId: 'v1', userId: 'u1', shares: 'max', idempotencyKey: 'k3' });
		expect(r.status).toBe('failed');
		expect(store.releaseBackerShares).toHaveBeenCalledWith('v1', 'u1', 1_000_000n);
	});
});

describe('claimVaultFees', () => {
	const toAgent = { id: 'agent-o', meta: { solana_address: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' } };

	it('reserves the accrued fee before it pays', async () => {
		const r = await claimVaultFees({ vaultId: 'v1', ownerUserId: 'owner', toAgent, idempotencyKey: 'f1' });
		expect(r.status).toBe('ok');
		expect(order.indexOf('reserveFee')).toBeLessThan(order.indexOf('pay'));
		expect(store.applyAccruedFee).not.toHaveBeenCalled();
	});

	it('never pays when a concurrent claim already took the fee', async () => {
		store.reserveAccruedFee.mockImplementation(async () => null);
		const r = await claimVaultFees({ vaultId: 'v1', ownerUserId: 'owner', toAgent, idempotencyKey: 'f2' });
		expect(r).toMatchObject({ status: 'failed', code: 'in_flight' });
		expect(submitProtected).not.toHaveBeenCalled();
	});

	it('restores the accrual when the payout fails', async () => {
		submitProtected.mockImplementation(async () => { throw Object.assign(new Error('rpc'), { code: 'send_failed' }); });
		const r = await claimVaultFees({ vaultId: 'v1', ownerUserId: 'owner', toAgent, idempotencyKey: 'f3' });
		expect(r.status).toBe('failed');
		expect(store.applyAccruedFee).toHaveBeenCalledWith('v1', 500000n);
	});
});

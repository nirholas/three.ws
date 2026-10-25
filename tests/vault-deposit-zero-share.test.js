// A vault deposit must never move funds for zero shares. Donating USDC straight
// to the public vault address inflates NAV, so a later small deposit would floor
// to 0 shares and be kept by existing holders. The quote is checked BEFORE the
// transfer, honours the caller's min_shares_out, and a post-transfer shortfall
// refunds the backer.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const VAULT = { id: 'v1', network: 'mainnet', status: 'open', total_shares: '1', per_backer_cap_atomics: null, vault_address: 'VaultAddr', agent_id: 'a1', encrypted_secret: 'enc', peak_share_price_e6: '1000000' };
const navs = [];
const store = {
	getVaultWithSecret: vi.fn(async () => ({ ...VAULT })),
	getBacker: vi.fn(async () => null),
	getOpenPositions: vi.fn(async () => []),
	recordVaultEvent: vi.fn(async () => 7),
	updateVaultEvent: vi.fn(async () => {}),
	applyBackerDelta: vi.fn(async () => ({})),
	applyVaultShareDelta: vi.fn(async () => ({ total_shares: '2' })),
	applyAccruedFee: vi.fn(async () => '0'),
	reserveBackerShares: vi.fn(),
	releaseBackerShares: vi.fn(),
	reserveAccruedFee: vi.fn(),
};
vi.mock('../api/_lib/vault-store.js', () => store);
vi.mock('../api/_lib/vault-wallet.js', () => ({
	recoverVaultKeypair: vi.fn(async () => { const { Keypair } = await import('@solana/web3.js'); return Keypair.generate(); }),
	computeVaultNav: vi.fn(async () => ({ navAtomics: navs.shift(), priced: true })),
	readVaultUsdcAtomics: vi.fn(),
}));
const submitProtected = vi.fn(async () => ({ signature: 'refundSig' }));
vi.mock('../api/_lib/execution-engine.js', () => ({ submitProtected: (...a) => submitProtected(...a) }));
vi.mock('../api/_lib/agent-pumpfun.js', () => ({ solanaConnection: vi.fn(() => ({})) }));
const transfer = vi.fn(async () => ({ status: 'ok', signature: 'depSig' }));
vi.mock('../api/_lib/agent-usdc-transfer.js', () => ({ transferUsdcGuarded: (...a) => transfer(...a) }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));

const { depositToVault } = await import('../api/_lib/vault-transfer.js');
const { Keypair } = await import('@solana/web3.js');
const backerAgent = { id: 'b1', meta: { solana_address: Keypair.generate().publicKey.toBase58() } };

beforeEach(() => { vi.clearAllMocks(); navs.length = 0; });

describe('depositToVault zero-share guard', () => {
	it('refuses before moving funds when the quote is zero shares', async () => {
		navs.push(1_000_000_000n); // donation-inflated NAV, 1 share outstanding
		const r = await depositToVault({ vault: VAULT, backerAgent, userId: 'u', usdcAtomics: 500n, idempotencyKey: 'k' });
		expect(r.status).toBe('blocked');
		expect(r.code).toBe('zero_shares');
		expect(transfer).not.toHaveBeenCalled();
	});

	it('refuses before moving funds when the quote is below min_shares_out', async () => {
		navs.push(1_000_000n);
		const r = await depositToVault({ vault: { ...VAULT, total_shares: '1000000' }, backerAgent, userId: 'u', usdcAtomics: 1_000_000n, minSharesOut: 2_000_000n, idempotencyKey: 'k' });
		expect(r.code).toBe('min_shares_out');
		expect(transfer).not.toHaveBeenCalled();
	});

	it('refunds the backer when NAV moves between quote and mint', async () => {
		navs.push(1_000_000n, 1_000_000_000_000n); // quote ok, then donation lands
		const r = await depositToVault({ vault: { ...VAULT, total_shares: '1000000' }, backerAgent, userId: 'u', usdcAtomics: 500_000n, idempotencyKey: 'k' });
		expect(transfer).toHaveBeenCalled();
		expect(submitProtected).toHaveBeenCalled();
		expect(r.status).toBe('failed');
		expect(r.code).toBe('min_shares_out');
		expect(store.applyBackerDelta).not.toHaveBeenCalled();
	});
});

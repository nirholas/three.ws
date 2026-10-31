// Prompt 14 — grant skill access after payment.
//
// Proves the integration point: once finalizeSkillConfirmation() marks an
// on-chain payment 'confirmed', it MUST insert the corresponding row into
// skill_access_grants (the authoritative access record). Drives the EVM path of
// confirmSkillPurchase() because it reaches finalize without the Solana-Pay
// reference dance, and routes the mocked `sql` by query content so the test is
// not coupled to call ordering.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────

const SELLER_ADDR = '0x000000000000000000000000000000000000dEaD';
const SELLER_USER = 'seller-user-1';
const grantState = { kind: 'permanent', validUntil: null };
let calls = [];

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const q = strings.join(' ? ');
		calls.push({ q, values });
		// resolvePayoutAddress — must precede the agent_identities check below.
		if (/agent_payout_wallets/i.test(q)) return [{ address: SELLER_ADDR }];
		// getSellerUserId
		if (/select\s+user_id\s+from\s+agent_identities/i.test(q)) return [{ user_id: SELLER_USER }];
		// idempotency dupe pre-check (no other purchase claimed this tx)
		if (/select\s+id\s+from\s+skill_purchases/i.test(q)) return [];
		// payer-wallet binding check — wallet is linked to the buyer
		if (/from\s+user_wallets/i.test(q)) return [{ ok: 1 }];
		// finalize: the atomic confirm UPDATE returns the winning row
		if (/set\s+status\s*=\s*'confirmed'/i.test(q))
			return [{ id: PUR.id, kind: grantState.kind, valid_until: grantState.validUntil }];
		// claim: tx-hash claim UPDATE on the still-pending row
		if (/update\s+skill_purchases\s+set\s+tx_signature/i.test(q)) return [{ id: PUR.id }];
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const evmState = { result: { status: 'match', from: '0xPAYER' } };
vi.mock('../../api/_lib/evm-payment-verify.js', () => ({
	verifyEvmUsdcPayment: vi.fn(async () => evmState.result),
	evmChainId: vi.fn((chain) => (chain === 'base' ? 8453 : null)),
}));

const notify = vi.fn(async () => {});
vi.mock('../../api/_lib/notify.js', () => ({ insertNotification: notify }));

vi.mock('../../api/_lib/solana/rpc-fallback.js', () => ({
	rpcFallbackFromEnv: vi.fn(() => ({ withFallback: vi.fn() })),
}));

const { confirmSkillPurchase } = await import('../../api/_lib/purchase-confirm.js');

const PUR = {
	id: '11111111-1111-1111-1111-111111111111',
	user_id: '22222222-2222-2222-2222-222222222222',
	agent_id: '33333333-3333-3333-3333-333333333333',
	skill: 'translate',
	amount: '1000000',
	currency_mint: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
	chain: 'base',
	mint_decimals: 6,
	status: 'pending',
	expires_at: null,
	referrer_user_id: null,
};

function grantInsert() {
	return calls.find((c) => /insert\s+into\s+skill_access_grants/i.test(c.q));
}

beforeEach(() => {
	process.env.PURCHASE_RECEIPT_KEY = 'test-receipt-key-not-a-secret';
	calls = [];
	notify.mockClear();
	grantState.kind = 'permanent';
	grantState.validUntil = null;
	evmState.result = { status: 'match', from: '0xPAYER' };
});

describe('finalizeSkillConfirmation → skill_access_grants', () => {
	it('inserts a grant when an EVM payment confirms', async () => {
		const out = await confirmSkillPurchase({ ...PUR }, { txHash: '0xTX' });
		expect(out.status).toBe('confirmed');

		const ins = grantInsert();
		expect(ins, 'a skill_access_grants INSERT must be issued on confirm').toBeTruthy();
		// VALUES (user_id, agent_id, skill_name, purchase_id, expires_at)
		expect(ins.values).toEqual([PUR.user_id, PUR.agent_id, PUR.skill, PUR.id, null]);
	});

	it('grants permanent access (null expiry) for a one-time purchase', async () => {
		await confirmSkillPurchase({ ...PUR }, { txHash: '0xTX' });
		expect(grantInsert().values[4]).toBeNull();
	});

	it('grants time-limited access for a time_pass purchase', async () => {
		grantState.kind = 'time_pass';
		grantState.validUntil = '2026-07-01T00:00:00.000Z';
		await confirmSkillPurchase({ ...PUR }, { txHash: '0xTX' });
		expect(grantInsert().values[4]).toBe('2026-07-01T00:00:00.000Z');
	});

	it('does NOT insert a grant when the payment is still pending', async () => {
		evmState.result = { status: 'pending' };
		const out = await confirmSkillPurchase({ ...PUR }, { txHash: '0xTX' });
		expect(out.status).toBe('pending');
		expect(grantInsert()).toBeUndefined();
	});

	it('does NOT insert a grant before the buyer submits a tx hash', async () => {
		const out = await confirmSkillPurchase({ ...PUR }, {});
		expect(out.status).toBe('pending');
		expect(grantInsert()).toBeUndefined();
	});
});

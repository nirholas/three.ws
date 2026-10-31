// Gifting — finalizeSkillConfirmation routes access to the recipient.
//
// When a confirmed purchase carries recipient_user_id, the skill_access_grants
// row (the authoritative access record) must be created for the RECIPIENT, not
// the payer — and both parties get a gift notification (received / sent) instead
// of the ordinary purchase-confirmed one. Drives the EVM path so finalize is
// reached without the Solana-Pay reference dance. Queries are routed by content.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const SELLER_ADDR = '0x000000000000000000000000000000000000dEaD';
const SELLER_USER = 'seller-user-1';
let calls = [];

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const q = strings.join(' ? ');
		calls.push({ q, values });
		if (/agent_payout_wallets/i.test(q)) return [{ address: SELLER_ADDR }];
		if (/select\s+user_id\s+from\s+agent_identities/i.test(q)) return [{ user_id: SELLER_USER }];
		if (/select\s+username,\s+display_name\s+from\s+users/i.test(q)) return [{ username: 'alice', display_name: 'Alice' }];
		if (/select\s+id\s+from\s+skill_purchases/i.test(q)) return []; // idempotency dupe pre-check
		if (/from\s+user_wallets/i.test(q)) return [{ ok: 1 }]; // payer binding
		if (/set\s+status\s*=\s*'confirmed'/i.test(q)) return [{ id: PUR.id, kind: 'permanent', valid_until: null }];
		if (/update\s+skill_purchases\s+set\s+tx_signature/i.test(q)) return [{ id: PUR.id }];
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

vi.mock('../../api/_lib/evm-payment-verify.js', () => ({
	verifyEvmUsdcPayment: vi.fn(async () => ({ status: 'match', from: '0xPAYER' })),
	evmChainId: vi.fn((chain) => (chain === 'base' ? 8453 : null)),
}));

const notify = vi.fn(async () => {});
vi.mock('../../api/_lib/notify.js', () => ({ insertNotification: notify }));
vi.mock('../../api/_lib/solana/rpc-fallback.js', () => ({
	rpcFallbackFromEnv: vi.fn(() => ({ withFallback: vi.fn() })),
}));

const { confirmSkillPurchase } = await import('../../api/_lib/purchase-confirm.js');

const BUYER = '22222222-2222-2222-2222-222222222222';
const RECIPIENT = '44444444-4444-4444-4444-444444444444';
const PUR = {
	id: '11111111-1111-1111-1111-111111111111',
	user_id: BUYER,
	recipient_user_id: RECIPIENT,
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

const grantInsert = () => calls.find((c) => /insert\s+into\s+skill_access_grants/i.test(c.q));
const notifyTypes = () => notify.mock.calls.map((c) => `${c[0]}:${c[1]}`);

beforeEach(() => {
	process.env.PURCHASE_RECEIPT_KEY = 'test-receipt-key-not-a-secret';
	calls = [];
	notify.mockClear();
});

describe('finalizeSkillConfirmation — gift', () => {
	it('grants access to the recipient, not the payer', async () => {
		const out = await confirmSkillPurchase({ ...PUR }, { txHash: '0xTX' });
		expect(out.status).toBe('confirmed');
		const ins = grantInsert();
		expect(ins, 'a skill_access_grants INSERT must be issued').toBeTruthy();
		// VALUES (user_id, agent_id, skill_name, purchase_id, expires_at)
		expect(ins.values[0]).toBe(RECIPIENT);
		expect(ins.values).toEqual([RECIPIENT, PUR.agent_id, PUR.skill, PUR.id, null]);
	});

	it('notifies the recipient (received) and the buyer (sent), not purchase_confirmed', async () => {
		await confirmSkillPurchase({ ...PUR }, { txHash: '0xTX' });
		const received = notify.mock.calls.find((c) => c[1] === 'skill_gift_received');
		const sent = notify.mock.calls.find((c) => c[1] === 'skill_gift_sent');
		expect(received, 'recipient gets skill_gift_received').toBeTruthy();
		expect(received[0]).toBe(RECIPIENT);
		expect(received[2]).toMatchObject({ skill: PUR.skill, from: 'alice' });
		expect(sent, 'buyer gets skill_gift_sent').toBeTruthy();
		expect(sent[0]).toBe(BUYER);
		expect(sent[2]).toMatchObject({ skill: PUR.skill, to: 'alice' });
		// The ordinary self-purchase confirmation must NOT fire for a gift.
		expect(notifyTypes()).not.toContain(`${BUYER}:skill_purchase_confirmed`);
		// Seller still gets paid-notification.
		expect(notify.mock.calls.find((c) => c[1] === 'skill_purchased')[0]).toBe(SELLER_USER);
	});

	it('a non-gift purchase still grants to the payer and sends purchase_confirmed', async () => {
		const selfPur = { ...PUR, recipient_user_id: null };
		await confirmSkillPurchase(selfPur, { txHash: '0xTX' });
		expect(grantInsert().values[0]).toBe(BUYER);
		expect(notifyTypes()).toContain(`${BUYER}:skill_purchase_confirmed`);
		expect(notifyTypes().some((t) => t.includes('skill_gift'))).toBe(false);
	});
});

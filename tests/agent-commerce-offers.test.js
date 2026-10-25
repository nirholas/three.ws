// agent_buy_confirm pays a seller wallet the BUYING agent chose (the offer id is
// the agent's own input). It used to mark that destination `system`, which skips
// the owner's destination allowlist entirely, so an agent steered by a malicious
// offer could pay an unlisted wallet even with the allowlist switched on. The
// purchase must now reach agentTransfer without destination trust so the
// allowlist runs; the numeric caps already ran either way.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const OFFER_ID = '00000000-0000-4000-8000-0000000000a1';
const BUYER_ID = '00000000-0000-4000-8000-0000000000b1';
const SELLER_ID = '00000000-0000-4000-8000-0000000000c1';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));
vi.mock('../api/_lib/agent-wallet.js', () => ({
	getOrCreateAgentSolanaWallet: vi.fn(async () => ({ address: 'SyntheticWallet1111111111111111111111111111' })),
}));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({
	SpendLimitError: class SpendLimitError extends Error {},
}));
vi.mock('../api/_lib/agent-commerce/quotes.js', () => ({
	consumeQuote: vi.fn(async () => ({
		id: 'q1',
		payload: { offer_id: OFFER_ID, price_atomics: '1000000', asset: 'USDC', network: 'mainnet' },
	})),
	createQuote: vi.fn(),
	recordQuoteResult: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/agent-commerce/invoices.js', () => ({
	cancelInvoice: vi.fn(async () => {}),
	createInvoice: vi.fn(async () => ({ id: 'inv1', recipient: 'SyntheticSeller11111111111111111111111111111', reference: 'ref', number: 1 })),
	isUuid: () => true,
	loadInvoiceRow: vi.fn(),
	verifyInvoice: vi.fn(async () => ({ status: 'paid' })),
}));
vi.mock('../api/_lib/agent-commerce/solana-pay.js', () => ({
	invoiceChainMemo: () => 'memo',
	explorerTxUrl: () => 'https://example.invalid/tx',
}));
const agentTransfer = vi.fn();
vi.mock('../api/_lib/agent-commerce/transfer.js', () => ({ agentTransfer: (...a) => agentTransfer(...a) }));

beforeEach(() => {
	agentTransfer.mockReset().mockResolvedValue({ signature: 'sig' });
	sqlMock.mockReset().mockImplementation(async (strings) => {
		const q = strings.join(' ').replace(/\s+/g, ' ');
		if (/FROM agent_identities WHERE id/.test(q)) return [{ id: BUYER_ID, user_id: 'u-buyer', name: 'Buyer', meta: {} }];
		if (/FROM agent_commerce_offers o/.test(q)) {
			return [{ id: OFFER_ID, agent_id: SELLER_ID, user_id: 'u-seller', status: 'active', stock: null, sold_count: 0, price_atomics: '1000000', asset: 'USDC', network: 'mainnet', title: 'Thing' }];
		}
		if (/INSERT INTO agent_commerce_orders/.test(q)) return [{ id: 'order1' }];
		return [];
	});
});

describe('confirmBuy destination trust', () => {
	it('does not mark the seller wallet as system-trusted, so the allowlist can run', async () => {
		const { confirmBuy } = await import('../api/_lib/agent-commerce/offers.js');
		await confirmBuy({ buyerAgentId: BUYER_ID, previewId: 'q1' }).catch(() => {});
		expect(agentTransfer).toHaveBeenCalledTimes(1);
		const args = agentTransfer.mock.calls[0][0];
		expect(args.category).toBe('purchase');
		expect(args.destinationTrust ?? null).toBeNull();
	});
});

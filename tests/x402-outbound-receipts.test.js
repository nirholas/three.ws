// api/_lib/x402/outbound-receipts.js lists what a Payment Session spent at
// OTHER, external x402 merchants, lazily resolving each Solana settlement
// against chain truth on first view and caching the result. These tests
// cover: resolving an unresolved row and persisting it, skipping a row that
// is already resolved, tolerating a resolve failure without blocking the
// page, leaving Base-network rows unresolved, and the KPI aggregate.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlState = { calls: [], queue: [] };

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: strings.join('?'), values });
		return sqlState.queue.length ? sqlState.queue.shift() : [];
	}),
}));

const resolveSettlementMock = vi.fn();

vi.mock('../api/_lib/x402/solana-settlement.js', async () => {
	const actual = await vi.importActual('../api/_lib/x402/solana-settlement.js');
	return {
		...actual,
		resolveSettlement: (...args) => resolveSettlementMock(...args),
	};
});

const { listOutboundReceipts, summarizeOutboundReceipts } = await import(
	'../api/_lib/x402/outbound-receipts.js'
);

const USER = 'user-1';
const MERCHANT = 'MERCHANTsynthetic11111111111111111111111111';
const CUSTOMER = 'CUSTOMERsynthetic1111111111111111111111111';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function executionRow(overrides = {}) {
	return {
		id: 'exec-1',
		session_id: 'session-1',
		user_id: USER,
		endpoint_url: 'https://example-merchant.test/api/paid',
		endpoint_host: 'example-merchant.test',
		method: 'GET',
		amount_usdc: '1000000',
		network: 'solana',
		tx_hash: 'SIGnature1111111111111111111111111111111111111111111111111111111111111',
		payer_address: CUSTOMER,
		payee_address: MERCHANT,
		status: 'settled',
		resolved_payer: null,
		resolved_payee: null,
		resolved_mint: null,
		resolved_amount_atomics: null,
		resolved_decimals: null,
		resolved_fee_lamports: null,
		resolved_slot: null,
		resolved_block_time: null,
		resolved_at: null,
		resolve_error: null,
		created_at: new Date('2026-10-15T00:00:00.000Z'),
		...overrides,
	};
}

beforeEach(() => {
	sqlState.calls.length = 0;
	sqlState.queue.length = 0;
	resolveSettlementMock.mockReset();
});

describe('listOutboundReceipts', () => {
	it('resolves an unresolved Solana row from chain and persists the result', async () => {
		sqlState.queue.push([executionRow()]);
		resolveSettlementMock.mockResolvedValueOnce({
			payer: CUSTOMER,
			payee: MERCHANT,
			mint: USDC_MINT,
			symbol: 'USDC',
			amountAtomics: '1000000',
			decimals: 6,
			feeLamports: 5000,
			slot: 12345,
			blockTime: 1_700_000_000,
		});
		sqlState.queue.push([
			executionRow({
				resolved_payer: CUSTOMER,
				resolved_payee: MERCHANT,
				resolved_mint: USDC_MINT,
				resolved_amount_atomics: '1000000',
				resolved_decimals: 6,
				resolved_fee_lamports: 5000,
				resolved_slot: 12345,
				resolved_block_time: 1_700_000_000,
				resolved_at: new Date('2026-10-15T00:05:00.000Z'),
			}),
		]);

		const { receipts, nextCursor } = await listOutboundReceipts(USER);
		expect(resolveSettlementMock).toHaveBeenCalledWith(executionRow().tx_hash);
		expect(receipts).toHaveLength(1);
		expect(receipts[0].resolved).toEqual({
			payer: CUSTOMER,
			payee: MERCHANT,
			mint: USDC_MINT,
			amountAtomics: '1000000',
			decimals: 6,
			feeLamports: 5000,
			slot: 12345,
			blockTime: 1_700_000_000,
		});
		expect(receipts[0].resolvePending).toBe(false);
		expect(nextCursor).toBeNull();

		const updateCall = sqlState.calls.find((c) => c.query.includes('UPDATE payment_session_executions') && c.query.includes('resolved_payer'));
		expect(updateCall).toBeTruthy();
	});

	it('does not re-resolve a row that was already resolved', async () => {
		sqlState.queue.push([
			executionRow({
				resolved_payer: CUSTOMER,
				resolved_payee: MERCHANT,
				resolved_mint: USDC_MINT,
				resolved_amount_atomics: '1000000',
				resolved_decimals: 6,
				resolved_fee_lamports: 5000,
				resolved_slot: 12345,
				resolved_block_time: 1_700_000_000,
				resolved_at: new Date('2026-10-15T00:05:00.000Z'),
			}),
		]);

		const { receipts } = await listOutboundReceipts(USER);
		expect(resolveSettlementMock).not.toHaveBeenCalled();
		expect(receipts[0].resolved.mint).toBe(USDC_MINT);
	});

	it('records a terminal resolve error and still returns the row, unresolved', async () => {
		sqlState.queue.push([executionRow()]);
		resolveSettlementMock.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'tx_not_found', name: 'SettlementResolveError' }));
		sqlState.queue.push([executionRow({ resolved_at: new Date('2026-10-15T00:05:00.000Z'), resolve_error: 'tx_not_found' })]);

		const { receipts } = await listOutboundReceipts(USER);
		expect(receipts[0].resolved).toBeNull();
		expect(receipts[0].resolveError).toBe('tx_not_found');
		expect(receipts[0].resolvePending).toBe(false);
	});

	it('leaves a Base-network row unresolved without calling the Solana resolver', async () => {
		sqlState.queue.push([
			executionRow({ network: 'base', tx_hash: '0xabc123', payer_address: '0xpayer', payee_address: '0xpayee' }),
		]);

		const { receipts } = await listOutboundReceipts(USER);
		expect(resolveSettlementMock).not.toHaveBeenCalled();
		expect(receipts[0].resolved).toBeNull();
		expect(receipts[0].resolvePending).toBe(false);
		expect(receipts[0].reportedPayer).toBe('0xpayer');
	});

	it('returns an empty page without erroring when there is nothing to show', async () => {
		sqlState.queue.push([]);
		const { receipts, nextCursor } = await listOutboundReceipts(USER);
		expect(receipts).toEqual([]);
		expect(nextCursor).toBeNull();
		expect(resolveSettlementMock).not.toHaveBeenCalled();
	});
});

describe('summarizeOutboundReceipts', () => {
	it('maps the aggregate row into dollar figures and counts', async () => {
		sqlState.queue.push([
			{ total: '3', total_amount_atomics: '15000000', verified: '2', unverified: '1', unique_merchants: '2' },
		]);
		const summary = await summarizeOutboundReceipts(USER);
		expect(summary).toEqual({
			total: 3,
			totalSpendUsd: 15,
			verified: 2,
			unverified: 1,
			uniqueMerchants: 2,
		});
	});
});

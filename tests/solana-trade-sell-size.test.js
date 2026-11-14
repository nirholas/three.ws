// Token-denominated sells on the shared trade executor.
//
// Every trade caller (the wallet hub, the v1 REST route, @three-ws/trading-mcp,
// autopilot) can size a sell as token_amount: "all" or a token amount instead
// of exact base units. runAgentTrade resolves it against the wallet's live
// on-chain balance, so "all" sells exactly what is held (no float rounding past
// the balance) and a sell larger than the position, or of a token the wallet
// does not hold, is refused before any quote.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

const MINT = 'THREEsynthetic11111111111111111111111111111';
const OTHER = 'THREEsynthetic22222222222222222222222222222';
const WALLET = Keypair.generate().publicKey.toBase58();
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const sqlMock = vi.fn(async () => []);
const balances = vi.hoisted(() => ({ accounts: [] }));

vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/agent-pumpfun.js', async () => {
	const conn = {
		getBalance: async () => 5_000_000_000,
		getParsedTokenAccountsByOwner: async (_owner, { programId }) => ({
			value: String(programId) === TOKEN_PROGRAM
				? balances.accounts.map(([mint, amount, decimals]) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } }))
				: [],
		}),
	};
	return { ...(await vi.importActual('../api/_lib/agent-pumpfun.js')), solanaConnection: () => conn, solanaPublicConnection: () => conn };
});
vi.mock('../api/_lib/pump-platform-fee.js', () => ({
	buildAgentTradeFee: async () => null,
	isPlatformOwnedUser: async () => true,
	effectivePumpFeeBps: async () => 0,
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: () => {} }));

const { runAgentTrade, parseTradeRequest } = await import('../api/agents/solana-trade.js');

// The venue stands in for the market only; sizing and refusals are the real code.
const quoteMock = vi.fn(async ({ tokenAmountRaw }) => ({
	venue: 'amm', graduated: true,
	inAsset: MINT, inAmount: Number(tokenAmountRaw) / 1e6, inAtomics: tokenAmountRaw,
	outAsset: 'SOL', outUi: 0.01, outAtomics: '10000000', decimals: 6,
	minOutUi: 0.0099, minOutAtomics: '9900000', priceImpactPct: 0.5,
}));
const executor = { quote: (...a) => quoteMock(...a), build: async () => ({ instructions: [] }) };

function previewSell(body) {
	const parsed = parseTradeRequest({ side: 'sell', mint: MINT, preview: true, ...body });
	expect(parsed.ok).toBe(true);
	return runAgentTrade({ agentId: 'a1', userId: 'u1', meta: {}, address: WALLET, parsed, ownerInitiated: true, executor });
}

beforeEach(() => {
	quoteMock.mockClear();
	balances.accounts = [];
});

describe('parseTradeRequest token-denominated sells', () => {
	it('accepts token_amount "all" or a positive amount in place of base units', () => {
		expect(parseTradeRequest({ side: 'sell', mint: MINT, token_amount: 'all' })).toMatchObject({ ok: true, tokenAmount: 'all', tokenAmountRaw: null });
		expect(parseTradeRequest({ side: 'sell', mint: MINT, token_amount: '12.5' })).toMatchObject({ ok: true, tokenAmount: 12.5 });
		expect(parseTradeRequest({ side: 'sell', mint: MINT, amount_tokens: 3 })).toMatchObject({ ok: true, tokenAmount: 3 });
	});

	it('rejects a vague amount, a zero amount, and a double size', () => {
		expect(parseTradeRequest({ side: 'sell', mint: MINT, token_amount: 'most' }).ok).toBe(false);
		expect(parseTradeRequest({ side: 'sell', mint: MINT, token_amount: 0 }).ok).toBe(false);
		expect(parseTradeRequest({ side: 'sell', mint: MINT, token_amount: 'all', token_amount_raw: '5' }).ok).toBe(false);
	});
});

describe('runAgentTrade sell sizing', () => {
	it('quotes the exact whole balance, summed across token accounts, for "all"', async () => {
		balances.accounts = [[MINT, '900000000000000001', 6], [MINT, '99', 6], [OTHER, '5', 6]];
		const out = await previewSell({ token_amount: 'all' });
		expect(out.error).toBeUndefined();
		expect(quoteMock.mock.calls[0][0].tokenAmountRaw).toBe('900000000000000100');
	});

	it('converts a token amount with the mint decimals, truncating dust', async () => {
		balances.accounts = [[MINT, '987654321', 6]];
		await previewSell({ token_amount: '12.3456789' });
		expect(quoteMock.mock.calls[0][0].tokenAmountRaw).toBe('12345678');
	});

	it('refuses a sell of a token the wallet does not hold, before quoting', async () => {
		balances.accounts = [[OTHER, '5', 6]];
		const out = await previewSell({ token_amount: 'all' });
		expect(out).toMatchObject({ status: 409, error: { code: 'no_position' } });
		expect(quoteMock).not.toHaveBeenCalled();
	});

	it('refuses a sell larger than the position, before quoting', async () => {
		balances.accounts = [[MINT, '1000000', 6]];
		const out = await previewSell({ token_amount: 2 });
		expect(out).toMatchObject({ status: 409, error: { code: 'insufficient_tokens' } });
		expect(out.error.message).toContain('holds 1 of');
		expect(quoteMock).not.toHaveBeenCalled();
	});

	it('leaves an exact base-unit sell untouched and never reads the balance for it', async () => {
		const out = await previewSell({ token_amount_raw: '5000' });
		expect(out.error).toBeUndefined();
		expect(quoteMock.mock.calls[0][0].tokenAmountRaw).toBe('5000');
	});
});

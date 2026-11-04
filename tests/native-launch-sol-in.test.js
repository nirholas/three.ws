// SOL-in buy composition. Jupiter responses are recorded real GETs/POSTs against
// lite-api.jup.ag (tests/fixtures/native-launch); only the network edge is faked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/native-launch/${n}`, import.meta.url), 'utf8'));
const jupQuote = fixture('jupiter-quote-sol-three.json');
const jupIx = fixture('jupiter-swap-instructions-sol-three.json');

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const WALLET = 'FjRJ24ecvmPX488PcN3RpNPM9gq3xCxRjnju4LSr9M6f';
const MINT = '3wsr2fWnuQ4hFRPHsxWin9YWiUT4qGMhGpE1CrboX47J';
const DBC = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');

const built = { captured: null };
const buildSwapInstructions = vi.fn();
vi.mock('../api/_lib/native-launch/dbc.js', () => ({ buildSwapInstructions: (...a) => buildSwapInstructions(...a) }));
vi.mock('../api/_lib/native-launch/config.js', () => ({
	quoteMintFor: (n) => (n === 'devnet' ? null : 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'),
	NATIVE_LANE: { quoteDecimals: 6 },
}));
vi.mock('../api/_lib/pump.js', () => ({
	getConnection: () => ({ getAddressLookupTable: async () => ({ value: null }) }),
	buildUnsignedTxBase64: vi.fn(async (a) => {
		built.captured = a;
		return 'AQID';
	}),
}));

import { buildSolBuyTx } from '../api/_lib/native-launch/sol-in.js';

function respond(status, body) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
	built.captured = null;
	buildSwapInstructions.mockReset().mockImplementation(async ({ amountIn }) => ({
		traderPk: new PublicKey(WALLET),
		instructions: [
			new TransactionInstruction({ programId: DBC, keys: [], data: Buffer.from([1, 2, 3]) }),
		],
		summary: { pool: 'PoolAddress11111111111111111111111111111111', side: 'buy', amount_in: amountIn, expected_out: 123, min_out: 120, slippage_bps: 100, referral: false },
	}));
	globalThis.fetch = vi.fn(async (url) => {
		if (String(url).includes('/quote')) return respond(200, jupQuote);
		if (String(url).includes('/swap-instructions')) return respond(200, jupIx);
		throw new Error(`unexpected fetch ${url}`);
	});
});

describe('buildSolBuyTx', () => {
	it('puts the Jupiter swap before the curve swap in one transaction', async () => {
		const r = await buildSolBuyTx({ mint: MINT, trader: WALLET, solAmount: 0.1, slippageBps: 100 });
		const ixs = built.captured.instructions;
		const jupSwapProgram = jupIx.swapInstruction.programId;
		const jupAt = ixs.findIndex((i) => i.programId.toBase58() === jupSwapProgram);
		const dbcAt = ixs.findIndex((i) => i.programId.toBase58() === DBC.toBase58());
		expect(jupAt).toBeGreaterThanOrEqual(0);
		expect(dbcAt).toBeGreaterThan(jupAt);
		expect(dbcAt).toBe(ixs.length - 1);
		expect(r.pay_with).toBe('sol');
		expect(r.txBase64).toBe('AQID');
	});

	it('sizes the curve buy from the Jupiter worst case, so it can never overspend $THREE', async () => {
		const r = await buildSolBuyTx({ mint: MINT, trader: WALLET, solAmount: 0.1, slippageBps: 100 });
		const floor = Number(jupQuote.otherAmountThreshold) / 1e6;
		expect(buildSwapInstructions.mock.calls[0][0].amountIn).toBe(floor);
		expect(r.three_min).toBe(floor);
		expect(r.three_expected).toBe(Number(jupQuote.outAmount) / 1e6);
		expect(r.three_min).toBeLessThanOrEqual(r.three_expected);
		expect(r.min_out).toBe(120);
	});

	it('quotes Jupiter for exactly the lamports asked', async () => {
		await buildSolBuyTx({ mint: MINT, trader: WALLET, solAmount: 0.1, slippageBps: 100 });
		const quoteUrl = String(globalThis.fetch.mock.calls[0][0]);
		expect(quoteUrl).toContain('amount=100000000');
		expect(quoteUrl).toContain(`outputMint=${THREE}`);
	});

	it('refuses devnet with a typed error and calls nothing', async () => {
		await expect(buildSolBuyTx({ network: 'devnet', mint: MINT, trader: WALLET, solAmount: 1 })).rejects.toMatchObject({
			status: 400,
			code: 'sol_swap_unavailable_on_devnet',
		});
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('maps a Jupiter no-route answer to a typed 422', async () => {
		globalThis.fetch = vi.fn(async () => respond(400, { error: 'Could not find any route' }));
		await expect(buildSolBuyTx({ mint: MINT, trader: WALLET, solAmount: 0.1 })).rejects.toMatchObject({ status: 422, code: 'sol_route_unavailable' });
	});

	it('maps a Jupiter outage to a typed 502', async () => {
		globalThis.fetch = vi.fn(async () => respond(503, {}));
		await expect(buildSolBuyTx({ mint: MINT, trader: WALLET, solAmount: 0.1 })).rejects.toMatchObject({ status: 502, code: 'sol_quote_failed' });
	});
});

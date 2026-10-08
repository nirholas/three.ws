import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import { Keypair } from '@solana/web3.js';

// The autonomous loop bounds every run() pipeline's remainingCap by the payer's
// USDC float. With the payer down to 341 atomics on 2026-10-08, every $0.01 call
// came back `cap_would_exceed` with a warning to raise cap env vars, and the ring
// dashboard filed it as a benign amber skip: an empty wallet read as a budget
// guard. A float shortfall must be named `insufficient_payer_usdc`.

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
process.env.X402_ASSET_MINT_SOLANA = USDC;

const { payX402, isFloatShortfall, skipReasonFor } = await import('../api/_lib/x402/pay.js');

const payTo = Keypair.generate().publicKey.toBase58();
const feePayer = Keypair.generate().publicKey.toBase58();
const PRICE = 10_000;

let server;
let origin;
let paidAttempts = 0;

beforeAll(async () => {
	server = http.createServer((req, res) => {
		if (req.headers['x-payment']) paidAttempts++;
		res.statusCode = 402;
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify({
			x402Version: 2,
			accepts: [{
				scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', asset: USDC, payTo,
				amount: String(PRICE), extra: { name: 'USDC', decimals: 6, feePayer },
			}],
		}));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server?.close());

const ctx = () => ({
	buyer: Keypair.generate(),
	conn: {},
	blockhash: '11111111111111111111111111111111',
	mintInfo: { decimals: 6 },
});

describe('payX402 float shortfall', () => {
	it('reports an empty payer as insufficient_payer_usdc and never warns about caps', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const out = await payX402({ url: `${origin}/intel-a`, method: 'GET', ...ctx(), remainingCap: 341, payerUsdcAtomic: 341 });
		expect(out.skipped).toBe(true);
		expect(out.errorMsg).toBe('insufficient_payer_usdc');
		expect(out.amountAtomic).toBe(PRICE);
		expect(warn.mock.calls.some((c) => String(c[0]).includes('price_exceeds_cap'))).toBe(false);
		expect(paidAttempts).toBe(0);
		warn.mockRestore();
	});

	it('still reports a real budget limit as cap_would_exceed when the float covers the call', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const out = await payX402({ url: `${origin}/intel-b`, method: 'GET', ...ctx(), remainingCap: 5_000, payerUsdcAtomic: 2_000_000 });
		expect(out.errorMsg).toBe('cap_would_exceed');
		expect(paidAttempts).toBe(0);
		warn.mockRestore();
	});

	it('keeps the old behavior for callers that do not pass the float', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const out = await payX402({ url: `${origin}/intel-c`, method: 'GET', ...ctx(), remainingCap: 341 });
		expect(out.errorMsg).toBe('cap_would_exceed');
		warn.mockRestore();
	});
});

describe('isFloatShortfall', () => {
	it('treats an unknown float as no shortfall', () => {
		expect(isFloatShortfall(PRICE, null)).toBe(false);
		expect(isFloatShortfall(PRICE, undefined)).toBe(false);
		expect(isFloatShortfall(PRICE, 'not-a-number')).toBe(false);
	});

	it('flags only an amount above the float', () => {
		expect(isFloatShortfall(PRICE, 341)).toBe(true);
		expect(isFloatShortfall(PRICE, PRICE)).toBe(false);
		expect(isFloatShortfall(PRICE, 0)).toBe(true);
	});
});

describe('skipReasonFor (the loop relabel for pipelines that do not pass the float)', () => {
	it('relabels a cap skip the float explains', () => {
		expect(skipReasonFor({ errorMsg: 'cap_would_exceed', amountAtomic: PRICE }, 341)).toBe('insufficient_payer_usdc');
	});

	it('leaves a cap skip the float does not explain', () => {
		expect(skipReasonFor({ errorMsg: 'cap_would_exceed', amountAtomic: PRICE }, 5_000_000)).toBe('cap_would_exceed');
		expect(skipReasonFor({ errorMsg: 'cap_would_exceed', amountAtomic: PRICE }, null)).toBe('cap_would_exceed');
	});

	it('passes every other reason through unchanged', () => {
		expect(skipReasonFor({ errorMsg: 'missing_fee_payer', amountAtomic: PRICE }, 0)).toBe('missing_fee_payer');
		expect(skipReasonFor({}, 0)).toBe(null);
		expect(skipReasonFor(null, 0)).toBe(null);
	});
});

describe('the autonomous loop records the relabelled reason', () => {
	it('routes run() outcomes through skipReasonFor', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(new URL('../api/cron/x402-autonomous-loop.js', import.meta.url), 'utf8');
		expect(src).toMatch(/errorMsg = skipReasonFor\(outcome, payerUsdcAtomic\)/);
	});
});

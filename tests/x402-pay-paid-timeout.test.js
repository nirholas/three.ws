import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import { Keypair } from '@solana/web3.js';

// A paid route that does its work BEFORE it settles (the paid Forge generates the
// mesh, then settles) keeps running after the buyer gives up: aborting the paid
// replay does not cancel the server, it still settles, and the buyer books a
// charged call as `This operation was aborted`. On 2026-09-24/25 that was 7 of
// the 9 ring-paid forge generations. payX402 therefore takes a budget for the
// paid replay alone, and the forge pipeline passes one that clears the lane.
//
// Driven against a local 402 server: the Solana transfer is genuinely built and
// signed, but nothing is broadcast and nothing is spent.

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
process.env.X402_ASSET_MINT_SOLANA = USDC;

const { payX402, FETCH_TIMEOUT_MS } = await import('../api/_lib/x402/pay.js');

const payTo = Keypair.generate().publicKey.toBase58();
const feePayer = Keypair.generate().publicKey.toBase58();

// How long the PAID replay takes to answer. The probe always answers at once.
let paidDelayMs = 0;
let paidAttempts = 0;
let server;
let origin;

beforeAll(async () => {
	server = http.createServer((req, res) => {
		if (!req.headers['x-payment']) {
			res.statusCode = 402;
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({
				x402Version: 2,
				accepts: [{
					scheme: 'exact',
					network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
					asset: USDC,
					payTo,
					amount: '1000',
					extra: { name: 'USDC', decimals: 6, feePayer },
				}],
			}));
			return;
		}
		paidAttempts++;
		setTimeout(() => {
			if (res.destroyed) return;
			res.statusCode = 200;
			res.setHeader('content-type', 'application/json');
			res.setHeader(
				'x-payment-response',
				Buffer.from(JSON.stringify({ success: true, transaction: 'SIG_SLOW' })).toString('base64'),
			);
			res.end(JSON.stringify({ status: 'done' }));
		}, paidDelayMs);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => {
	server.closeAllConnections?.();
	server.close(resolve);
}));

beforeEach(() => {
	paidDelayMs = 0;
	paidAttempts = 0;
});

const payCtx = {
	buyer: Keypair.generate(),
	conn: { getAccountInfo: async () => ({ lamports: 1 }) },
	blockhash: '11111111111111111111111111111111',
	mintInfo: { decimals: 6 },
	selfPay: true,
	remainingCap: 100_000,
};

describe('payX402 paid-replay budget', () => {
	it('aborts a paid replay that outlasts paidTimeoutMs', async () => {
		paidDelayMs = 3_000;
		await expect(
			payX402({ url: `${origin}/slow`, method: 'POST', body: {}, ...payCtx, paidTimeoutMs: 1_000 }),
		).rejects.toThrow(/abort/i);
		expect(paidAttempts).toBe(1);
	});

	it('waits out a slow paid replay when the budget covers it', async () => {
		paidDelayMs = 400;
		const r = await payX402({ url: `${origin}/slow`, method: 'POST', body: {}, ...payCtx, paidTimeoutMs: 5_000 });
		expect(r.paid).toBe(true);
		expect(r.txSig).toBe('SIG_SLOW');
		expect(paidAttempts).toBe(1);
	});

	it('keeps the shared default for every caller that does not opt in', async () => {
		const r = await payX402({ url: `${origin}/fast`, method: 'POST', body: {}, ...payCtx });
		expect(r.paid).toBe(true);
		expect(FETCH_TIMEOUT_MS).toBe(20_000);
	});
});

describe('forge prop pipeline', () => {
	it('pays the forge with a budget that clears the lane, not the 20s default', async () => {
		vi.resetModules();
		const calls = [];
		vi.doMock('../api/_lib/db.js', () => ({ sql: async () => [] }));
		vi.doMock('../api/_lib/x402/pay.js', async (importOriginal) => ({
			...(await importOriginal()),
			payX402: async (args) => {
				calls.push(args);
				return { success: false, paid: false, amountAtomic: 0, txSig: null, status: 503, errorMsg: 'http_503' };
			},
		}));
		const { run, FORGE_PAID_TIMEOUT_MS } = await import('../api/_lib/x402/pipelines/forge-content.js');
		await run({
			origin,
			buyer: payCtx.buyer,
			conn: payCtx.conn,
			blockhash: payCtx.blockhash,
			mintInfo: payCtx.mintInfo,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].paidTimeoutMs).toBe(FORGE_PAID_TIMEOUT_MS);
		// Observed server-side completion runs to about 55s; anything under a
		// minute re-creates the charged-but-aborted class.
		expect(FORGE_PAID_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
		vi.doUnmock('../api/_lib/db.js');
		vi.doUnmock('../api/_lib/x402/pay.js');
	});
});

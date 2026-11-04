// Per-call fresh payer for the ring tick (api/_lib/x402/fresh-workers/per-call.js)
// and the afterPay/selfPay hooks in settleAndRecord: every ring call must be able
// to run from a wallet that is torn down right after its payment resolves.

import { describe, it, expect, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

import { freshPayerEnabled, loadFreshFunders } from '../api/_lib/x402/fresh-workers/per-call.js';
import { settleAndRecord } from '../api/_lib/x402/pipelines/volume-shared.js';

describe('freshPayerEnabled', () => {
	it('is off unless explicitly true', () => {
		expect(freshPayerEnabled({})).toBe(false);
		expect(freshPayerEnabled({ X402_RING_FRESH_PAYER: 'yes' })).toBe(false);
		expect(freshPayerEnabled({ X402_RING_FRESH_PAYER: ' TRUE ' })).toBe(true);
	});
});

describe('loadFreshFunders', () => {
	it('names the missing input instead of throwing', () => {
		expect(loadFreshFunders({})).toEqual({ reason: 'treasury_secret_unset' });
		expect(loadFreshFunders({ X402_TREASURY_SECRET_BASE58: 'x' })).toEqual({ reason: 'wallet_encryption_key_unset' });
	});
});

describe('settleAndRecord per-call payer hooks', () => {
	const ep = { key: 'k', name: 'Probe', path: '/api/x', method: 'POST', body: {} };
	const sql = Object.assign(async () => [{ call_count: 1, success_count: 1, total_spent_atomic: 0 }], {});
	const result = { success: true, paid: true, amountAtomic: 1000, txSig: 'sig', status: 200, responseBody: {} };

	it('signs with the per-call buyer, passes selfPay, then hands the result to afterPay', async () => {
		const shared = Keypair.generate();
		const fresh = Keypair.generate();
		const payFn = vi.fn(async () => result);
		const afterPay = vi.fn(async () => {});
		await settleAndRecord({
			sql, runId: 'r', ep, origin: 'https://x', remaining: 5000, pipeline: 'ring-tick', namePrefix: 'Ring', payFn,
			ctx: { buyer: shared, buyerFor: async () => fresh, afterPay, selfPay: true },
		});
		expect(payFn.mock.calls[0][0].buyer).toBe(fresh);
		expect(payFn.mock.calls[0][0].selfPay).toBe(true);
		expect(afterPay).toHaveBeenCalledWith(fresh, result);
	});

	it('does not fail the call when afterPay throws', async () => {
		const out = await settleAndRecord({
			sql, runId: 'r', ep, origin: 'https://x', remaining: 5000, pipeline: 'ring-tick', namePrefix: 'Ring',
			payFn: async () => result,
			ctx: { buyer: Keypair.generate(), afterPay: async () => { throw new Error('sweep rpc down'); } },
		});
		expect(out.result.success).toBe(true);
	});
});

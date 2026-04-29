/**
 * Pure-logic smoke tests for the payments adapter facade.
 */

import { describe, it, expect } from 'vitest';
import {
	getPaymentsAdapter,
	_resetPaymentsAdapters,
} from '../../src/onchain/payments/index.js';

describe('PaymentsAdapter factory', () => {
	it('returns and caches the pumpfun adapter', () => {
		_resetPaymentsAdapters();
		const a = getPaymentsAdapter('pumpfun');
		const b = getPaymentsAdapter();
		expect(a).toBe(b);
		expect(a.provider).toBe('pumpfun');
	});

	it('rejects unknown providers', () => {
		expect(() => getPaymentsAdapter('stripe')).toThrow();
	});
});

describe('PumpfunPaymentsAdapter precondition shape', () => {
	it('enableForAgent rejects when no token launched', async () => {
		const adapter = getPaymentsAdapter('pumpfun');
		await expect(adapter.enableForAgent({ agent: { id: 'x' } })).rejects.toMatchObject({
			code: 'PRECONDITION_FAILED',
		});
	});

	it('payAgent rejects when payments not configured', async () => {
		const adapter = getPaymentsAdapter('pumpfun');
		await expect(
			adapter.payAgent({
				agent: { id: 'x' },
				currencyMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
				amount: '1000000',
			}),
		).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
	});
});

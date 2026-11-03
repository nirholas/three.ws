import { describe, it, expect } from 'vitest';
import { currencyOfAccept } from '../api/_lib/a2a/settlement-asset.js';
import { assertMandateAllows } from '../api/_lib/a2a/mandate.js';

const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('settlement asset', () => {
	it('recognises real USDC by address', () => {
		expect(currencyOfAccept({ asset: USDC_SOL })).toBe('USDC');
		expect(currencyOfAccept({ asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' })).toBe('USDC');
	});
	it('does not trust a peer label claiming to be USDC', () => {
		const accept = { asset: 'FakeMint1111111111111111111111111111111111', extra: { name: 'USDC' } };
		expect(currencyOfAccept(accept)).not.toBe('USDC');
	});
	it('a USDC mandate rejects a lookalike asset', () => {
		const accept = { asset: 'FakeMint1111111111111111111111111111111111', extra: { name: 'USD Coin' } };
		expect(() =>
			assertMandateAllows({
				mandate: { perCallAtomics: '1000000', currency: 'USDC', resources: [], expiresAt: 0 },
				amountAtomics: '10',
				currency: currencyOfAccept(accept),
			}),
		).toThrow(/mandate authorizes USDC/);
	});
	it('returns undefined when no asset is named', () => {
		expect(currencyOfAccept({ extra: { name: 'USDC' } })).toBeUndefined();
	});
});

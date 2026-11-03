import { describe, it, expect } from 'vitest';
import { reactionFor } from '../src/widgets/pumpfun-reactions.js';

describe('reactionFor trade side detection', () => {
	it('reads a buy from txType', () => {
		expect(reactionFor('trade', { amount_usd: 60_000, txType: 'buy' })?.variant).toBe('trade_whale_buy');
	});

	it('falls back to the type field when txType is absent', () => {
		expect(reactionFor('trade', { amount_usd: 60_000, type: 'buy' })?.variant).toBe('trade_whale_buy');
	});

	it('does not treat a sell as a buy', () => {
		expect(reactionFor('trade', { amount_usd: 60_000, txType: 'sell' })?.variant).not.toBe('trade_whale_buy');
	});
});

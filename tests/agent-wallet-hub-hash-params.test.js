// The wallet hub reads deep-link params after the tab id in the hash
// (#trade?mint=...&side=sell, #trade?sell=all) so Portfolio, the sniper
// dashboard and shared links can open Trade with a coin loaded or the Sell all
// review already open. Anything malformed is dropped, never passed to a tab.

import { describe, it, expect } from 'vitest';
import { parseHashParams } from '../src/agent-wallet-hub/index.js';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

describe('parseHashParams', () => {
	it('returns undefined for an empty or param-less hash', () => {
		expect(parseHashParams('')).toBeUndefined();
		expect(parseHashParams(undefined)).toBeUndefined();
		expect(parseHashParams('foo=bar')).toBeUndefined();
	});

	it('reads a coin and side', () => {
		expect(parseHashParams(`mint=${MINT}&side=sell`)).toEqual({ mint: MINT, side: 'sell' });
		expect(parseHashParams(`mint=${MINT}&side=buy`)).toEqual({ mint: MINT, side: 'buy' });
	});

	it('opens Sell all on sell=all', () => {
		expect(parseHashParams('sell=all')).toEqual({ sellAll: true });
	});

	it('drops a mint that is not base58 and an unknown side', () => {
		expect(parseHashParams('mint=<script>&side=yolo')).toBeUndefined();
		expect(parseHashParams('mint=0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl&side=sell')).toEqual({ side: 'sell' });
	});
});

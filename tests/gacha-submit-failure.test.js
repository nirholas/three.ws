// @vitest-environment jsdom
//
// Meetup #3 client audit (failure states): after the player signed a gacha
// pull, a dropped connection or a 5xx on submit erased the saved pending pack.
// The submit may already have broadcast the signed payment, so erasing it left
// a possibly-paid pack with no way back to it. Only a clear refusal (4xx) means
// the payment never went out; anything ambiguous keeps the pack resumable.

import { describe, it, expect } from 'vitest';
import { submitMayHaveSent, networkFeeLabel } from '../src/game/gacha-ui.js';
import { GachaApiError } from '../src/game/gacha-client.js';

describe('submitMayHaveSent', () => {
	it('keeps the pack when the connection dropped or timed out', () => {
		expect(submitMayHaveSent(new GachaApiError(0, 'network', 'Could not reach the gacha server.'))).toBe(true);
		expect(submitMayHaveSent(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
	});

	it('keeps the pack on a server error, the broadcast may have happened', () => {
		expect(submitMayHaveSent(new GachaApiError(502, 'upstream', 'The gacha server answered 502.'))).toBe(true);
	});

	it('drops the pack only on a clear refusal', () => {
		expect(submitMayHaveSent(new GachaApiError(400, 'bad_tx', 'The signed transaction did not match.'))).toBe(false);
		expect(submitMayHaveSent(new GachaApiError(429, 'rate', 'Too many requests.'))).toBe(false);
	});
});

describe('networkFeeLabel', () => {
	it('names Collector Crypt only when it really pays the fee', () => {
		expect(networkFeeLabel({ networkFeePaidBy: 'collector_crypt', networkFeeLamports: 0 })).toBe('Paid by Collector Crypt');
	});

	it('shows the exact SOL a wallet paying its own fee is charged', () => {
		expect(networkFeeLabel({ networkFeePaidBy: 'player', networkFeeLamports: 10_800 })).toBe('0.0000108 SOL from your wallet');
	});
});

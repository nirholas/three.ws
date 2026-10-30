// A $THREE (non-USDC) payment requirement was summarized and confirmed through
// amountToUsd, which prices anything off the pinned USDC assets as Infinity, so
// the inspect view and the pay confirm prompt both read "Infinity THREE".
// Display must use the token's own decimals; spend caps keep amountToUsd.

import test from 'node:test';
import assert from 'node:assert/strict';

import { summarize } from '../src/inspect.js';
import { tokenAmountOf, SOLANA_MAINNET, THREE_MINT } from '../src/solana.js';

const solThree = { scheme: 'exact', network: SOLANA_MAINNET, asset: THREE_MINT, amount: '10000000', payTo: 'wwww', extra: { name: 'THREE', decimals: 6 } };

test('summarize shows a $THREE price in whole tokens, never Infinity', () => {
	const text = summarize({ status: 402, accepts: [solThree], chosen: solThree }).join('\n');
	assert.doesNotMatch(text, /Infinity/);
	assert.match(text, /10\.000000 \$THREE/);
});

test('tokenAmountOf reads declared decimals, defaults to 6, and refuses bad atomics', () => {
	assert.equal(tokenAmountOf(solThree), 10);
	assert.equal(tokenAmountOf({ ...solThree, extra: { name: 'THREE', decimals: 9 } }), 0.01);
	assert.equal(tokenAmountOf({ ...solThree, extra: { name: 'THREE' } }), 10);
	assert.equal(tokenAmountOf({ ...solThree, amount: 'abc' }), Infinity);
});

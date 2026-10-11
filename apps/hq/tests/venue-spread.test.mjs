import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSpreads } from '../api/venue-spread.js';

/** Build the venue map shape the handler passes to buildSpreads. */
function venueMap(entries) {
  return new Map(entries.map(([venue, prices]) => [venue, new Map(Object.entries(prices))]));
}

describe('venue-spread buildSpreads', () => {
  it('computes the spread in basis points against the mid price', () => {
    const result = buildSpreads(venueMap([
      ['Coinbase', { BTC: 100 }],
      ['Kraken', { BTC: 101 }],
    ]));

    const btc = result.spreads.find(s => s.symbol === 'BTC');
    assert.ok(btc, 'BTC row present');
    assert.equal(btc.low.venue, 'Coinbase');
    assert.equal(btc.high.venue, 'Kraken');
    assert.equal(btc.spreadAbs, 1);
    // mid = 100.5, so 1 / 100.5 * 10000 = 99.5 bps
    assert.equal(btc.spreadBps, 99.5);
  });

  it('skips assets quoted by only one venue', () => {
    const result = buildSpreads(venueMap([
      ['Coinbase', { BTC: 100, ETH: 50 }],
      ['Kraken', { BTC: 101 }],
    ]));

    assert.deepEqual(result.spreads.map(s => s.symbol), ['BTC']);
    assert.equal(result.count, 1);
  });

  it('classifies spreads against the published thresholds', () => {
    const result = buildSpreads(venueMap([
      // 0.5 bps apart -> TIGHT
      ['Coinbase', { BTC: 100_000, ETH: 1000, SOL: 100 }],
      // ETH 1.5% apart -> WIDE, SOL 0.15% apart -> NOTABLE
      ['Kraken', { BTC: 100_005, ETH: 1015, SOL: 100.15 }],
    ]));

    const byId = Object.fromEntries(result.spreads.map(s => [s.symbol, s]));
    assert.equal(byId.BTC.level, 'TIGHT');
    assert.equal(byId.ETH.level, 'WIDE');
    assert.equal(byId.SOL.level, 'NOTABLE');
    assert.equal(result.summary.wideCount, 1);
    assert.equal(result.summary.notableCount, 1);
  });

  it('sorts widest first and reports the widest in the summary', () => {
    const result = buildSpreads(venueMap([
      ['Coinbase', { BTC: 100, ETH: 100 }],
      ['Kraken', { BTC: 100.1, ETH: 105 }],
    ]));

    assert.equal(result.spreads[0].symbol, 'ETH');
    assert.equal(result.summary.widest.symbol, 'ETH');
    assert.ok(result.summary.widest.spreadBps > result.spreads[1].spreadBps);
  });

  it('ignores non-finite quotes without dropping the asset', () => {
    const result = buildSpreads(venueMap([
      ['Coinbase', { BTC: 100 }],
      ['Kraken', { BTC: Number.NaN }],
      ['OKX', { BTC: 102 }],
    ]));

    const btc = result.spreads.find(s => s.symbol === 'BTC');
    assert.equal(btc.venueCount, 2);
    assert.deepEqual(btc.venues.map(v => v.venue), ['Coinbase', 'OKX']);
  });

  it('returns an empty, well-formed table when nothing is comparable', () => {
    const result = buildSpreads(venueMap([['Coinbase', { BTC: 100 }]]));

    assert.deepEqual(result.spreads, []);
    assert.equal(result.count, 0);
    assert.equal(result.summary.widest, null);
    assert.equal(result.summary.avgSpreadBps, 0);
  });
});

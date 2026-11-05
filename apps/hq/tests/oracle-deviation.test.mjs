import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deviationBps, isStale, classifyFeed, median, pythToNumber, chainlinkToNumber, parsePythPriceUpdate } from '../api/_oracle-math.js';

describe('oracle math', () => {
  it('computes signed basis-point deviation against a reference', () => {
    assert.equal(deviationBps(101, 100), 100);
    assert.equal(deviationBps(99, 100), -100);
    assert.equal(deviationBps(100, 100), 0);
  });
  it('returns null when the reference is unusable', () => {
    assert.equal(deviationBps(1, 0), null);
    assert.equal(deviationBps(null, 5), null);
    assert.equal(deviationBps(5, NaN), null);
  });
  it('flags a round older than its heartbeat plus grace as stale', () => {
    assert.equal(isStale({ updatedAtSec: 1000, heartbeatSec: 3600, nowSec: 1000 + 3600 }), false);
    assert.equal(isStale({ updatedAtSec: 1000, heartbeatSec: 3600, nowSec: 1000 + 3600 * 1.2 }), true);
    assert.equal(isStale({ updatedAtSec: null, heartbeatSec: 3600, nowSec: 5 }), null);
  });
  it('classifies a feed by staleness first, then deviation against the threshold', () => {
    assert.equal(classifyFeed({ bps: 10, stale: false, thresholdBps: 50 }), 'ok');
    assert.equal(classifyFeed({ bps: -80, stale: false, thresholdBps: 50 }), 'deviation');
    assert.equal(classifyFeed({ bps: 1, stale: true, thresholdBps: 50 }), 'stale');
    assert.equal(classifyFeed({ bps: null, stale: false, thresholdBps: 50 }), 'unknown');
  });
  it('takes the median of finite values and ignores the rest', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([NaN, null, 5]), 5);
    assert.equal(median([]), null);
  });
  it('applies the Pyth exponent and the Chainlink decimals', () => {
    assert.equal(pythToNumber({ price: '15000000000', expo: -8 }), 150);
    assert.equal(chainlinkToNumber('300000000000', 8), 3000);
  });
  it('parses a Pyth PriceUpdateV2 account into price, feed id and publish time', () => {
    const b = Buffer.alloc(8 + 32 + 1 + 32 + 8 + 8 + 4 + 8);
    let o = 40;
    b[o] = 1; o += 1; // verification level: Full
    Buffer.alloc(32, 0xab).copy(b, o); o += 32;
    b.writeBigInt64LE(15000000000n, o); o += 8;
    b.writeBigUInt64LE(5000n, o); o += 8;
    b.writeInt32LE(-8, o); o += 4;
    b.writeBigInt64LE(1700000000n, o);
    const p = parsePythPriceUpdate(b);
    assert.equal(p.price, 150);
    assert.equal(p.publishTimeSec, 1700000000);
    assert.equal(p.feedId, 'ab'.repeat(32));
  });
  it('parses the two-byte Partial verification level too and rejects short data', () => {
    const b = Buffer.alloc(8 + 32 + 2 + 32 + 8 + 8 + 4 + 8);
    b[40] = 0; b[41] = 5;
    b.writeBigInt64LE(200n, 42 + 32); b.writeInt32LE(0, 42 + 48);
    assert.equal(parsePythPriceUpdate(b).price, 200);
    assert.equal(parsePythPriceUpdate(Buffer.alloc(10)), null);
  });
});

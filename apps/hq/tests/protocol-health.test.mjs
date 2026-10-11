import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scoreProtocol, gradeFor } from '../api/protocol-health.js';
import { deriveAccountSplit, baseFromInstId } from '../api/_okx-derivatives.js';

const NOW = Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000);
const YEAR = 365.25 * 24 * 3600;

/** A mid-sized, unremarkable protocol used as the comparison baseline. */
function baseline(overrides = {}) {
  return {
    name: 'Test Protocol',
    tvl: 1e9,
    change_1d: 0,
    change_7d: 0,
    chains: ['Ethereum', 'Arbitrum', 'Base'],
    listedAt: NOW - 2 * YEAR,
    mcap: 1e9,
    ...overrides,
  };
}

describe('protocol-health scoring', () => {
  it('keeps every score inside 0-100', () => {
    const candidates = [
      baseline(),
      baseline({ tvl: 1e11, change_7d: 1000, change_1d: 0, chains: Array(40).fill('X'), listedAt: NOW - 10 * YEAR }),
      baseline({ tvl: 1e8, change_7d: -99, change_1d: -80, chains: [], listedAt: NOW, mcap: 1e15 }),
    ];
    for (const c of candidates) {
      const score = scoreProtocol(c, NOW);
      assert.ok(score >= 0 && score <= 100, `score ${score} out of range`);
      assert.equal(Number.isInteger(score), true);
    }
  });

  it('rewards growth and punishes decline', () => {
    const growing = scoreProtocol(baseline({ change_7d: 25 }), NOW);
    const flat = scoreProtocol(baseline({ change_7d: 0 }), NOW);
    const shrinking = scoreProtocol(baseline({ change_7d: -25 }), NOW);
    assert.ok(growing > flat, 'growth should outscore flat');
    assert.ok(flat > shrinking, 'flat should outscore decline');
  });

  it('punishes daily volatility even when the weekly trend is flat', () => {
    const calm = scoreProtocol(baseline({ change_1d: 0 }), NOW);
    const choppy = scoreProtocol(baseline({ change_1d: -9 }), NOW);
    assert.ok(calm > choppy, 'a stable protocol should outscore a choppy one');
  });

  it('rewards multi-chain deployment', () => {
    const single = scoreProtocol(baseline({ chains: ['Ethereum'] }), NOW);
    const many = scoreProtocol(baseline({ chains: ['Ethereum', 'Arbitrum', 'Base', 'Optimism', 'Polygon', 'BSC'] }), NOW);
    assert.ok(many > single);
  });

  it('rewards a larger TVL', () => {
    const small = scoreProtocol(baseline({ tvl: 2e8 }), NOW);
    const large = scoreProtocol(baseline({ tvl: 2e10 }), NOW);
    assert.ok(large > small);
  });

  it('penalises a token valued far above its locked value', () => {
    const sane = scoreProtocol(baseline({ mcap: 1e9 }), NOW);
    const frothy = scoreProtocol(baseline({ mcap: 1e12 }), NOW);
    assert.ok(sane > frothy);
  });

  it('handles missing optional fields without producing NaN', () => {
    const score = scoreProtocol({ tvl: 5e8 }, NOW);
    assert.equal(Number.isNaN(score), false);
    assert.ok(score >= 0 && score <= 100);
  });

  it('maps scores onto grades at the documented boundaries', () => {
    assert.equal(gradeFor(100), 'A');
    assert.equal(gradeFor(80), 'A');
    assert.equal(gradeFor(79), 'B');
    assert.equal(gradeFor(65), 'B');
    assert.equal(gradeFor(64), 'C');
    assert.equal(gradeFor(50), 'C');
    assert.equal(gradeFor(49), 'D');
    assert.equal(gradeFor(35), 'D');
    assert.equal(gradeFor(34), 'E');
    assert.equal(gradeFor(0), 'E');
  });
});

describe('okx derivatives helpers', () => {
  it('derives the account split so the two sides sum to 1', () => {
    for (const ratio of [0.5, 1, 2, 5.29]) {
      const split = deriveAccountSplit(ratio);
      assert.ok(split);
      assert.ok(Math.abs(split.longAccount + split.shortAccount - 1) < 1e-9);
      assert.ok(Math.abs(split.longAccount / split.shortAccount - ratio) < 1e-9);
    }
  });

  it('treats a balanced book as an even split', () => {
    const split = deriveAccountSplit(1);
    assert.equal(split.longAccount, 0.5);
    assert.equal(split.shortAccount, 0.5);
  });

  it('rejects ratios that cannot describe a book', () => {
    assert.equal(deriveAccountSplit(0), null);
    assert.equal(deriveAccountSplit(-1), null);
    assert.equal(deriveAccountSplit(Number.NaN), null);
    assert.equal(deriveAccountSplit(undefined), null);
  });

  it('extracts the base asset from an OKX instrument id', () => {
    assert.equal(baseFromInstId('BTC-USDT-SWAP'), 'BTC');
    assert.equal(baseFromInstId('DOGE-USDT-SWAP'), 'DOGE');
    assert.equal(baseFromInstId(''), '');
    assert.equal(baseFromInstId(undefined), '');
  });
});

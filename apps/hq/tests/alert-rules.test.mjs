import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateRule, validateRule, migrateLegacyAlerts, neededFeeds, describeRule, proposalForRule, MAX_CLAUSES,
} from '../src/services/alert-rules.ts';

const id = () => 'gen-id';
const now = () => '2026-11-04T00:00:00.000Z';
const rule = (join, clauses, extra = {}) => validateRule({ join, clauses, ...extra }, id, now);
const px = (symbol, op, value) => ({ metric: 'price', symbol, op, value });

describe('evaluateRule', () => {
  it('ALL needs every clause and decides false as soon as one is false', () => {
    const r = rule('all', [px('BTC', 'above', 100), px('ETH', 'below', 10)]);
    assert.equal(evaluateRule(r, { 'price:BTC': 120, 'price:ETH': 5 }), true);
    assert.equal(evaluateRule(r, { 'price:BTC': 90 }), false);
    assert.equal(evaluateRule(r, { 'price:BTC': 120 }), null);
  });

  it('ANY fires on one true clause even when another reading is missing', () => {
    const r = rule('any', [px('BTC', 'above', 100), px('ETH', 'below', 10)]);
    assert.equal(evaluateRule(r, { 'price:BTC': 120 }), true);
    assert.equal(evaluateRule(r, { 'price:BTC': 90, 'price:ETH': 50 }), false);
    assert.equal(evaluateRule(r, { 'price:BTC': 90 }), null);
  });

  it('mixes price, funding and gas metrics', () => {
    const r = rule('all', [px('BTC', 'above', 100), { metric: 'funding', symbol: 'btc', op: 'above', value: 0.05 }, { metric: 'gas', op: 'below', value: 20 }]);
    assert.equal(evaluateRule(r, { 'price:BTC': 101, 'funding:BTC': 0.06, 'gas:ETH': 12 }), true);
    assert.equal(evaluateRule(r, { 'price:BTC': 101, 'funding:BTC': 0.06, 'gas:ETH': 30 }), false);
  });

  it('treats NaN readings as unknown', () => {
    assert.equal(evaluateRule(rule('all', [px('BTC', 'above', 1)]), { 'price:BTC': Number.NaN }), null);
  });
});

describe('validateRule', () => {
  it('rejects empty, oversized and malformed clause lists', () => {
    assert.equal(rule('all', []), null);
    assert.equal(rule('all', Array.from({ length: MAX_CLAUSES + 1 }, () => px('BTC', 'above', 1))), null);
    assert.equal(rule('all', [px('BTC', 'sideways', 1)]), null);
    assert.equal(rule('all', [px('BTC', 'above', -1)]), null);
    assert.equal(rule('all', [px('', 'above', 1)]), null);
    assert.equal(rule('all', [px('<b>', 'above', 1)]), null);
  });
  it('allows a negative funding threshold and defaults handoff off', () => {
    const r = rule('all', [{ metric: 'funding', symbol: 'ETH', op: 'below', value: -0.02 }]);
    assert.equal(r.clauses[0].value, -0.02);
    assert.equal(r.handoff, false);
  });
  it('describes a rule in plain language', () => {
    assert.equal(describeRule(rule('any', [px('BTC', 'above', 100000), { metric: 'gas', op: 'below', value: 5 }])), 'BTC price >= $100000 OR ETH gas <= 5 gwei');
  });
});

describe('migrateLegacyAlerts', () => {
  it('converts the old shape to one-clause rules and keeps ids and state', () => {
    const out = migrateLegacyAlerts([
      { id: 'a1', symbol: 'btc', targetPrice: 90000, condition: 'above', enabled: true, triggered: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', symbol: 'ETH', targetPrice: 2000, condition: 'below', enabled: false, triggered: false },
    ], id, now);
    assert.equal(out.length, 2);
    assert.equal(out[0].id, 'a1');
    assert.equal(out[0].triggered, true);
    assert.deepEqual(out[0].clauses, [{ metric: 'price', symbol: 'BTC', op: 'above', value: 90000 }]);
    assert.equal(out[1].enabled, false);
    assert.equal(out[1].createdAt, now());
  });
  it('drops malformed entries and tolerates non-arrays', () => {
    assert.deepEqual(migrateLegacyAlerts([{ symbol: 'BTC' }, null, 5, { symbol: 'X', targetPrice: 0, condition: 'above' }], id, now), []);
    assert.deepEqual(migrateLegacyAlerts({ not: 'array' }, id, now), []);
  });
});

describe('neededFeeds', () => {
  it('only asks for feeds that live, armed rules use', () => {
    const live = rule('all', [px('BTC', 'above', 1), { metric: 'gas', op: 'below', value: 5 }]);
    const done = rule('all', [{ metric: 'funding', symbol: 'ETH', op: 'above', value: 1 }], { triggered: true });
    assert.deepEqual(neededFeeds([live, done]), { prices: ['BTC'], funding: false, gas: true });
  });
});

describe('proposalForRule', () => {
  it('only ever produces a reversible briefing proposal', () => {
    const p = proposalForRule(rule('all', [px('BTC', 'above', 100000)], { name: 'Breakout' }));
    assert.equal(p.kind, 'briefing');
    assert.equal(p.params.cadence, 'once');
    assert.match(p.params.summary, /Breakout/);
    assert.ok(p.params.summary.length <= 300);
  });
});

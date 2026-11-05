import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { impermanentLoss, lpProfitability, utilization, seriesChangePct, downsample, chainTvlRows } from '../api/_dashboard-math.js';
import { resolveDashboard } from '../api/_protocol-dashboards.js';
import handler from '../api/protocol-dashboard.js';

describe('dashboard math', () => {
  it('impermanent loss is zero at ratio 1 and about -5.7% at 2x', () => {
    assert.equal(impermanentLoss(1), 0);
    assert.ok(Math.abs(impermanentLoss(2) - -0.0572) < 0.001);
  });
  it('lpProfitability says fees win when fee yield beats IL', () => {
    const r = lpProfitability({ feeApyPct: 36.5, days: 30, ratio: 1.1 });
    assert.equal(r.verdict, 'fees-win');
    assert.ok(r.netPct > 0);
  });
  it('lpProfitability says IL wins on a violent move with low fees', () => {
    assert.equal(lpProfitability({ feeApyPct: 2, days: 7, ratio: 3 }).verdict, 'il-wins');
  });
  it('utilization is borrow over supply and null without supply', () => {
    assert.equal(utilization(200, 50), 0.25);
    assert.equal(utilization(0, 5), null);
  });
  it('seriesChangePct compares against the point N days back', () => {
    const day = 86400;
    const s = [[0, 100], [day, 110], [2 * day, 120]];
    assert.equal(seriesChangePct(s, 2), 20);
  });
  it('downsample keeps the ends and respects the cap', () => {
    const s = Array.from({ length: 500 }, (_, i) => [i, i]);
    const d = downsample(s, 50);
    assert.ok(d.length <= 50);
    assert.deepEqual(d[0], [0, 0]);
    assert.deepEqual(d.at(-1), [499, 499]);
  });
  it('chainTvlRows drops borrowed, staking and pool2 keys and computes shares', () => {
    const rows = chainTvlRows({ Solana: 300, Ethereum: 100, 'Solana-borrowed': 50, staking: 9, pool2: 1 });
    assert.deepEqual(rows.map((r) => r.chain), ['Solana', 'Ethereum']);
    assert.equal(rows[0].share, 0.75);
  });
});

describe('dashboard config', () => {
  it('falls back to the generic blocks for an unknown slug', () => {
    assert.deepEqual(resolveDashboard('some-unlisted-protocol').blocks, ['tvl-history', 'tvl-chains', 'fees', 'yields', 'price']);
  });
  it('gives Aave the lending block and reports health honestly as a block that exists', () => {
    const d = resolveDashboard('aave-v3');
    assert.ok(d.blocks.includes('lending-rates'));
  });
});

const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GET /api/protocol-dashboard', () => {
  beforeEach(() => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/protocol/missing-one')) return json({ message: 'nope' }, 400);
      if (u.includes('api.llama.fi/protocol/')) {
        return json({ name: 'Test Proto', category: 'Dexs', chains: ['Solana'], currentChainTvls: { Solana: 10 }, tvl: [{ date: 1, totalLiquidityUSD: 5 }, { date: 90000, totalLiquidityUSD: 10 }] });
      }
      if (u.includes('summary/fees')) return json({}, 500);
      if (u.includes('yields.llama.fi')) return json({ data: [] });
      return json({}, 404);
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; });
  const call = (qs, ip = '1.1.1.1') => handler(new Request(`http://x/api/protocol-dashboard${qs}`, { headers: { 'x-forwarded-for': ip } }));

  it('rejects a missing or malformed slug with 400', async () => {
    assert.equal((await call('')).status, 400);
    assert.equal((await call('?slug=../etc')).status, 400);
  });
  it('rejects a bad window with 400', async () => {
    assert.equal((await call('?slug=test-proto&window=5')).status, 400);
  });
  it('returns 404 when DeFiLlama does not know the protocol', async () => {
    assert.equal((await call('?slug=missing-one')).status, 404);
  });
  it('settles blocks independently: failing fees and empty yields degrade only their own block', async () => {
    const res = await call('?slug=test-proto&window=30', '2.2.2.2');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.blocks['tvl-history'].status, 'ok');
    assert.equal(body.blocks.fees.status, 'unavailable');
    assert.equal(body.blocks.yields.status, 'unavailable');
    assert.match(body.blocks.fees.reason, /./);
    assert.ok(body.methodology.length > 20);
  });
  it('reports Aave account health as unavailable with a reason, never a number', async () => {
    const res = await call('?slug=aave-v3&window=30', '3.3.3.3');
    const body = await res.json();
    assert.equal(body.blocks['aave-health'].status, 'unavailable');
    assert.match(body.blocks['aave-health'].reason, /position/i);
  });
});

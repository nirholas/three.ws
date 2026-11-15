import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreContract, scoreOracle, scoreGovernance, scoreLiquidity, scoreMarket, overallRisk, levelFor } from '../api/_risk-scoring.js';

const NOW = 1_800_000_000;
const YEAR = 365 * 86400;

describe('risk scoring', () => {
  it('maps a 0-100 risk number to a level', () => {
    assert.equal(levelFor(10), 'low');
    assert.equal(levelFor(45), 'medium');
    assert.equal(levelFor(80), 'high');
    assert.equal(levelFor(null), 'unknown');
  });
  it('rates an audited, mature, never-hacked contract low risk', () => {
    const r = scoreContract({ audits: 2, listedAt: NOW - 3 * YEAR, hackLossUsd: 0, nowSec: NOW });
    assert.equal(r.level, 'low');
  });
  it('rates an unaudited new contract that was hacked high risk', () => {
    const r = scoreContract({ audits: 0, listedAt: NOW - 30 * 86400, hackLossUsd: 5e7, nowSec: NOW });
    assert.equal(r.level, 'high');
    assert.match(r.reason, /hack/i);
  });
  it('is unknown, not low, when nothing is known about the contract', () => {
    assert.equal(scoreContract({ audits: null, listedAt: null, hackLossUsd: null, nowSec: NOW }).level, 'unknown');
  });
  it('scores oracle risk from the worst deviation and staleness, unknown without feeds', () => {
    assert.equal(scoreOracle({ maxDeviationBps: 5, anyStale: false }).level, 'low');
    assert.equal(scoreOracle({ maxDeviationBps: 250, anyStale: false }).level, 'high');
    assert.equal(scoreOracle({ maxDeviationBps: 5, anyStale: true }).level, 'high');
    assert.equal(scoreOracle({ maxDeviationBps: null, anyStale: null }).level, 'unknown');
  });
  it('scores governance as unknown without a governance id and lower risk with active governance', () => {
    assert.equal(scoreGovernance({ governanceIds: [], activeProposals: null }).level, 'unknown');
    assert.equal(scoreGovernance({ governanceIds: ['snapshot:x'], activeProposals: 0 }).level, 'low');
  });
  it('scores liquidity from TVL scale and drawdown', () => {
    assert.equal(scoreLiquidity({ tvl: 5e9, change7d: 1 }).level, 'low');
    assert.equal(scoreLiquidity({ tvl: 2e6, change7d: -40 }).level, 'high');
    assert.equal(scoreLiquidity({ tvl: null, change7d: null }).level, 'unknown');
  });
  it('scores market risk from price swings', () => {
    assert.equal(scoreMarket({ change1d: 0.5, change7d: 2 }).level, 'low');
    assert.equal(scoreMarket({ change1d: -25, change7d: -35 }).level, 'high');
    assert.equal(scoreMarket({ change1d: null, change7d: null }).level, 'unknown');
  });
  it('averages only known dimensions and reports how many were known', () => {
    const o = overallRisk([{ risk: 20 }, { risk: 60 }, { risk: null }]);
    assert.equal(o.risk, 40);
    assert.equal(o.known, 2);
    assert.equal(overallRisk([{ risk: null }]).risk, null);
  });
});

describe('buildHeatmap protocol selection', () => {
  it('leaves custodial and non-contract categories out of the DeFi heatmap', async () => {
    const { buildHeatmap } = await import('../api/risk-heatmap.js');
    const synthetic = [
      { id: '1', slug: 'synthetic-exchange', name: 'Synthetic Exchange', category: 'CEX', tvl: 9e10, chains: ['Solana'], chainTvls: { Solana: 9e10 } },
      { id: '2', slug: 'synthetic-chain', name: 'Synthetic Chain', category: 'Chain', tvl: 8e10, chains: ['Solana'], chainTvls: { Solana: 8e10 } },
      { id: '3', slug: 'synthetic-lend', name: 'Synthetic Lend', category: 'Lending', tvl: 3e9, chains: ['Solana'], chainTvls: { Solana: 3e9 }, audits: '2', listedAt: NOW - 2 * YEAR },
      { id: '4', slug: 'synthetic-dex', name: 'Synthetic Dex', category: 'Dexs', tvl: 1e9, chains: ['Solana'], chainTvls: { Solana: 1e9 } },
    ];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u === 'https://api.llama.fi/protocols') return new Response(JSON.stringify(synthetic), { status: 200 });
      if (u === 'https://api.llama.fi/hacks') return new Response('[]', { status: 200 });
      return new Response('unavailable', { status: 503 });
    };
    try {
      const report = await buildHeatmap('Solana', 24);
      assert.deepEqual(report.rows.map((r) => r.slug), ['synthetic-lend', 'synthetic-dex']);
      assert.match(report.methodology, /exchanges/i);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

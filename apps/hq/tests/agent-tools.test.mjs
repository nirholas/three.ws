import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import handler, { TOOLS, listTools, routeQuestion, runTool } from '../api/agent-tools.js';
import { assessPortfolio } from '../api/_portfolio-risk.js';

/** Transport stub keyed by path; payloads follow the shapes the HQ routes emit. */
function transport(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    const body = routes[u.pathname];
    if (body === undefined) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}
const ORIGIN = 'https://hq.example';

const yields = { pools: [
  { project: 'aave-v3', symbol: 'USDC', chain: 'Ethereum', apy: 4.1, tvlUsd: 9e8, stablecoin: true, apyBase: 4.1, apyReward: null },
  { project: 'lido', symbol: 'STETH', chain: 'Ethereum', apy: 3.0, tvlUsd: 2e10, stablecoin: false },
  { project: 'kamino', symbol: 'SOL-USDC', chain: 'Solana', apy: 22.5, tvlUsd: 5e7, stablecoin: false },
] };
const health = { protocols: [
  { name: 'Aave V3', slug: 'aave-v3', category: 'Lending', score: 91, grade: 'A', tvl: 2e10, change1d: 0.4, change7d: 1.2 },
  { name: 'Shady', slug: 'shady', category: 'Lending', score: 22, grade: 'F', tvl: 3e6, change1d: -9, change7d: -30 },
] };
const funding = { rates: [
  { symbol: 'BTC', avgFunding: 0.012, level: 'MODERATE', exchanges: { Binance: {}, Hyperliquid: {} } },
  { symbol: 'DOGE', avgFunding: 0.12, level: 'EXTREME', exchanges: { Binance: {} } },
], summary: { sentiment: 'NEUTRAL' } };

describe('agent-tools registry', () => {
  it('exposes the eight data tools plus portfolio_risk, each with a JSON schema', () => {
    const names = listTools().map((t) => t.name);
    for (const n of ['top_yields', 'chain_tvl', 'protocol_health', 'funding_rates', 'liquidations', 'venue_spread', 'whale_activity', 'gas', 'portfolio_risk']) {
      assert.ok(names.includes(n), n);
    }
    for (const t of listTools()) assert.equal(t.inputSchema.type, 'object');
  });

  it('top_yields ranks by APY, honours stablecoinOnly and the limit', async () => {
    const { fetchImpl, calls } = transport({ '/api/defi-yields': yields });
    const all = await runTool('top_yields', { limit: 2 }, { origin: ORIGIN, fetchImpl });
    assert.deepEqual(all.rows.map((r) => r.project), ['kamino', 'aave-v3']);
    assert.match(calls[0], /minTvl=1000000/);
    const stable = await runTool('top_yields', { stablecoinOnly: true, chain: 'Ethereum' }, { origin: ORIGIN, fetchImpl });
    assert.deepEqual(stable.rows.map((r) => r.project), ['aave-v3']);
    assert.match(calls[1], /chain=Ethereum/);
  });

  it('top_yields symbol filter keeps single-asset pools of that token only, not LP pairs containing it', async () => {
    const { fetchImpl } = transport({ '/api/defi-yields': yields });
    const usdc = await runTool('top_yields', { symbol: 'usdc' }, { origin: ORIGIN, fetchImpl });
    assert.deepEqual(usdc.rows.map((r) => `${r.project}:${r.symbol}`), ['aave-v3:USDC']);
    const none = await runTool('top_yields', { symbol: 'USDT', chain: 'Solana' }, { origin: ORIGIN, fetchImpl });
    assert.deepEqual(none.rows, []);
    assert.match(none.facts[0], /No USDT pools on Solana/);
    assert.ok(TOOLS.top_yields.inputSchema.properties.symbol, 'symbol is in the schema');
  });

  it('protocol_health sorts weakest first on request', async () => {
    const { fetchImpl } = transport({ '/api/protocol-health': health });
    const r = await runTool('protocol_health', { sort: 'weakest' }, { origin: ORIGIN, fetchImpl });
    assert.equal(r.rows[0].name, 'Shady');
  });

  it('rejects unknown tools including prototype keys', async () => {
    for (const bad of ['nope', 'constructor', '__proto__', 'toString']) {
      await assert.rejects(runTool(bad, {}, { origin: ORIGIN, fetchImpl: transport({}).fetchImpl }), /Unknown tool/);
    }
    assert.equal(Object.hasOwn(TOOLS, 'constructor'), false);
  });

  it('surfaces an upstream failure and a no-data response as errors, not empty results', async () => {
    const down = transport({});
    await assert.rejects(runTool('gas', {}, { origin: ORIGIN, fetchImpl: down.fetchImpl }), /HTTP 404/);
    const empty = transport({ '/api/gas-tracker': { unavailable: true, chains: [] } });
    await assert.rejects(runTool('gas', {}, { origin: ORIGIN, fetchImpl: empty.fetchImpl }), /no live data/);
  });
});

describe('routeQuestion', () => {
  it('routes common questions to the right tool with extracted arguments', () => {
    assert.deepEqual(routeQuestion('What are the best stablecoin yields on Solana?'), { tool: 'top_yields', args: { chain: 'Solana', stablecoinOnly: true } });
    assert.deepEqual(routeQuestion('is BTC funding overleveraged'), { tool: 'funding_rates', args: { symbol: 'BTC' } });
    assert.equal(routeQuestion('any big whale moves?').tool, 'whale_activity');
    assert.equal(routeQuestion('which protocols are unsafe').args.sort, 'weakest');
  });
  it('carries the asked-about token into a yield question so the answer is about that token', () => {
    assert.deepEqual(routeQuestion('what is the best USDC yield on Solana right now?'), { tool: 'top_yields', args: { chain: 'Solana', symbol: 'USDC' } });
    assert.deepEqual(routeQuestion('where can I stake SOL for the highest APY?'), { tool: 'top_yields', args: { symbol: 'SOL' } });
  });
  it('returns null for empty or unrelated text', () => {
    assert.equal(routeQuestion(''), null);
    assert.equal(routeQuestion('tell me a joke'), null);
  });
});

describe('assessPortfolio', () => {
  const ctx = { protocols: health.protocols, rates: funding.rates };

  it('scores a diversified portfolio higher than a concentrated one in a weak protocol', () => {
    const good = assessPortfolio([{ symbol: 'ETH', usd: 5000 }, { symbol: 'BTC', usd: 5000 }, { symbol: 'USDC', usd: 5000, protocol: 'aave-v3' }, { symbol: 'SOL', usd: 5000 }], ctx);
    const bad = assessPortfolio([{ symbol: 'ETH', usd: 1000 }, { symbol: 'USDC', usd: 19000, protocol: 'Shady' }], ctx);
    assert.ok(good.summary.score > bad.summary.score + 30, `${good.summary.score} vs ${bad.summary.score}`);
    assert.ok(bad.positions[1].flags.some((f) => f.startsWith('weak_protocol')));
    assert.ok(bad.positions[1].flags.includes('single_position_over_50pct'));
  });

  it('flags crowded-leverage assets and unrated protocols', () => {
    const r = assessPortfolio([{ symbol: 'doge', usd: 100 }, { symbol: 'ETH', usd: 100, protocol: 'unknown-fork' }], ctx);
    assert.ok(r.positions[0].flags.includes('crowded_leverage:EXTREME'));
    assert.ok(r.positions[1].flags.includes('protocol_unrated'));
  });

  it('rejects empty and non-positive input', () => {
    assert.throws(() => assessPortfolio([], ctx), /at least one/);
    assert.throws(() => assessPortfolio([{ symbol: 'ETH', usd: -5 }], ctx), /at least one/);
  });

  it('portfolio_risk runs through the tool registry with live-shaped data', async () => {
    const { fetchImpl } = transport({ '/api/protocol-health': health, '/api/funding-rates': funding });
    const r = await runTool('portfolio_risk', { positions: [{ symbol: 'ETH', usd: 100 }] }, { origin: ORIGIN, fetchImpl });
    assert.equal(r.summary.totalUsd, 100);
    assert.ok(r.facts.length >= 2);
  });
});

describe('portfolio stablecoin share and protocol exposure', () => {
  const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
  const rated = [
    { name: 'Synthetic Lend', slug: 'synthetic-lend', score: 74, grade: 'B', tvl: 5e9, token: { chain: 'solana', address: THREE } },
    { name: 'Synthetic Lend Small', slug: 'synthetic-lend-small', score: 30, grade: 'E', tvl: 2e8, token: { chain: 'solana', address: THREE } },
    { name: 'Synthetic Fork', slug: 'synthetic-fork', score: 40, grade: 'D', tvl: 3e8, token: { chain: 'ethereum', address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' } },
  ];

  it('reports stablecoin share from the live stablecoin list and maps held protocol tokens to their health grade', () => {
    const r = assessPortfolio([
      { symbol: 'SOL', usd: 500, chain: 'Solana', token: { chain: 'solana', address: 'native' } },
      { symbol: 'SYNUSD', usd: 300, chain: 'Solana' },
      { symbol: 'THREE', usd: 200, chain: 'Solana', token: { chain: 'solana', address: THREE } },
    ], { protocols: rated, stablecoins: ['synusd', 'OTHERUSD'] });
    assert.equal(r.summary.stablecoinPct, 30);
    assert.equal(r.positions[1].stablecoin, true);
    assert.deepEqual(r.protocolExposure, [{ protocol: 'Synthetic Lend', slug: 'synthetic-lend', score: 74, grade: 'B', usd: 200, pct: 20, via: ['protocol_token'] }]);
    assert.equal(r.positions[2].protocol, 'Synthetic Lend');
    assert.equal(r.positions[2].protocolGrade, 'B');
    assert.equal(r.summary.protocolExposurePct, 20);
    assert.ok(r.facts.includes('Stablecoins are 30% of the portfolio.'));
    assert.ok(r.facts.some((f) => f.startsWith('Protocol exposure 20%: Synthetic Lend 20% (health B, 74/100)')));
  });

  it('matches EVM protocol tokens case-insensitively and flags weak ones', () => {
    const r = assessPortfolio([
      { symbol: 'SYNGOV', usd: 100, token: { chain: 'ethereum', address: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD' } },
      { symbol: 'ETH', usd: 100 },
    ], { protocols: rated });
    assert.equal(r.protocolExposure[0].protocol, 'Synthetic Fork');
    assert.ok(r.positions[0].flags.includes('weak_protocol:Synthetic Fork:40'));
    assert.equal(r.summary.stablecoinPct, null);
    assert.ok(r.facts.includes('Stablecoin share unknown: the stablecoin list was unavailable.'));
  });

  it('measures concentration per asset, so native and wrapped holdings of one coin count once', () => {
    const r = assessPortfolio([
      { symbol: 'SOL', usd: 300, token: { chain: 'solana', address: 'native' } },
      { symbol: 'SOL', usd: 300, token: { chain: 'solana', address: 'SYNwrapped111111111111111111111111111111' } },
      { symbol: 'SYNUSD', usd: 400 },
    ], { protocols: rated });
    assert.equal(r.summary.topAsset, 'SOL');
    assert.equal(r.summary.topPositionPct, 60);
    assert.equal(r.summary.concentrationIndex, 0.52);
    assert.ok(r.positions[0].flags.includes('single_position_over_50pct'));
    assert.ok(r.positions[1].flags.includes('single_position_over_50pct'));
    assert.ok(r.facts[0].includes('3 positions in 2 assets'));
  });

  it('prints a tiny exposure as <0.01% instead of 0%', () => {
    const r = assessPortfolio([
      { symbol: 'SOL', usd: 100000 },
      { symbol: 'THREE', usd: 0.5, token: { chain: 'solana', address: THREE } },
    ], { protocols: rated });
    assert.ok(r.facts.some((f) => f.startsWith('Protocol exposure <0.01%: Synthetic Lend <0.01%')), r.facts.join(' | '));
  });

  it('groups caller-tagged positions as exposure, rated or not', () => {
    const r = assessPortfolio([
      { symbol: 'SYNUSD', usd: 60, protocol: 'synthetic-lend' },
      { symbol: 'SYNUSD', usd: 40, protocol: 'unlisted-vault' },
    ], { protocols: rated, stablecoins: ['SYNUSD'] });
    assert.deepEqual(r.protocolExposure.map((e) => [e.protocol, e.pct, e.grade]), [['Synthetic Lend', 60, 'B'], ['unlisted-vault', 40, null]]);
    assert.equal(r.summary.stablecoinPct, 100);
  });
});

describe('portfolio_risk by wallet address', () => {
  const OWNER = 'THREEsynthetic1111111111111111111111111111';
  const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
  const hq = {
    '/api/protocol-health': { protocols: [{ name: 'Synthetic Lend', slug: 'synthetic-lend', score: 74, grade: 'B', tvl: 5e9, token: { chain: 'solana', address: THREE } }] },
    '/api/funding-rates': funding,
    '/api/stablecoins-dashboard': { stablecoins: [{ name: 'Synthetic Dollar', symbol: 'SYNUSD' }] },
  };
  function upstream({ stablesDown = false } = {}) {
    return async (url, init) => {
      const u = new URL(String(url));
      if (u.origin === ORIGIN) {
        if (stablesDown && u.pathname === '/api/stablecoins-dashboard') return new Response('{}', { status: 503 });
        return new Response(JSON.stringify(hq[u.pathname] ?? {}), { status: hq[u.pathname] ? 200 : 404 });
      }
      if (u.host === 'coins.llama.fi') {
        return new Response(JSON.stringify({ coins: {
          'coingecko:solana': { price: 100, symbol: 'SOL', confidence: 0.99 },
          [`solana:${THREE}`]: { price: 0.01, symbol: 'THREE', confidence: 0.9 },
        } }), { status: 200 });
      }
      const req = JSON.parse(init.body);
      if (req.method === 'getBalance') return new Response(JSON.stringify({ result: { value: 3e9 } }), { status: 200 });
      if (req.params[1].programId !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') return new Response(JSON.stringify({ result: { value: [] } }), { status: 200 });
      return new Response(JSON.stringify({ result: { value: [{ account: { data: { parsed: { info: { mint: THREE, tokenAmount: { uiAmountString: '10000' } } } } } }] } }), { status: 200 });
    };
  }

  it('reads the wallet, then scores it with exposure, stablecoin share and wallet coverage', async () => {
    const r = await runTool('portfolio_risk', { address: OWNER }, { origin: ORIGIN, fetchImpl: upstream() });
    assert.equal(r.wallet.address, OWNER);
    assert.equal(r.wallet.kind, 'solana');
    assert.deepEqual(r.rows.map((x) => [x.symbol, x.usd]), [['SOL', 300], ['THREE', 100]]);
    assert.equal(r.summary.totalUsd, 400);
    assert.equal(r.summary.stablecoinPct, 0);
    assert.equal(r.protocolExposure[0].grade, 'B');
    assert.equal(r.protocolExposure[0].pct, 25);
  });

  it('keeps scoring when the stablecoin list is down', async () => {
    const r = await runTool('portfolio_risk', { address: OWNER }, { origin: ORIGIN, fetchImpl: upstream({ stablesDown: true }) });
    assert.equal(r.summary.stablecoinPct, null);
    assert.equal(r.summary.totalUsd, 400);
  });

  it('needs exactly one of address or positions', async () => {
    const fetchImpl = upstream();
    await assert.rejects(runTool('portfolio_risk', {}, { origin: ORIGIN, fetchImpl }), (e) => e.status === 400 && /exactly one/.test(e.message));
    await assert.rejects(runTool('portfolio_risk', { address: OWNER, positions: [{ symbol: 'SOL', usd: 1 }] }, { origin: ORIGIN, fetchImpl }), (e) => e.status === 400);
    await assert.rejects(runTool('portfolio_risk', { positions: [{ symbol: 'SOL', usd: 1 }], chain: 'solana' }, { origin: ORIGIN, fetchImpl }), (e) => e.status === 400 && /chain only applies/.test(e.message));
  });

  it('routes a risk question that carries a wallet address to portfolio_risk', () => {
    assert.deepEqual(routeQuestion(`What is the risk of wallet ${OWNER}?`), { tool: 'portfolio_risk', args: { address: OWNER } });
    assert.deepEqual(routeQuestion('portfolio exposure of 0x2222222222222222222222222222222222222222'), { tool: 'portfolio_risk', args: { address: '0x2222222222222222222222222222222222222222' } });
    assert.equal(routeQuestion('which protocols are risky?').tool, 'protocol_health');
  });
});

describe('agent-tools handler', () => {
  const post = (body, headers = {}) => new Request('https://hq.example/api/agent-tools', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers }, body: JSON.stringify(body),
  });

  it('GET returns the catalog', async () => {
    const res = await handler(new Request('https://hq.example/api/agent-tools'));
    assert.equal(res.status, 200);
    assert.ok((await res.json()).tools.length >= 9);
  });

  it('refuses a foreign origin and unmatched questions', async () => {
    assert.equal((await handler(post({ tool: 'gas' }, { origin: 'https://evil.example' }))).status, 403);
    const res = await handler(post({ question: 'tell me a joke' }));
    assert.equal(res.status, 422);
  });

  it('400s on a bad tool name and on malformed JSON', async () => {
    assert.equal((await handler(post({ tool: 'rm_rf' }))).status, 400);
    const bad = new Request('https://hq.example/api/agent-tools', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.10' }, body: '{' });
    assert.equal((await handler(bad)).status, 400);
  });
});

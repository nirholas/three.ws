import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// DeFiLlama /pools rows, synthetic projects; only the fields the route reads.
const LLAMA = { data: [
  { pool: 'p1', chain: 'Ethereum', project: 'synthetic-lend', symbol: 'USDC', tvlUsd: 9e8, apy: 5.2, stablecoin: true },
  { pool: 'p2', chain: 'Solana', project: 'synthetic-sol-lend', symbol: 'USDC', tvlUsd: 4e8, apy: 4.4, stablecoin: true },
  { pool: 'p3', chain: 'Solana', project: 'synthetic-stake', symbol: 'SOL', tvlUsd: 2e5, apy: 7.1, stablecoin: false },
] };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

let n = 0;
/** Fresh module per test: the route keeps its cache in module scope. */
async function load(upstream) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return upstream();
  };
  n += 1;
  const { default: handler } = await import(`../api/defi-yields.js?case=${n}`);
  const get = async (qs) => (await handler(new Request(`https://hq.example/api/defi-yields${qs}`, { headers: { 'x-forwarded-for': `198.51.100.${n}` } }))).json();
  return { get, calls };
}

describe('defi-yields cache', () => {
  it('answers each chain and TVL floor from the cached pool list, not the first query', async () => {
    const { get, calls } = await load(() => Response.json(LLAMA));
    const all = await get('?minTvl=100000');
    assert.deepEqual(all.pools.map((p) => p.pool), ['p1', 'p2', 'p3']);
    const solana = await get('?chain=Solana&minTvl=1000000');
    assert.deepEqual(solana.pools.map((p) => p.pool), ['p2']);
    const eth = await get('?chain=ethereum');
    assert.deepEqual(eth.pools.map((p) => p.pool), ['p1']);
    assert.equal(calls.length, 1, 'one upstream fetch serves every query inside the TTL');
  });

  it('on an upstream failure serves the cached pools filtered for this query, marked stale', async (t) => {
    let fail = false;
    const { get, calls } = await load(() => (fail ? new Response('down', { status: 502 }) : Response.json(LLAMA)));
    await get('');
    fail = true;
    const later = Date.now() + 301_000; // past the 5-minute TTL
    t.mock.method(Date, 'now', () => later);
    const stale = await get('?chain=Solana&minTvl=1000000');
    assert.equal(calls.length, 2, 'the expired cache triggers a refetch');
    assert.deepEqual(stale.pools.map((p) => p.pool), ['p2']);
    assert.equal(stale.stale, true);
  });

  it('with no cache and a failing upstream, reports unavailable instead of empty success', async () => {
    const { get } = await load(() => new Response('down', { status: 502 }));
    const r = await get('?chain=Solana');
    assert.equal(r.unavailable, true);
    assert.deepEqual(r.pools, []);
  });
});

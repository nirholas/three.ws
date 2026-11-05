export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';
import { chainlinkToNumber, classifyFeed, deviationBps, isStale, median, parsePythPriceUpdate } from './_oracle-math.js';

/**
 * Oracle monitor: how far each on-chain oracle price sits from live exchange
 * mids. Solana is the first-class lane (the Pyth price accounts Solana
 * programs read, fetched over Solana RPC; Hermes now requires a key). Chainlink latestRoundData over a public Ethereum RPC is the
 * EVM lane. The reference price is the median of Coinbase and Kraken spot, and
 * a round past its heartbeat is reported as stale whatever its price.
 *
 *   GET /api/oracle-deviation[?threshold=<bps>]   (default 50, range 5-500)
 */

const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 20_000;
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const ETH_RPC = 'https://ethereum-rpc.publicnode.com';

const PYTH = [
  { symbol: 'SOL', account: '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE', id: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
  { symbol: 'BTC', account: '4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo', id: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
  { symbol: 'ETH', account: '42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC', id: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
];
const CHAINLINK = [
  { symbol: 'ETH', address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', decimals: 8, heartbeatSec: 3600 },
  { symbol: 'BTC', address: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', decimals: 8, heartbeatSec: 3600 },
  { symbol: 'LINK', address: '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c', decimals: 8, heartbeatSec: 3600 },
];
const PYTH_HEARTBEAT_SEC = 60;
const COINBASE = { SOL: 'SOL-USD', BTC: 'BTC-USD', ETH: 'ETH-USD', LINK: 'LINK-USD' };
const KRAKEN = { SOL: 'SOLUSD', BTC: 'XBTUSD', ETH: 'ETHUSD', LINK: 'LINKUSD' };

const signal = () => AbortSignal.timeout(TIMEOUT_MS);

async function coinbaseMid(symbol) {
  const res = await fetch(`https://api.exchange.coinbase.com/products/${COINBASE[symbol]}/ticker`, { signal: signal() });
  if (!res.ok) throw new Error(`coinbase HTTP ${res.status}`);
  const j = await res.json();
  return (Number(j.bid) + Number(j.ask)) / 2;
}

async function krakenMid(symbol) {
  const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${KRAKEN[symbol]}`, { signal: signal() });
  if (!res.ok) throw new Error(`kraken HTTP ${res.status}`);
  const j = await res.json();
  const t = Object.values(j.result || {})[0];
  return t ? (Number(t.b[0]) + Number(t.a[0])) / 2 : null;
}

async function referencePrice(symbol) {
  const mids = await Promise.allSettled([coinbaseMid(symbol), krakenMid(symbol)]);
  const values = mids.map((m) => (m.status === 'fulfilled' ? m.value : null));
  return { price: median(values), venues: values.filter((v) => v != null).length };
}

async function pythRows(refs, thresholdBps, nowSec) {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: signal(),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [PYTH.map((p) => p.account), { encoding: 'base64' }] }),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
  const accounts = (await res.json()).result?.value;
  if (!Array.isArray(accounts)) throw new Error('Solana RPC returned no accounts');
  return PYTH.map((p, i) => {
    const acct = accounts[i];
    const parsed = acct ? parsePythPriceUpdate(Buffer.from(acct.data[0], 'base64')) : null;
    const ok = parsed && parsed.feedId === p.id;
    const price = ok ? parsed.price : null;
    const updatedAtSec = ok ? parsed.publishTimeSec : null;
    const ref = refs[p.symbol];
    const bps = deviationBps(price, ref?.price);
    const stale = isStale({ updatedAtSec, heartbeatSec: PYTH_HEARTBEAT_SEC, nowSec });
    return {
      oracle: 'Pyth', chain: 'Solana', symbol: p.symbol, price, reference: ref?.price ?? null, referenceVenues: ref?.venues ?? 0,
      deviationBps: bps, updatedAtSec, ageSec: updatedAtSec ? nowSec - updatedAtSec : null, heartbeatSec: PYTH_HEARTBEAT_SEC,
      status: classifyFeed({ bps, stale, thresholdBps }),
    };
  });
}

async function chainlinkRow(feed, refs, thresholdBps, nowSec) {
  const res = await fetch(ETH_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: signal(),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: feed.address, data: '0xfeaf968c' }, 'latest'] }),
  });
  if (!res.ok) throw new Error(`Ethereum RPC HTTP ${res.status}`);
  const j = await res.json();
  const hex = (j.result || '').slice(2);
  if (hex.length < 320) throw new Error(j.error?.message || 'empty latestRoundData');
  const word = (i) => BigInt('0x' + hex.slice(i * 64, (i + 1) * 64));
  const price = chainlinkToNumber(word(1).toString(), feed.decimals);
  const updatedAtSec = Number(word(3));
  const ref = refs[feed.symbol];
  const bps = deviationBps(price, ref?.price);
  const stale = isStale({ updatedAtSec, heartbeatSec: feed.heartbeatSec, nowSec });
  return {
    oracle: 'Chainlink', chain: 'Ethereum', symbol: feed.symbol, price, reference: ref?.price ?? null, referenceVenues: ref?.venues ?? 0,
    deviationBps: bps, updatedAtSec, ageSec: nowSec - updatedAtSec, heartbeatSec: feed.heartbeatSec,
    status: classifyFeed({ bps, stale, thresholdBps }),
  };
}

let memo = null;

/** Rows for every mapped feed. A lane that fails reports its error and leaves the other lane intact. */
export async function fetchOracleRows(thresholdBps = 50) {
  if (memo && memo.threshold === thresholdBps && Date.now() - memo.at < CACHE_TTL_MS) return memo.body;
  const nowSec = Math.floor(Date.now() / 1000);
  const symbols = [...new Set([...PYTH.map((p) => p.symbol), ...CHAINLINK.map((c) => c.symbol)])];
  const refList = await Promise.all(symbols.map(async (s) => [s, await referencePrice(s).catch(() => ({ price: null, venues: 0 }))]));
  const refs = Object.fromEntries(refList);
  const [pyth, ...link] = await Promise.allSettled([pythRows(refs, thresholdBps, nowSec), ...CHAINLINK.map((c) => chainlinkRow(c, refs, thresholdBps, nowSec))]);
  const rows = [...(pyth.status === 'fulfilled' ? pyth.value : []), ...link.filter((l) => l.status === 'fulfilled').map((l) => l.value)];
  const lanes = {
    solana: pyth.status === 'fulfilled' ? { status: 'ok' } : { status: 'unavailable', reason: pyth.reason?.message || 'Solana RPC unreachable' },
    ethereum: link.some((l) => l.status === 'fulfilled') ? { status: 'ok' } : { status: 'unavailable', reason: link[0]?.reason?.message || 'Ethereum RPC unreachable' },
  };
  const body = {
    timestamp: new Date().toISOString(), thresholdBps, rows, lanes,
    sources: ['Pyth price accounts via Solana RPC', 'Chainlink latestRoundData via public Ethereum RPC', 'Coinbase and Kraken spot'],
    methodology: 'Deviation is the oracle price against the median of Coinbase and Kraken mid prices, in basis points. A round older than its heartbeat plus 10% is stale regardless of price. Pyth is checked against a 60s heartbeat, Chainlink against its 1h feed heartbeat.',
  };
  if (rows.length > 0) memo = { at: Date.now(), threshold: thresholdBps, body };
  return body;
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  const headers = { ...cors, 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: isDisallowedOrigin(req) ? 403 : 204, headers: cors });
  if (isDisallowedOrigin(req)) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...headers, Allow: 'GET, OPTIONS' } });
  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(ip)) return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { ...headers, 'Retry-After': '60' } });

  const t = Number(new URL(req.url).searchParams.get('threshold') || 50);
  if (!Number.isFinite(t) || t < 5 || t > 500) return new Response(JSON.stringify({ error: 'threshold must be between 5 and 500 basis points' }), { status: 400, headers });
  try {
    const body = await fetchOracleRows(t);
    if (body.rows.length === 0) return new Response(JSON.stringify({ ...body, error: 'No oracle lane answered' }), { status: 502, headers });
    return new Response(JSON.stringify(body), { headers: { ...headers, 'Cache-Control': 'public, max-age=15' } });
  } catch (err) {
    console.error('[oracle-deviation]', err?.message || err);
    return new Response(JSON.stringify({ error: 'The oracle sources did not answer. Try again in a moment.' }), { status: 502, headers });
  }
}

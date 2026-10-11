export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });
const CACHE_TTL = 300; // 5 minutes
let cachedResponse = null;
let cacheTimestamp = 0;

// ── Known wallets (duplicated subset for edge runtime - no TS imports) ──
const KNOWN_WALLETS = {
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60': { label: 'Binance Hot Wallet', type: 'exchange', entity: 'Binance' },
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': { label: 'Binance Hot Wallet 4', type: 'exchange', entity: 'Binance' },
  '0xf977814e90da44bfa03b6295a0616a897441acec': { label: 'Binance Cold Wallet', type: 'exchange', entity: 'Binance' },
  '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8': { label: 'Binance Cold Wallet 2', type: 'exchange', entity: 'Binance' },
  '0x5a52e96bacdabb82fd05763e25335261b270efcb': { label: 'Binance Hot Wallet 14', type: 'exchange', entity: 'Binance' },
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': { label: 'Binance Hot Wallet 6', type: 'exchange', entity: 'Binance' },
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': { label: 'Binance Hot Wallet 7', type: 'exchange', entity: 'Binance' },
  // Coinbase
  '0x503828976d22510aad0201ac7ec88293211d23da': { label: 'Coinbase Hot Wallet', type: 'exchange', entity: 'Coinbase' },
  '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740': { label: 'Coinbase Hot Wallet 2', type: 'exchange', entity: 'Coinbase' },
  '0x3cd751e6b0078be393132286c442345e68ff0afc': { label: 'Coinbase Hot Wallet 3', type: 'exchange', entity: 'Coinbase' },
  '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511': { label: 'Coinbase Cold Wallet', type: 'exchange', entity: 'Coinbase' },
  '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': { label: 'Coinbase 10', type: 'exchange', entity: 'Coinbase' },
  // Kraken
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': { label: 'Kraken Hot Wallet', type: 'exchange', entity: 'Kraken' },
  '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0': { label: 'Kraken Hot Wallet 4', type: 'exchange', entity: 'Kraken' },
  '0xda9dfa130df4de4673b89022ee50ff26f6ea73cf': { label: 'Kraken Hot Wallet 13', type: 'exchange', entity: 'Kraken' },
  // OKX
  '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': { label: 'OKX Hot Wallet', type: 'exchange', entity: 'OKX' },
  '0x236f9f97e0e62388479bf9e5ba4889e46b0273c3': { label: 'OKX Hot Wallet 2', type: 'exchange', entity: 'OKX' },
  '0xa7efae728d2936e78bda97dc267687568dd593f3': { label: 'OKX Hot Wallet 3', type: 'exchange', entity: 'OKX' },
  // Bybit
  '0xf89d7b9c864f589bbf53a82105107622b35eaa40': { label: 'Bybit Hot Wallet', type: 'exchange', entity: 'Bybit' },
  '0x1db92e2eebc8e0c075a02bea49a2935bcd2dfcf4': { label: 'Bybit Cold Wallet', type: 'exchange', entity: 'Bybit' },
  // Bitfinex
  '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa': { label: 'Bitfinex Hot Wallet', type: 'exchange', entity: 'Bitfinex' },
  '0x742d35cc6634c0532925a3b844bc9e7595f2bd1e': { label: 'Bitfinex Cold 2', type: 'exchange', entity: 'Bitfinex' },
  // Gate.io
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe': { label: 'Gate.io Hot Wallet', type: 'exchange', entity: 'Gate.io' },
  // KuCoin
  '0xd6216fc19db775df9774a6e33526131da7d19a2c': { label: 'KuCoin Hot Wallet', type: 'exchange', entity: 'KuCoin' },
  // Gemini
  '0xd24400ae8bfebb18ca49be86258a3c749cf46853': { label: 'Gemini Hot Wallet', type: 'exchange', entity: 'Gemini' },
  // Crypto.com
  '0x6262998ced04146fa42253a5c0af90ca02dfd2a3': { label: 'Crypto.com Hot Wallet', type: 'exchange', entity: 'Crypto.com' },
  // HTX
  '0xab5c66752a9e8167967685f1450532fb96d5d24f': { label: 'HTX Hot Wallet', type: 'exchange', entity: 'HTX' },
  '0x6748f50f686bfbca6fe8ad62b22228b87f31ff2b': { label: 'HTX Hot Wallet 2', type: 'exchange', entity: 'HTX' },
  // FTX estate
  '0x2faf487a4414fe77e2327f0bf4ae2a264a776ad2': { label: 'FTX Recovery', type: 'exchange', entity: 'FTX' },
  '0xc098b2a3aa256d2140208c3de6543aaef5cd3a94': { label: 'FTX Recovery 2', type: 'exchange', entity: 'FTX' },
  // Bridges
  '0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf': { label: 'Polygon Bridge', type: 'bridge', entity: 'Polygon' },
  '0xa3a7b6f88361f48403514059f1f16c8e78d60eec': { label: 'Arbitrum Gateway', type: 'bridge', entity: 'Arbitrum' },
  '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1': { label: 'Optimism Gateway', type: 'bridge', entity: 'Optimism' },
  '0x3ee18b2214aff97000d974cf647e7c347e8fa585': { label: 'Wormhole Bridge', type: 'bridge', entity: 'Wormhole' },
  // Government
  '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d': { label: 'US Gov Seized', type: 'government', entity: 'US Government' },
  // Funds
  '0x8103683202aa8da10536036edef04cdd865c225e': { label: 'Jump Trading', type: 'fund', entity: 'Jump Trading' },
  '0x9b64203878f24eb0cdf55c8c6fa7d08ba0cf77e5': { label: 'Wintermute', type: 'fund', entity: 'Wintermute' },
  '0x0000006daea1723962647b7e189d311d757fb793': { label: 'Wintermute 2', type: 'fund', entity: 'Wintermute' },
  '0xe8c19db00287e3536075114b2576c70773e039bd': { label: 'Alameda Research', type: 'fund', entity: 'Alameda' },
  '0x176f3dab24a159341c0509bb36b833e7fdd0a132': { label: 'Cumberland DRW', type: 'fund', entity: 'Cumberland' },
};

function lookupWallet(address) {
  const lower = (address || '').toLowerCase();
  const match = KNOWN_WALLETS[lower];
  if (match) return match;
  return { label: truncAddr(lower), type: 'whale', entity: null };
}

function truncAddr(addr) {
  if (!addr || addr.length < 12) return addr || 'Unknown';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function classifyTx(from, to) {
  if (from.type === 'exchange' && to.type !== 'exchange') return 'exchange_withdrawal';
  if (to.type === 'exchange' && from.type !== 'exchange') return 'exchange_deposit';
  if (to.type === 'bridge') return 'bridge_deposit';
  if (from.type !== 'exchange' && to.type !== 'exchange') return 'whale_transfer';
  return 'unknown';
}

function significance(valueUSD) {
  if (valueUSD >= 10_000_000) return 'high';
  if (valueUSD >= 1_000_000) return 'medium';
  return 'low';
}

function fmtUSD(n) {
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtETH(v) {
  if (v >= 1000) return `${(v).toLocaleString('en', { maximumFractionDigits: 0 })} ETH`;
  return `${v.toFixed(2)} ETH`;
}

// ── Fetch large Etherscan transactions ──
async function fetchEtherscanLargeTxs(controller) {
  const apiKey = typeof process !== 'undefined' ? (process.env?.ETHERSCAN_API_KEY || '') : '';
  const keyParam = apiKey ? `&apikey=${apiKey}` : '';

  // Fetch recent blocks (internal transfer list limited; use normal eth txs for a known high-volume block range)
  // We'll use Etherscan's "list normal transactions by address" for top exchange addresses
  // to find recent large movements (last ~30 min).
  const now = Math.floor(Date.now() / 1000);
  const since = now - 1800; // last 30 min

  // Pick a couple of top exchange wallets to poll
  const probeAddresses = [
    '0x28c6c06298d514db089934071355e5743bf21d60', // Binance
    '0x503828976d22510aad0201ac7ec88293211d23da', // Coinbase
    '0x2910543af39aba0cd09dbb2d50200b3e800a63d2', // Kraken
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b', // OKX
    '0xf89d7b9c864f589bbf53a82105107622b35eaa40', // Bybit
  ];

  const allTxs = [];
  const seenHashes = new Set();

  // Fetch in batches to stay within rate limits
  for (const addr of probeAddresses) {
    try {
      const url = `https://api.etherscan.io/api?module=account&action=txlist&address=${addr}&startblock=0&endblock=99999999&page=1&offset=25&sort=desc${keyParam}`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.status !== '1' || !Array.isArray(data.result)) continue;
      for (const tx of data.result) {
        if (seenHashes.has(tx.hash)) continue;
        const ts = parseInt(tx.timeStamp, 10);
        if (ts < since) continue;
        const valueWei = BigInt(tx.value || '0');
        const valueEth = Number(valueWei) / 1e18;
        if (valueEth < 50) continue; // skip small txs
        seenHashes.add(tx.hash);
        allTxs.push({ ...tx, valueEth, timestamp: ts });
      }
    } catch (err) {
      console.warn('[whale-monitor] Etherscan fetch failed for', addr, err?.message);
    }
  }

  return allTxs;
}

// ── Fetch ETH price from CoinGecko (simple/price) ──
async function fetchEthPrice(controller) {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 3500; // fallback
    const data = await res.json();
    return data?.ethereum?.usd ?? 3500;
  } catch {
    return 3500;
  }
}

// ── Build response ──
function buildResult(rawTxs, ethPrice) {
  const transactions = [];
  let exchangeInflows = 0;
  let exchangeOutflows = 0;
  let totalVolume = 0;
  let largestTx = { hash: '', valueUSD: 0 };
  const alerts = [];

  for (const tx of rawTxs) {
    const fromInfo = lookupWallet(tx.from);
    const toInfo = lookupWallet(tx.to);
    const valueUSD = tx.valueEth * ethPrice;
    const txType = classifyTx(fromInfo, toInfo);
    const sig = significance(valueUSD);

    // Only include txs above $500K
    if (valueUSD < 500_000) continue;

    const entry = {
      hash: tx.hash,
      chain: 'ethereum',
      from: { address: tx.from, label: fromInfo.label, type: fromInfo.type },
      to: { address: tx.to, label: toInfo.label, type: toInfo.type },
      value: tx.valueEth,
      valueUSD,
      token: 'ETH',
      type: txType,
      blockNumber: parseInt(tx.blockNumber, 10),
      timestamp: new Date(tx.timestamp * 1000).toISOString(),
      significance: sig,
    };
    transactions.push(entry);
    totalVolume += valueUSD;

    if (txType === 'exchange_deposit') exchangeInflows += valueUSD;
    if (txType === 'exchange_withdrawal') exchangeOutflows += valueUSD;
    if (valueUSD > largestTx.valueUSD) largestTx = { hash: tx.hash, valueUSD };

    // Generate alerts for high-significance transactions
    if (sig === 'high' || valueUSD >= 5_000_000) {
      let msg = '';
      if (txType === 'exchange_deposit') {
        msg = `${fmtETH(tx.valueEth)} (${fmtUSD(valueUSD)}) deposited to ${toInfo.label}`;
      } else if (txType === 'exchange_withdrawal') {
        msg = `${fmtETH(tx.valueEth)} (${fmtUSD(valueUSD)}) withdrawn from ${fromInfo.label}`;
      } else if (txType === 'bridge_deposit') {
        msg = `${fmtETH(tx.valueEth)} (${fmtUSD(valueUSD)}) sent to ${toInfo.label}`;
      } else {
        msg = `${fmtETH(tx.valueEth)} (${fmtUSD(valueUSD)}) whale transfer`;
      }
      alerts.push({
        type: `large_${txType}`,
        message: msg,
        significance: sig,
        timestamp: entry.timestamp,
        hash: tx.hash,
      });
    }
  }

  // Sort by value descending
  transactions.sort((a, b) => b.valueUSD - a.valueUSD);

  return {
    timestamp: new Date().toISOString(),
    transactions: transactions.slice(0, 50), // cap at 50
    summary: {
      totalVolume1h: totalVolume,
      exchangeInflows,
      exchangeOutflows,
      netExchangeFlow: exchangeInflows - exchangeOutflows,
      largestTx: largestTx.hash ? largestTx : { hash: '', valueUSD: 0 },
      alertCount: alerts.length,
      txCount: transactions.length,
    },
    alerts: alerts.slice(0, 20),
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Rate limiting
  const rl = await limiter(req);
  if (rl) return rl;

  // In-memory cache check
  const now = Date.now();
  if (cachedResponse && (now - cacheTimestamp) < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CACHE_TTL}` },
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const [rawTxs, ethPrice] = await Promise.all([
      fetchEtherscanLargeTxs(controller),
      fetchEthPrice(controller),
    ]);
    clearTimeout(timeout);

    const result = buildResult(rawTxs, ethPrice);

    // Cache
    cachedResponse = result;
    cacheTimestamp = now;

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': `public, s-maxage=${CACHE_TTL}` },
    });
  } catch (err) {
    console.error('[whale-monitor] Error:', err);
    // Return empty but valid response on failure
    const fallback = {
      timestamp: new Date().toISOString(),
      transactions: [],
      summary: {
        totalVolume1h: 0,
        exchangeInflows: 0,
        exchangeOutflows: 0,
        netExchangeFlow: 0,
        largestTx: { hash: '', valueUSD: 0 },
        alertCount: 0,
        txCount: 0,
      },
      alerts: [],
      unavailable: true,
    };
    return new Response(JSON.stringify(fallback), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    });
  }
}

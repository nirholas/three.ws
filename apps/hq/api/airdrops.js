export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

/**
 * Curated airdrop registry - kept in sync with src/config/airdrops.ts.
 * In production the single source of truth lives in the TS config; this route
 * serves an enriched, categorised version with computed daysLeft fields.
 *
 * The registry is duplicated (rather than imported) because Vercel Edge
 * functions run plain JS - no TS config imports.
 */

const AIRDROP_REGISTRY = [
  // ── Claimable ──
  {
    id: 'starknet-provisions',
    protocol: 'Starknet',
    token: 'STRK',
    symbol: 'STRK',
    chain: 'Starknet',
    status: 'claimable',
    description: 'Starknet Provisions - second wave of STRK distribution for early users and developers',
    claimUrl: 'https://provisions.starknet.io',
    claimDeadline: '2026-06-15',
    estimatedValue: '~$100-$2,000 depending on activity',
    eligibility: ['Early Starknet bridge user', 'Deployed contracts on Starknet', 'Active DeFi user on Starknet'],
    confirmed: true,
    category: 'L2',
    links: { website: 'https://starknet.io', checker: 'https://provisions.starknet.io' },
  },
  {
    id: 'eigenlayer-season2',
    protocol: 'EigenLayer',
    token: 'EIGEN',
    symbol: 'EIGEN',
    chain: 'Ethereum',
    status: 'claimable',
    description: 'EigenLayer Season 2 stakedrop for restakers and operators',
    claimUrl: 'https://claims.eigenfoundation.org',
    claimDeadline: '2026-05-01',
    estimatedValue: '~$200-$5,000 for restakers',
    eligibility: ['Restaked ETH on EigenLayer', 'Ran an EigenLayer operator', 'Held liquid restaking tokens'],
    confirmed: true,
    category: 'Infrastructure',
    links: { website: 'https://eigenlayer.xyz', checker: 'https://claims.eigenfoundation.org' },
  },

  // ── Upcoming ──
  {
    id: 'zksync-season2',
    protocol: 'zkSync',
    token: 'ZK',
    symbol: 'ZK',
    chain: 'zkSync Era',
    status: 'upcoming',
    description: 'zkSync Season 2 token distribution for continued ecosystem users',
    launchDate: '2026-Q2',
    estimatedValue: '~$100-$3,000',
    eligibility: ['Used zkSync Era after Season 1', 'Provided liquidity on zkSync DEXs', 'Participated in governance'],
    confirmed: true,
    category: 'L2',
    links: { website: 'https://zksync.io' },
  },
  {
    id: 'layerzero-season2',
    protocol: 'LayerZero',
    token: 'ZRO',
    symbol: 'ZRO',
    chain: 'Multi-chain',
    status: 'upcoming',
    description: 'LayerZero Season 2 distribution for cross-chain users',
    launchDate: '2026-Q2',
    estimatedValue: '~$50-$1,500',
    eligibility: ['Sent cross-chain messages via LayerZero', 'Used Stargate Finance', 'Bridged across 3+ chains'],
    confirmed: true,
    category: 'Infrastructure',
    links: { website: 'https://layerzero.network' },
  },
  {
    id: 'hyperlane-token',
    protocol: 'Hyperlane',
    token: 'HYP',
    symbol: 'HYP',
    chain: 'Multi-chain',
    status: 'upcoming',
    description: 'Hyperlane interoperability protocol token for early relayers and users',
    launchDate: '2026-Q1',
    estimatedValue: '~$200-$2,000',
    eligibility: ['Ran a Hyperlane relayer', 'Used Hyperlane messaging', 'Deployed Hyperlane contracts'],
    confirmed: true,
    category: 'Infrastructure',
    links: { website: 'https://hyperlane.xyz' },
  },

  // ── Rumored ──
  {
    id: 'linea-mainnet',
    protocol: 'Linea',
    token: 'LINEA',
    symbol: 'LINEA',
    chain: 'Linea',
    status: 'rumored',
    description: 'Linea mainnet token distribution for early bridge & DeFi users',
    estimatedValue: '~$500-$3,000',
    eligibility: ['Bridge to Linea', 'Use DeFi protocols', 'Hold LXP points'],
    confirmed: false,
    category: 'L2',
    links: { website: 'https://linea.build' },
  },
  {
    id: 'scroll-token',
    protocol: 'Scroll',
    token: 'SCR',
    symbol: 'SCR',
    chain: 'Scroll',
    status: 'rumored',
    description: 'Scroll zkEVM token for Scroll Marks holders',
    estimatedValue: '~$200-$2,500',
    eligibility: ['Bridge to Scroll', 'Use DeFi on Scroll', 'Accumulate Scroll Marks'],
    confirmed: false,
    category: 'L2',
    links: { website: 'https://scroll.io' },
  },
  {
    id: 'metamask-token',
    protocol: 'MetaMask',
    token: 'MASK',
    symbol: 'MASK',
    chain: 'Ethereum',
    status: 'rumored',
    description: 'MetaMask wallet token - long-rumored for active users',
    estimatedValue: '~$500-$5,000 (highly speculative)',
    eligibility: ['Active MetaMask user', 'Used MetaMask Swaps', 'Used MetaMask Bridge'],
    confirmed: false,
    category: 'Infrastructure',
    links: { website: 'https://metamask.io' },
  },
  {
    id: 'phantom-token',
    protocol: 'Phantom',
    token: 'PHANTOM',
    symbol: 'PHANTOM',
    chain: 'Solana',
    status: 'rumored',
    description: 'Phantom wallet token for power users',
    estimatedValue: '~$200-$3,000 (speculative)',
    eligibility: ['Active Phantom user', 'Used swaps', 'Multi-chain user'],
    confirmed: false,
    category: 'Infrastructure',
    links: { website: 'https://phantom.app' },
  },
  {
    id: 'berachain-token',
    protocol: 'Berachain',
    token: 'BERA',
    symbol: 'BERA',
    chain: 'Berachain',
    status: 'rumored',
    description: 'Berachain PoL L1 token for testnet & DeFi users',
    estimatedValue: '~$500-$5,000',
    eligibility: ['Used Berachain testnet', 'Provided liquidity', 'Held Bong Bears NFTs'],
    confirmed: false,
    category: 'L1',
    links: { website: 'https://berachain.com' },
  },
  {
    id: 'monad-token',
    protocol: 'Monad',
    token: 'MON',
    symbol: 'MON',
    chain: 'Monad',
    status: 'rumored',
    description: 'Monad high-performance L1 token for testnet participants',
    estimatedValue: '~$500-$5,000 (speculative)',
    eligibility: ['Monad testnet user', 'Active community member'],
    confirmed: false,
    category: 'L1',
    links: { website: 'https://monad.xyz' },
  },
  {
    id: 'eclipse-token',
    protocol: 'Eclipse',
    token: 'ECLIPSE',
    symbol: 'ECLIPSE',
    chain: 'Eclipse',
    status: 'rumored',
    description: 'Eclipse SVM L2 on Ethereum - token for early DeFi and bridge users',
    estimatedValue: '~$200-$3,000',
    eligibility: ['Bridged to Eclipse', 'Used Eclipse DeFi', 'Participated in testnet'],
    confirmed: false,
    category: 'L2',
    links: { website: 'https://eclipse.xyz' },
  },
  {
    id: 'symbiotic-token',
    protocol: 'Symbiotic',
    token: 'SYMB',
    symbol: 'SYMB',
    chain: 'Ethereum',
    status: 'rumored',
    description: 'Symbiotic restaking protocol token for early depositors',
    estimatedValue: '~$200-$3,000',
    eligibility: ['Deposited into Symbiotic vaults', 'Earned points'],
    confirmed: false,
    category: 'DeFi',
    links: { website: 'https://symbiotic.fi' },
  },

  // ── Ended ──
  {
    id: 'wormhole-w',
    protocol: 'Wormhole',
    token: 'W',
    symbol: 'W',
    chain: 'Solana',
    status: 'ended',
    description: 'Wormhole cross-chain messaging protocol token distribution',
    estimatedValue: '$200-$2,000 (actual)',
    eligibility: ['Used Wormhole bridges', 'Portal bridge users'],
    confirmed: true,
    category: 'Infrastructure',
    links: { website: 'https://wormhole.com' },
  },
  {
    id: 'ethena-ena',
    protocol: 'Ethena',
    token: 'ENA',
    symbol: 'ENA',
    chain: 'Ethereum',
    status: 'ended',
    description: 'Ethena synthetic dollar - Shard Campaign airdrop',
    estimatedValue: '$500-$10,000+ (actual)',
    eligibility: ['Held USDe', 'Staked sUSDe', 'Earned Ethena Shards'],
    confirmed: true,
    category: 'DeFi',
    links: { website: 'https://ethena.fi' },
  },
  {
    id: 'jupiter-jup-s2',
    protocol: 'Jupiter',
    token: 'JUP',
    symbol: 'JUP',
    chain: 'Solana',
    status: 'ended',
    description: 'Jupiter DEX aggregator Season 2 airdrop (Jupuary)',
    estimatedValue: '$100-$5,000 (actual)',
    eligibility: ['Used Jupiter swap aggregator', 'Held JUP'],
    confirmed: true,
    category: 'DeFi',
    links: { website: 'https://jup.ag' },
  },
];

const CACHE_TTL = 900; // 15 min
let cachedResponse = null;
let cacheTimestamp = 0;

function computeDaysLeft(deadline) {
  if (!deadline) return undefined;
  const now = new Date();
  const end = new Date(deadline);
  const diff = end - now;
  return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
}

function buildResult() {
  const now = new Date().toISOString();
  const enriched = AIRDROP_REGISTRY.map((a) => ({
    ...a,
    daysLeft: a.claimDeadline ? computeDaysLeft(a.claimDeadline) : undefined,
  }));

  const claimable = enriched.filter((a) => a.status === 'claimable');
  const upcoming = enriched.filter((a) => a.status === 'upcoming');
  const rumored = enriched.filter((a) => a.status === 'rumored');
  const recentlyEnded = enriched.filter((a) => a.status === 'ended');

  const urgentDeadlines = claimable.filter(
    (a) => a.daysLeft !== undefined && a.daysLeft <= 7
  ).length;

  return {
    timestamp: now,
    airdrops: { claimable, upcoming, rumored, recentlyEnded },
    summary: {
      claimableCount: claimable.length,
      upcomingCount: upcoming.length,
      rumoredCount: rumored.length,
      totalEstimatedValue: 'Speculative - not financial advice',
      urgentDeadlines,
    },
  };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) {
      return new Response(null, { status: 403, headers: cors });
    }
    return new Response(null, { status: 204, headers: cors });
  }

  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=1800`,
      },
    });
  }

  try {
    const result = buildResult();
    cachedResponse = result;
    cacheTimestamp = now;
    return new Response(JSON.stringify(result), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=1800`,
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: 'Internal error', timestamp: new Date().toISOString() }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  }
}

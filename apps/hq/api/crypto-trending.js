export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

/* ── Rate limiter ────────────────────────────────────────────── */
const limiter = createIpRateLimiter({ limit: 20, windowMs: 60_000 });

/* ── In-memory cache (10 min TTL) ────────────────────────────── */
const CACHE_TTL = 600; // 10 min
let cachedResponse = null;
let cacheTimestamp = 0;

/* ── Feed registry (same feeds as crypto-news) ───────────────── */
const FEEDS = [
  { name: 'CoinDesk',        url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'The Block',       url: 'https://www.theblock.co/rss.xml' },
  { name: 'Decrypt',         url: 'https://decrypt.co/feed' },
  { name: 'Cointelegraph',   url: 'https://cointelegraph.com/rss' },
  { name: 'Blockworks',      url: 'https://blockworks.co/feed' },
  { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/' },
  { name: 'The Defiant',     url: 'https://thedefiant.io/feed' },
  { name: 'DL News',         url: 'https://www.dlnews.com/feed/' },
  { name: 'Unchained',       url: 'https://unchainedcrypto.com/feed/' },
  { name: 'CryptoPotato',    url: 'https://cryptopotato.com/feed' },
  { name: 'BeInCrypto',      url: 'https://beincrypto.com/feed/' },
  { name: 'crypto.news',     url: 'https://crypto.news/feed/' },
  { name: 'Bitcoinist',      url: 'https://bitcoinist.com/feed/' },
  { name: 'NewsBTC',         url: 'https://www.newsbtc.com/feed/' },
  { name: 'CoinGape',        url: 'https://coingape.com/feed/' },
  { name: 'Protos',          url: 'https://protos.com/feed/' },
  { name: 'Messari',         url: 'https://messari.io/rss' },
  { name: 'Glassnode Insights', url: 'https://insights.glassnode.com/rss/' },
  { name: 'Solana Blog',     url: 'https://solana.com/news/rss.xml' },
  { name: 'SlowMist',        url: 'https://slowmist.medium.com/feed' },
  { name: 'samczsun',        url: 'https://samczsun.com/rss/' },
  { name: 'Stacker News',    url: 'https://stacker.news/rss' },
  { name: 'Chainlink Blog',  url: 'https://blog.chain.link/feed/' },
];

/* ── Stop words / noise filtering ────────────────────────────── */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'will', 'with',
  'this', 'that', 'from', 'they', 'were', 'what', 'when', 'make', 'like',
  'each', 'just', 'more', 'also', 'into', 'over', 'such', 'than', 'them',
  'very', 'some', 'could', 'would', 'about', 'after', 'which', 'their',
  'other', 'there', 'should', 'these', 'where', 'being', 'does', 'says',
  'said', 'its', 'how', 'why', 'new', 'may', 'now', 'get', 'here', 'top',
  'per', 'amid', 'via', 'yet', 'still', 'while', 'report', 'reports',
  'week', 'today', 'year', 'crypto', 'price', 'market', 'could', 'first',
]);

/* ── Term normalization / grouping ───────────────────────────── */
const TERM_GROUPS = {
  bitcoin: ['btc', 'bitcoin', 'satoshi'],
  ethereum: ['eth', 'ethereum', 'vitalik'],
  solana: ['sol', 'solana'],
  defi: ['defi'],
  nft: ['nft', 'nfts'],
  layer2: ['l2', 'layer2', 'rollup', 'rollups'],
  sec: ['sec'],
  etf: ['etf', 'etfs'],
  stablecoin: ['stablecoin', 'stablecoins', 'usdt', 'usdc', 'dai'],
  airdrop: ['airdrop', 'airdrops'],
  binance: ['binance', 'bnb'],
  ripple: ['ripple', 'xrp'],
  cardano: ['cardano', 'ada'],
  dogecoin: ['doge', 'dogecoin'],
  regulation: ['regulation', 'regulatory'],
  hack: ['hack', 'hacked', 'exploit', 'exploited'],
};

/* Build reverse lookup: token → canonical name */
const TOKEN_TO_CANONICAL = {};
for (const [canonical, tokens] of Object.entries(TERM_GROUPS)) {
  for (const t of tokens) {
    TOKEN_TO_CANONICAL[t] = canonical;
  }
}

/* ── Sentiment keyword lists ─────────────────────────────────── */
const BULLISH_KEYWORDS = ['surge', 'rally', 'bullish', 'soar', 'breakout', 'ath', 'pump', 'gain', 'gains', 'up', 'rises', 'rising', 'jumps', 'high', 'record', 'moon', 'boom'];
const BEARISH_KEYWORDS = ['crash', 'dump', 'bearish', 'plunge', 'drop', 'sell-off', 'selloff', 'down', 'decline', 'fear', 'loses', 'loss', 'dip', 'fall', 'falls', 'tank', 'sinks', 'slump'];

/* ── Helpers ─────────────────────────────────────────────────── */

function safeParseDateMs(str) {
  if (!str) return 0;
  const ms = Date.parse(str);
  return Number.isFinite(ms) ? ms : 0;
}

function parseTitlesFromXml(xml) {
  const titles = [];

  // RSS 2.0 <item>
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] || '';
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || block.match(/<title>(.*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    if (title) titles.push({ title, pubDate });
  }

  // Atom <entry> fallback
  if (titles.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1] || '';
      const title = (block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
        || block.match(/<title[^>]*>(.*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const pubDate = block.match(/<updated>(.*?)<\/updated>/)?.[1]
        || block.match(/<published>(.*?)<\/published>/)?.[1] || '';
      if (title) titles.push({ title, pubDate });
    }
  }

  return titles;
}

async function fetchTitles(feed, signal) {
  const res = await fetch(feed.url, {
    signal,
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*', 'User-Agent': 'three.ws-HQ/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseTitlesFromXml(xml);
}

function classifySentiment(headlines) {
  let bull = 0;
  let bear = 0;
  for (const h of headlines) {
    const lower = h.toLowerCase();
    for (const kw of BULLISH_KEYWORDS) {
      if (lower.includes(kw)) { bull++; break; }
    }
    for (const kw of BEARISH_KEYWORDS) {
      if (lower.includes(kw)) { bear++; break; }
    }
  }
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'neutral';
}

function prettifyTopic(canonical) {
  const MAP = {
    bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana', defi: 'DeFi',
    nft: 'NFT', layer2: 'Layer 2', sec: 'SEC', etf: 'ETF',
    stablecoin: 'Stablecoin', airdrop: 'Airdrop', binance: 'Binance',
    ripple: 'Ripple/XRP', cardano: 'Cardano', dogecoin: 'Dogecoin',
    regulation: 'Regulation', hack: 'Hack/Exploit',
  };
  return MAP[canonical] || canonical.charAt(0).toUpperCase() + canonical.slice(1);
}

function buildFallbackResult() {
  return {
    trending: [],
    totalArticlesAnalyzed: 0,
    timeWindow: '24h',
    fetchedAt: new Date().toISOString(),
    unavailable: true,
  };
}

/* ── Core trending extraction ────────────────────────────────── */
async function computeTrending() {
  const results = await Promise.allSettled(
    FEEDS.map(feed => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      return fetchTitles(feed, controller.signal).finally(() => clearTimeout(timeout));
    }),
  );

  const allTitles = [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const item of r.value) {
        const ms = safeParseDateMs(item.pubDate);
        // Include if within 24h or if we can't parse the date (benefit of the doubt)
        if (ms === 0 || ms >= cutoff) {
          allTitles.push(item.title);
        }
      }
    }
  }

  if (allTitles.length === 0) return buildFallbackResult();

  // Tokenize and count
  const freq = {}; // canonical → { count, headlines }
  for (const title of allTitles) {
    const tokens = title.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);
    const matched = new Set(); // track which canonical terms we've counted for this title

    for (const token of tokens) {
      if (token.length < 3) continue;
      if (STOP_WORDS.has(token)) continue;

      const canonical = TOKEN_TO_CANONICAL[token] || token;
      if (matched.has(canonical)) continue; // count once per title
      matched.add(canonical);

      if (!freq[canonical]) freq[canonical] = { count: 0, headlines: [] };
      freq[canonical].count++;
      if (freq[canonical].headlines.length < 3) {
        freq[canonical].headlines.push(title);
      }
    }
  }

  // Sort by frequency, take top 20
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  const trending = sorted.map(([canonical, data]) => ({
    topic: prettifyTopic(canonical),
    count: data.count,
    sentiment: classifySentiment(data.headlines),
    sampleHeadlines: data.headlines,
  }));

  return {
    trending,
    totalArticlesAnalyzed: allTitles.length,
    timeWindow: '24h',
    fetchedAt: new Date().toISOString(),
  };
}

/* ── Handler ─────────────────────────────────────────────────── */

export default async function handler(req) {
  const cors = getCorsHeaders(req);

  /* CORS preflight */
  if (req.method === 'OPTIONS') {
    if (isDisallowedOrigin(req)) return new Response(null, { status: 403, headers: cors });
    return new Response(null, { status: 204, headers: cors });
  }
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json', Allow: 'GET, OPTIONS' },
    });
  }

  /* Rate limit */
  const clientIp = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  if (!limiter.check(clientIp)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  /* Serve from cache if warm */
  const now = Date.now();
  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    return new Response(JSON.stringify(cachedResponse), {
      headers: {
        ...cors, 'Content-Type': 'application/json',
        'X-Cache': 'HIT', 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
      },
    });
  }

  /* Compute fresh trending data */
  try {
    const result = await computeTrending();
    cachedResponse = result;
    cacheTimestamp = Date.now();

    return new Response(JSON.stringify(result), {
      headers: {
        ...cors, 'Content-Type': 'application/json',
        'X-Cache': 'MISS', 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
      },
    });
  } catch (err) {
    console.error('[crypto-trending] Handler error:', err?.message ?? err);
    if (cachedResponse) {
      return new Response(JSON.stringify(cachedResponse), {
        headers: {
          ...cors, 'Content-Type': 'application/json',
          'X-Cache': 'STALE', 'Cache-Control': 'public, s-maxage=60',
        },
      });
    }
    const fallback = buildFallbackResult();
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
    });
  }
}

export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { createIpRateLimiter } from './_ip-rate-limit.js';

/* ── Rate limiter ────────────────────────────────────────────── */
const limiter = createIpRateLimiter({ limit: 30, windowMs: 60_000 });

/* ── In-memory cache (warm-start across invocations) ─────────── */
const CACHE_TTL = 300; // 5 min
let cachedResponse = null;
let cacheTimestamp = 0;

/* ── Feed registry (~30 high-quality crypto RSS feeds) ───────── */
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

/* ── Category keyword map ────────────────────────────────────── */
const CATEGORY_KEYWORDS = {
  bitcoin:       ['bitcoin', 'btc', 'satoshi', 'lightning network', 'halving'],
  defi:          ['defi', 'yield', 'liquidity', 'protocol', 'tvl', 'amm', 'lending', 'borrowing', 'aave', 'uniswap', 'compound', 'maker'],
  ethereum:      ['ethereum', 'eth', 'vitalik', 'eip', 'layer 2', 'l2', 'rollup', 'optimism', 'arbitrum', 'base', 'zksync'],
  solana:        ['solana', 'sol', 'jito', 'marinade', 'jupiter'],
  altcoins:      ['altcoin', 'memecoin', 'token launch', 'airdrop'],
  regulation:    ['sec', 'regulation', 'regulatory', 'compliance', 'lawsuit', 'enforcement', 'cbdc'],
  security:      ['hack', 'exploit', 'vulnerability', 'audit', 'rug pull', 'scam', 'phish'],
  research:      ['research', 'analysis', 'report', 'outlook', 'forecast'],
  institutional: ['institutional', 'etf', 'blackrock', 'grayscale', 'fidelity', 'custody'],
};

const VALID_CATEGORIES = ['all', 'bitcoin', 'defi', 'ethereum', 'solana', 'altcoins', 'regulation', 'security', 'research', 'institutional'];

/* ── Helpers ─────────────────────────────────────────────────── */

function categorize(title, description) {
  const text = `${title} ${description || ''}`.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return cat;
    }
  }
  return 'general';
}

function safeParseDateMs(str) {
  if (!str) return 0;
  const ms = Date.parse(str);
  return Number.isFinite(ms) ? ms : 0;
}

function timeAgo(dateStr) {
  const ms = safeParseDateMs(dateStr);
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Parse both RSS 2.0 (<item>) and Atom (<entry>) XML using regex.
 * Mirrors the approach in DefiNewsPanel.ts.
 */
function parseRss(xml, sourceName) {
  const items = [];

  // RSS 2.0 <item>
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] || '';
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || block.match(/<title>(.*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link = (block.match(/<link>(.*?)<\/link>/)?.[1] || '').trim();
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const desc = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s)?.[1]
      || block.match(/<description>(.*?)<\/description>/s)?.[1] || '').replace(/<[^>]+>/g, '').trim();

    if (title && link) {
      items.push({ title, link, pubDate: pubDate || new Date().toISOString(), source: sourceName, description: desc });
    }
  }

  // Atom <entry> (fallback if no RSS items found)
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1] || '';
      const title = (block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
        || block.match(/<title[^>]*>(.*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const link = (block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["'](.*?)["'][^>]*\/?>/)?.[1]
        || block.match(/<link[^>]*href=["'](.*?)["'][^>]*\/?>/)?.[1] || '').trim();
      const pubDate = block.match(/<updated>(.*?)<\/updated>/)?.[1]
        || block.match(/<published>(.*?)<\/published>/)?.[1] || '';
      const desc = (block.match(/<summary[^>]*>(.*?)<\/summary>/s)?.[1]
        || block.match(/<content[^>]*>(.*?)<\/content>/s)?.[1] || '').replace(/<[^>]+>/g, '').trim();

      if (title && link) {
        items.push({ title, link, pubDate: pubDate || new Date().toISOString(), source: sourceName, description: desc });
      }
    }
  }

  return items;
}

async function fetchFeed(feed, signal) {
  const res = await fetch(feed.url, {
    signal,
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*', 'User-Agent': 'three.ws-HQ/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml, feed.name);
}

async function fetchAllFeeds() {
  const results = await Promise.allSettled(
    FEEDS.map(feed => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      return fetchFeed(feed, controller.signal).finally(() => clearTimeout(timeout));
    }),
  );

  const articles = [];
  const sources = new Set();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value.length > 0) {
      articles.push(...r.value);
      sources.add(FEEDS[i].name);
    }
  }

  // Dedupe by normalized title
  const seen = new Set();
  const deduped = [];
  for (const a of articles) {
    const key = a.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }

  // Sort newest first
  deduped.sort((a, b) => safeParseDateMs(b.pubDate) - safeParseDateMs(a.pubDate));

  return { articles: deduped, sources: [...sources].sort() };
}

function buildFallbackResult() {
  return {
    articles: [],
    totalCount: 0,
    sources: [],
    fetchedAt: new Date().toISOString(),
    breaking: false,
    unavailable: true,
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

  /* Parse query params */
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10), 1), 100);
  const category = url.searchParams.get('category') || 'all';
  const breaking = url.searchParams.get('breaking') === 'true';

  if (!VALID_CATEGORIES.includes(category)) {
    return new Response(JSON.stringify({ error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  /* Serve from in-memory cache if warm */
  const now = Date.now();
  let allData = null;

  if (cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000) {
    allData = cachedResponse;
  } else {
    /* Fetch fresh */
    try {
      allData = await fetchAllFeeds();
      cachedResponse = allData;
      cacheTimestamp = Date.now();
    } catch (err) {
      console.error('[crypto-news] Fetch error:', err?.message ?? err);
      if (cachedResponse) {
        allData = cachedResponse; // stale fallback
      } else {
        const fallback = buildFallbackResult();
        return new Response(JSON.stringify(fallback), {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=60' },
        });
      }
    }
  }

  /* Apply filters */
  let articles = allData.articles.map(a => ({
    title: a.title,
    link: a.link,
    pubDate: a.pubDate,
    source: a.source,
    category: categorize(a.title, a.description),
    timeAgo: timeAgo(a.pubDate),
  }));

  if (category !== 'all') {
    articles = articles.filter(a => a.category === category);
  }

  if (breaking) {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    articles = articles.filter(a => safeParseDateMs(a.pubDate) >= twoHoursAgo);
  }

  const totalCount = articles.length;
  articles = articles.slice(0, limit);

  const isCache = allData === cachedResponse && now - cacheTimestamp < CACHE_TTL * 1000;

  const result = {
    articles,
    totalCount,
    sources: allData.sources,
    fetchedAt: new Date(cacheTimestamp || now).toISOString(),
    breaking,
  };

  return new Response(JSON.stringify(result), {
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'X-Cache': isCache ? 'HIT' : 'MISS',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}

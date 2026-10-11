/**
 * Crypto News Service
 *
 * Client-side service that fetches aggregated crypto news and trending topics
 * from the /api/crypto-news and /api/crypto-trending serverless routes.
 */

import { createCircuitBreaker } from '@/utils/circuit-breaker';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CryptoNewsArticle {
  title: string;
  link: string;
  pubDate: string;      // ISO 8601
  source: string;       // "CoinDesk", "The Block", etc.
  category: string;     // "bitcoin" | "defi" | "ethereum" | "solana" | "altcoins" | "regulation" | "security" | "research" | "institutional" | "general"
  timeAgo: string;      // "2h ago"
}

export interface CryptoNewsResponse {
  articles: CryptoNewsArticle[];
  totalCount: number;
  sources: string[];
  fetchedAt: string;
  breaking: boolean;
}

export interface TrendingTopic {
  topic: string;
  count: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sampleHeadlines: string[];
}

export interface CryptoTrendingResponse {
  trending: TrendingTopic[];
  totalArticlesAnalyzed: number;
  timeWindow: string;
  fetchedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Circuit breakers                                                   */
/* ------------------------------------------------------------------ */

const newsBreaker = createCircuitBreaker<CryptoNewsResponse>({
  name: 'crypto-news',
  maxFailures: 3,
  cooldownMs: 60_000,
  cacheTtlMs: 600_000,
});

const trendingBreaker = createCircuitBreaker<CryptoTrendingResponse>({
  name: 'crypto-trending',
  maxFailures: 3,
  cooldownMs: 60_000,
  cacheTtlMs: 600_000,
});

/* ------------------------------------------------------------------ */
/*  Default empty responses                                            */
/* ------------------------------------------------------------------ */

const EMPTY_NEWS: CryptoNewsResponse = {
  articles: [],
  totalCount: 0,
  sources: [],
  fetchedAt: new Date().toISOString(),
  breaking: false,
};

const EMPTY_TRENDING: CryptoTrendingResponse = {
  trending: [],
  totalArticlesAnalyzed: 0,
  timeWindow: '',
  fetchedAt: new Date().toISOString(),
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface FetchCryptoNewsOptions {
  limit?: number;
  category?: string;
  breaking?: boolean;
}

/**
 * Fetch aggregated crypto news articles.
 */
export async function fetchCryptoNews(
  options: FetchCryptoNewsOptions = {},
): Promise<CryptoNewsResponse> {
  const { limit = 30, category = 'all', breaking = false } = options;

  const params = new URLSearchParams({
    limit: String(limit),
    category,
    breaking: String(breaking),
  });

  return newsBreaker.execute(async () => {
    const res = await fetch(`/api/crypto-news?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as CryptoNewsResponse;
  }, EMPTY_NEWS);
}

/**
 * Fetch trending crypto topics.
 */
export async function fetchCryptoTrending(): Promise<CryptoTrendingResponse> {
  return trendingBreaker.execute(async () => {
    const res = await fetch('/api/crypto-trending', {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as CryptoTrendingResponse;
  }, EMPTY_TRENDING);
}

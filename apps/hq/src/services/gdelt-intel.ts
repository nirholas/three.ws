import { fetchWithProxy } from '@/utils';
import type { Hotspot } from '@/types';

export interface GdeltArticle {
  title: string;
  url: string;
  source: string;
  date: string;
  image?: string;
  language?: string;
  tone?: number;
}

export interface MarketTopic {
  id: string;
  name: string;
  query: string;
  icon: string;
  description: string;
}
export interface TopicInsight {
  topic: MarketTopic;
  articles: GdeltArticle[];
  fetchedAt: Date;
}
export const MARKET_TOPICS: MarketTopic[] = [
  {
    id: 'defi',
    name: 'DeFi Activity',
    query: '(military exercise OR troop deployment OR airstrike OR "naval exercise") sourcelang:eng',
    icon: '💰',
    description: 'DeFi protocol launches, TVL changes, and yield farming',
  },
  {
    id: 'security',
    name: 'Security Threats',
    query: '(cyberattack OR ransomware OR hacking OR "data breach" OR APT) sourcelang:eng',
    icon: '🔓',
    description: 'Cyber attacks, ransomware, and digital threats',
  },
  {
    id: 'regulation',
    name: 'Regulations',
    query: '(nuclear OR uranium enrichment OR IAEA OR "nuclear weapon" OR plutonium) sourcelang:eng',
    icon: '⚠️',
    description: 'Crypto regulations, SEC actions, compliance updates',
  },
  {
    id: 'compliance',
    name: 'Sanctions & OFAC',
    query: '(sanctions OR embargo OR "trade war" OR tariff OR "economic pressure") sourcelang:eng',
    icon: '🚫',
    description: 'OFAC sanctions, mixer bans, and address blacklists',
  },
  {
    id: 'onchain',
    name: 'On-chain Intel',
    query: '(espionage OR spy OR intelligence agency OR covert OR surveillance) sourcelang:eng',
    icon: '🔍',
    description: 'On-chain analysis, wallet tracking, MEV research',
  },
  {
    id: 'crosschain',
    name: 'Cross-chain',
    query: '(naval blockade OR piracy OR "strait of hormuz" OR "south china sea" OR warship) sourcelang:eng',
    icon: '🔗',
    description: 'Bridge exploits, cross-chain transfers, interop protocols',
  },
];
const CACHE_TTL = 5 * 60 * 1000;
const articleCache = new Map<string, { articles: GdeltArticle[]; timestamp: number }>();

function buildGdeltDocUrl(query: string, maxrecords = 10, timespan = '24h'): string {
  return `/api/gdelt-doc?query=${encodeURIComponent(query)}&maxrecords=${maxrecords}&timespan=${timespan}`;
}

export async function fetchGdeltArticles(
  query: string,
  maxrecords = 10,
  timespan = '24h'
): Promise<GdeltArticle[]> {
  const cacheKey = `${query}:${maxrecords}:${timespan}`;
  const cached = articleCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.articles;
  }

  try {
    const url = buildGdeltDocUrl(query, maxrecords, timespan);
    const response = await fetchWithProxy(url);

    if (!response.ok) {
      console.warn(`[GDELT-Intel] Failed to fetch: ${response.status}`);
      return cached?.articles || [];
    }

    const data = await response.json();
    const articles: GdeltArticle[] = data.articles || [];

    articleCache.set(cacheKey, { articles, timestamp: Date.now() });
    return articles;
  } catch (error) {
    console.error('[GDELT-Intel] Fetch error:', error);
    return cached?.articles || [];
  }
}

export async function fetchHotspotContext(hotspot: Hotspot): Promise<GdeltArticle[]> {
  const query = hotspot.keywords.slice(0, 5).join(' OR ');
  return fetchGdeltArticles(query, 8, '48h');
}

export async function fetchTopicInsight(topic: MarketTopic): Promise<TopicInsight> {
  const articles = await fetchGdeltArticles(topic.query, 10, '24h');
  return {
    topic,
    articles,
    fetchedAt: new Date(),
  };
}
export async function fetchAllTopicInsights(): Promise<TopicInsight[]> {
  const results = await Promise.allSettled(
    MARKET_TOPICS.map(topic => fetchTopicInsight(topic))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TopicInsight> => r.status === 'fulfilled')
    .map(r => r.value);
}
export function formatArticleDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    // GDELT returns compact format: "20260111T093000Z"
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = dateStr.slice(9, 11);
    const min = dateStr.slice(11, 13);
    const sec = dateStr.slice(13, 15);
    const date = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
    if (isNaN(date.getTime())) return '';

    const now = Date.now();
    const diff = now - date.getTime();

    if (diff < 0) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  } catch {
    return '';
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

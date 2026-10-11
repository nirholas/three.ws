# Agent Prompts - Fix free-crypto-news

> **Repo**: `github.com/nirholas/free-crypto-news` (Next.js 15 + TypeScript)
> **Clone with PAT**: `git clone https://<GITHUB_TOKEN>@github.com/nirholas/free-crypto-news.git /tmp/free-crypto-news`
> **Git author for all commits**: `nirholas <22895867+nirholas@users.noreply.github.com>`
> **Push remote**: Already uses the PAT URL above after clone
> **Each agent creates its own branch**, then we merge after.

---

## Agent 1: Fix Service Worker Cache Thrashing

**Branch**: `fix/sw-cache-thrashing`

**Problem**: The service worker at `public/sw.js` has `MAX_CACHE_ITEMS.dynamic = 100` which is too low. Every page navigation triggers `staleWhileRevalidate()` which calls `trimCache()` on every single request, causing hundreds of `[SW] Trimmed 1 items from dynamic-v1` log lines. The `/api/clickbait` calls (one per article visible) also flood the API cache.

**File**: `public/sw.js` (601 lines)

**Changes needed**:

1. **Increase cache limits** (around line 48):
```js
// BEFORE:
const MAX_CACHE_ITEMS = {
  api: 50,
  dynamic: 100,
  images: 200,
};

// AFTER:
const MAX_CACHE_ITEMS = {
  api: 200,
  dynamic: 500,
  images: 300,
};
```

2. **Don't intercept `/api/clickbait` requests** - they're low-value and flood the cache. In the fetch handler (around line 120), add an exclusion:
```js
// In the fetch handler, BEFORE routing to strategies:
// Skip caching for high-frequency low-value API calls
if (url.pathname.startsWith('/api/clickbait') || url.pathname.startsWith('/api/analytics')) {
  return; // Let browser handle normally
}
```

3. **Reduce trim logging** - in `trimCache()` function (around line 377), only log when trimming more than 5 items:
```js
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxItems) {
    const toDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(toDelete.map((key) => cache.delete(key)));
    if (toDelete.length > 5) {
      console.log(`[SW] Trimmed ${toDelete.length} items from ${cacheName}`);
    }
  }
}
```

4. **Bump the cache version** to force re-install:
```js
const CACHE_VERSION = 'v2';
```

**Commit message**: `fix: reduce service worker cache thrashing and log noise`

---

## Agent 2: Add Image Extraction to RSS Parser

**Branch**: `feat/rss-image-extraction`

**Problem**: The `NewsArticle` interface in `src/lib/crypto-news.ts` has NO `imageUrl` field. The `parseRSSFeed()` function doesn't extract images from RSS feeds. Most RSS feeds include images via `<media:content>`, `<media:thumbnail>`, `<enclosure>` tags, or `<img>` tags embedded in `<description>` CDATA. This means the entire site has no article images.

**File**: `src/lib/crypto-news.ts` (~2300 lines)

**Changes needed**:

1. **Add `imageUrl` to the `NewsArticle` interface** (around line 1034):
```typescript
export interface NewsArticle {
  title: string;
  link: string;
  description?: string;
  imageUrl?: string;      // <-- ADD THIS
  pubDate: string;
  source: string;
  sourceKey: string;
  category: string;
  timeAgo: string;
}
```

2. **Add image extraction regexes to `parseRSSFeed()`** (around line 1084). Add these after the existing `pubDateRegex`:
```typescript
function parseRSSFeed(xml: string, sourceKey: string, sourceName: string, category: string): NewsArticle[] {
  const articles: NewsArticle[] = [];
  
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/i;
  const linkRegex = /<link>(.*?)<\/link>|<link><!\[CDATA\[(.*?)\]\]>/i;
  const descRegex = /<description><!\[CDATA\[([\s\S]*?)\]\]>|<description>([\s\S]*?)<\/description>/i;
  const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/i;
  
  // Image extraction regexes (multiple sources)
  const mediaContentRegex = /<media:content[^>]+url=["']([^"']+)["']/i;
  const mediaThumbnailRegex = /<media:thumbnail[^>]+url=["']([^"']+)["']/i;
  const enclosureRegex = /<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i;
  const imgInDescRegex = /<img[^>]+src=["']([^"']+)["']/i;
  
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    
    const titleMatch = itemXml.match(titleRegex);
    const linkMatch = itemXml.match(linkRegex);
    const descMatch = itemXml.match(descRegex);
    const pubDateMatch = itemXml.match(pubDateRegex);
    
    // Extract image from multiple possible locations
    const rawDesc = descMatch?.[1] || descMatch?.[2] || '';
    const imageUrl = extractImageUrl(itemXml, rawDesc);
    
    const title = decodeHTMLEntities((titleMatch?.[1] || titleMatch?.[2] || '').trim());
    const link = (linkMatch?.[1] || linkMatch?.[2] || '').trim();
    const description = sanitizeDescription(rawDesc);
    const pubDateStr = pubDateMatch?.[1] || '';
    
    if (title && link) {
      const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
      articles.push({
        title,
        link,
        description: description || undefined,
        imageUrl: imageUrl || undefined,
        pubDate: pubDate.toISOString(),
        source: sourceName,
        sourceKey,
        category,
        timeAgo: getTimeAgo(pubDate),
      });
    }
  }
  
  return articles;
}
```

3. **Add the `extractImageUrl` helper** - place it right before or after `parseRSSFeed`:
```typescript
/**
 * Extract the best image URL from an RSS item.
 * Checks: media:content, media:thumbnail, enclosure, og:image, img in description
 */
function extractImageUrl(itemXml: string, rawDescription: string): string | null {
  // Priority 1: media:content (most reliable, used by major RSS feeds)
  const mediaContent = itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (mediaContent?.[1]) return mediaContent[1];
  
  // Priority 2: media:thumbnail
  const mediaThumbnail = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (mediaThumbnail?.[1]) return mediaThumbnail[1];
  
  // Priority 3: enclosure with image type
  const enclosure = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image[^"']*/i);
  if (enclosure?.[1]) return enclosure[1];
  
  // Priority 4: Also try enclosure without type check (many feeds omit type)
  const enclosureAny = itemXml.match(/<enclosure[^>]+url=["']([^"']+\.(?:jpg|jpeg|png|webp|gif))[^"']*["']/i);
  if (enclosureAny?.[1]) return enclosureAny[1];
  
  // Priority 5: img tag inside description CDATA
  if (rawDescription) {
    const imgMatch = rawDescription.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch?.[1] && !imgMatch[1].includes('feeds.feedburner') && !imgMatch[1].includes('pixel') && !imgMatch[1].includes('tracker')) {
      return imgMatch[1];
    }
  }
  
  return null;
}
```

4. **Also update the `fetchApiSource` function** (around line 1455) - check if API sources return images and map them:
Look for the `fetchApiSource` function and ensure any API-sourced articles also get their `imageUrl` field populated if available from the API response.

**Commit message**: `feat: extract images from RSS feeds for all articles`

---

## Agent 3: Hero Article Background Image

**Branch**: `feat/hero-image`

**Problem**: The HeroArticle component at `src/components/HeroArticle.tsx` has a dark gradient overlay (`bg-gradient-to-t from-gray-950 via-gray-950/60 to-gray-950/20`) but NO background image behind it. The hero card is just a solid dark box. It should show the article's image as a dramatic background.

**File**: `src/components/HeroArticle.tsx` (205 lines)

**Dependencies**: This agent depends on Agent 2 being complete (adding `imageUrl` to `NewsArticle`). If running in parallel, add `imageUrl?: string` to the local `Article` interface in this file.

**Changes needed**:

1. **Add `imageUrl` to the local Article interface** (around line 12):
```typescript
interface Article {
  title: string;
  link: string;
  description?: string;
  imageUrl?: string;      // <-- ADD THIS
  pubDate: string;
  source: string;
  timeAgo: string;
  sentiment?: string;
}
```

2. **Add a background image to the right-side hero card** (around line 154). The existing code is:
```tsx
<div className="relative h-full bg-gray-950 rounded-xl overflow-hidden flex flex-col justify-end min-h-[320px] lg:min-h-[420px]">
  {/* Gradient overlay */}
  <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/60 to-gray-950/20" />
```

Change it to:
```tsx
<div className="relative h-full bg-gray-950 rounded-xl overflow-hidden flex flex-col justify-end min-h-[320px] lg:min-h-[420px]">
  {/* Background image */}
  {article.imageUrl && (
    <img 
      src={article.imageUrl} 
      alt=""
      className="absolute inset-0 w-full h-full object-cover"
      loading="eager"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  )}
  {/* Gradient overlay */}
  <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/60 to-gray-950/20" />
```

3. **Add a fallback gradient for when there's no image** - if no imageUrl, show a subtle branded gradient instead of pure black:
```tsx
<div className={`relative h-full rounded-xl overflow-hidden flex flex-col justify-end min-h-[320px] lg:min-h-[420px] ${
  article.imageUrl ? 'bg-gray-950' : 'bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900'
}`}>
```

**Commit message**: `feat: add background image to hero article card`

---

## Agent 4: NewsCard Article Images

**Branch**: `feat/newscard-images`

**Problem**: The `NewsCard` component at `src/components/NewsCard.tsx` (298 lines) displays articles with NO images at all - just text cards. Articles should show thumbnail images when available.

**File**: `src/components/NewsCard.tsx` (298 lines)

**Dependencies**: Depends on Agent 2 (imageUrl in NewsArticle). Add `imageUrl?: string` to the local interface if running in parallel.

**Changes needed**:

1. **Add `imageUrl` to the local Article interface** (around line 57):
```typescript
interface Article {
  title: string;
  link: string;
  description?: string;
  imageUrl?: string;      // <-- ADD THIS
  pubDate: string;
  source: string;
  timeAgo: string;
}
```

2. **Add an image section to the default card variant** (around line 224, inside the `<Link>` wrapper, BEFORE the `<div className="p-5 ...">` content div). Add an image block:
```tsx
<Link 
  href={`/article/${articleSlug}`}
  className="block h-full bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden hover:shadow-xl dark:hover:shadow-2xl hover:border-brand-200 dark:hover:border-amber-500/50 hover:-translate-y-1 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
>
  {/* Article thumbnail */}
  {article.imageUrl && (
    <div className="relative aspect-[16/9] overflow-hidden bg-gray-100 dark:bg-slate-700">
      <img
        src={article.imageUrl}
        alt=""
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
      />
    </div>
  )}
  <div className="p-5 h-full flex flex-col">
    {/* ... existing content ... */}
  </div>
</Link>
```

3. **For the horizontal variant**, add a small thumbnail on the right side.

4. **For the compact variant**, no image needed (it's minimal by design).

**Commit message**: `feat: add article thumbnail images to NewsCard`

---

## Agent 5: Fix Coin Detail Page 500 Error

**Branch**: `fix/coin-page-500`

**Problem**: Visiting `/coin/rollbit-coin` (or any obscure coin) returns a 500 error. The `CoinPage` component at `src/app/[locale]/coin/[coinId]/page.tsx` calls `getCoinDetails(coinId)` which fails for coins not in CoinGecko or CoinPaprika. When both APIs fail, the `.catch(() => null)` should trigger `notFound()`, but potential issues:

1. `getCoinDetails` might throw instead of returning null when CoinPaprika fallback ID mapping fails
2. The `searchNews` call with unknown coin keywords might time out or throw, cascading the error
3. When running `Promise.all`, one unhandled rejection brings down the entire page

**Files**:
- `src/app/[locale]/coin/[coinId]/page.tsx` (376 lines)
- `src/lib/market-data.ts` (2160 lines) - `getCoinDetails` at line 1181, `getCoinDetailsFallback` at line 1211

**Changes needed**:

1. **In `page.tsx`** - Wrap the entire data-fetching block in a robust try/catch (around line 199):
```typescript
export default async function CoinPage({ params, searchParams }: Props) {
  const { coinId } = await params;
  const { tab } = await searchParams;

  if (!coinId) {
    notFound();
  }

  // Validate coinId format - prevent injection
  if (!/^[a-z0-9-]+$/i.test(coinId) || coinId.length > 100) {
    notFound();
  }

  const meta = coinMeta[coinId];

  let coinData: CoinData | null = null;
  let tickersData: { name: string; tickers: Ticker[] } = { name: coinId, tickers: [] };
  let ohlcData: OHLCData[] = [];
  let developerData: DeveloperData | null = null;
  let communityData: CommunityData | null = null;
  let newsData: { articles: any[] } = { articles: [] };

  try {
    [coinData, tickersData, ohlcData, developerData, communityData, newsData] = await Promise.all([
      getCoinDetails(coinId).catch(() => null) as Promise<CoinData | null>,
      getCoinTickers(coinId, 1).catch(() => ({ name: coinId, tickers: [] as Ticker[] })),
      getOHLC(coinId, 30).catch(() => [] as OHLCData[]),
      getCoinDeveloperData(coinId).catch(() => null as DeveloperData | null),
      getCoinCommunityData(coinId).catch(() => null as CommunityData | null),
      searchNews(meta?.keywords?.join(',') || coinId, 30).catch(() => ({ articles: [] })),
    ]);
  } catch {
    // If Promise.all itself throws, gracefully show not-found
    notFound();
  }

  if (!coinData) {
    notFound();
  }
  // ... rest of component
```

2. **In `market-data.ts`, fix `getCoinDetailsFallback`** (around line 1211) - The CoinPaprika ID mapping is brittle. For unknown coins, the fallback constructs a bad ID like `rollbit-rollbit-coin`. Add proper error handling:
```typescript
async function getCoinDetailsFallback(coinId: string): Promise<Record<string, unknown> | null> {
  try {
    const paprikaIdMap: Record<string, string> = { /* existing map */ };
    
    const paprikaId = paprikaIdMap[coinId];
    
    // If no known mapping, don't attempt CoinPaprika (bad IDs always 404)
    if (!paprikaId) {
      return null;
    }
    
    // ... rest of fetch logic
```

**Commit message**: `fix: handle coin page 500 errors for unknown coins gracefully`

---

## Agent 6: Fix Breaking News Stale Data

**Branch**: `fix/breaking-news-filter`

**Problem**: The breaking news red banner shows stale data like "₿ BTC Fees: ⚡ 2 | ⏱️ 2 | 🕐 1 sat/vB" which is feed metadata from Mempool.space, not actual breaking news. It hasn't updated in days because the 2-hour recency filter in `getHomepageNews()` keeps pulling the same stale item.

**Files**:
- `src/lib/crypto-news.ts` - the `getHomepageNews` function (around line 2201)
- `src/components/BreakingNewsBanner.tsx` (100 lines, fine as-is but verify)

**Changes needed**:

1. **In `getHomepageNews()` (around line 2225), add a filter to exclude non-news items from breaking**:
```typescript
// --- Breaking (last 2 hours) ---
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

// Filter out feed metadata items that aren't real news
const isActualNews = (a: NewsArticle) => {
  const title = a.title || '';
  // Skip mempool/blockchain status items
  if (title.startsWith('₿') || title.startsWith('⚡')) return false;
  // Skip pure ticker/trading pair items (e.g., "SOL-USDT", "BTCUSD")
  if (/^[A-Z]{2,10}[-/][A-Z]{2,10}$/i.test(title.trim())) return false;
  // Skip items that are just price/fee data
  if (/^\s*₿.*sat\/vB/i.test(title)) return false;
  // Skip blockchain network status items
  if (/Bitcoin Network:.*hashrate|EH\/s/i.test(title)) return false;
  // Must have at least 5 words to be a real headline
  if (title.split(/\s+/).length < 5) return false;
  return true;
};

const breakingArticles = allArticles
  .filter(a => a?.pubDate && new Date(a.pubDate) > twoHoursAgo)
  .filter(isActualNews)
  .slice(0, breakingLimit);
```

2. **Also apply the same filter to trending articles** to prevent status items from appearing in trending:
```typescript
const recentArticles = allArticles
  .filter(a => a?.pubDate && new Date(a.pubDate) > oneDayAgo)
  .filter(isActualNews);
```

**Commit message**: `fix: filter out feed metadata from breaking news and trending`

---

## Agent 7: Reorder Homepage Sections

**Branch**: `fix/homepage-section-order`

**Problem**: The homepage section order doesn't match the desired layout. Currently it's: Hero → Market Strip → AI Flash Brief → Market Signals → Categories → Trending Topics → Featured Stories → Clusters → Trending Narratives → 3-col layout (Latest/center/sidebar) → Most Read → Whale Activity → Live Market Activity → Source Sections → CTA.

**Desired order**:
1. Hero
2. Latest News (the center column cards, pulled out of the 3-column layout into its own top-level section)
3. Featured Stories  
4. Most Read
5. Source Sections ("More from CoinTelegraph", "More from bitcoinworld", etc.)
6. Live Market Activity (Whale Alerts + Liquidations)
7. Everything else at bottom

**File**: `src/app/[locale]/page.tsx` (347 lines)

**Changes needed**: Reorder the JSX sections in the `<main>` tag. The exact order should be:

```
1. Hero Section (keep)
2. Market Overview / HomeMarketStrip (keep, but move after hero)
3. Latest News section - extract as standalone section (not inside 3-col grid)
4. Featured Stories / FeaturedStoryTabs
5. Most Read
6. Source Sections 
7. Live Market Activity (whale alerts + liquidations)
8. Categories nav
9. AI Flash Brief
10. Market Signals
11. Trending Topics
12. News Clusters
13. Trending Narratives
14. Whale Activity Feed
15. Bottom CTA
```

Keep the left sidebar (LatestNewsFeed) and right sidebar (TrendingSidebar) - they can move to after the source sections area or be placed alongside the featured stories.

**Commit message**: `fix: reorder homepage sections for better content flow`

---

## Agent 8: Enhance Price Table with Sparklines & Fallback

**Branch**: `fix/price-table-enhancement`

**Problem**: The `HomeMarketStrip` component at `src/components/HomeMarketStrip.tsx` (140 lines) only shows # | Name | Price | 24h | Market Cap. It looks empty/broken when CoinGecko returns empty data. Needs:
1. Volume column  
2. 7d sparkline chart (data already comes from CoinGecko via `sparkline=true`)
3. Fallback static data so it never appears empty

**File**: `src/components/HomeMarketStrip.tsx` (140 lines)

**Changes needed**:

1. **Add a Volume column** to the grid layout. Change grid from `grid-cols-[40px_1fr_120px_100px_120px]` to `grid-cols-[40px_1fr_120px_100px_120px_100px]` and add volume data.

2. **Add a 7d mini sparkline** using an inline SVG polyline. The data is available at `coin.sparkline_in_7d?.price`. Add it as a small chart next to the price or in its own column.

3. **Add fallback data** - When `coins` is empty (CoinGecko failed), show static placeholder data for BTC, ETH, SOL so the table never looks broken:
```typescript
const FALLBACK_COINS = [
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', current_price: 0, price_change_percentage_24h: 0, market_cap: 0, image: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png' },
  { id: 'ethereum', name: 'Ethereum', symbol: 'eth', current_price: 0, price_change_percentage_24h: 0, market_cap: 0, image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  // ... SOL, BNB, XRP, ADA, DOGE, DOT, AVAX, LINK
];

export default async function HomeMarketStrip() {
  let coins = await getTopCoins(10);
  if (!coins || coins.length === 0) {
    coins = FALLBACK_COINS;
  }
  // ... render
```

4. **Add a formatVolume helper** similar to the existing formatMarketCap.

**Commit message**: `fix: enhance price table with volume, sparklines, and fallback data`

---

## How to Run

1. Clone the repo (each agent should do this):
```bash
git clone https://<GITHUB_TOKEN>@github.com/nirholas/free-crypto-news.git /tmp/free-crypto-news
cd /tmp/free-crypto-news
git config user.name "nirholas"  
git config user.email "22895867+nirholas@users.noreply.github.com"
```

2. Each agent creates its branch:
```bash
git checkout -b <branch-name>
```

3. Make changes, commit, push:
```bash
git add -A
git commit -m "<commit message>"
git push origin <branch-name>
```

4. After all agents complete, merge branches to main in order:
   - Agent 2 first (interface change everything depends on)
   - Agent 1 (independent)
   - Agent 5 (independent)
   - Agent 6 (touches crypto-news.ts, merge after Agent 2)
   - Agent 3 (depends on Agent 2's interface)
   - Agent 4 (depends on Agent 2's interface)
   - Agent 7 (independent)
   - Agent 8 (independent)

## Parallel Groups

These can run simultaneously without conflicts:
- **Group A**: Agent 1, Agent 5, Agent 7, Agent 8 (all touch different files)
- **Group B**: Agent 2, Agent 6 (both touch crypto-news.ts - run Agent 2 first)
- **Group C**: Agent 3, Agent 4 (different files but depend on Agent 2's interface change - add imageUrl to local interfaces to decouple)

**Safe parallel set (all 8 at once)**: Yes, as long as Agents 3 and 4 add `imageUrl?: string` to their LOCAL Article interfaces (not importing from crypto-news.ts), they can all run in parallel and be merged in order afterward.

# Fix: erc8004-crawl Cron Timeout (Exceeds Vercel 300s Limit)

## Confirmed Issue

`api/cron/[name].js` line 87:
```js
const ERC8004_DEFAULT_LOOKBACK = parseInt(process.env.ERC8004_CRAWL_LOOKBACK || '50000', 10);
```

On first run (no cursor in `erc8004_crawl_cursor`), `erc8004CrawlChain` computes:
```js
// line 132–136 (paraphrased):
const fromBlock = cursor ? cursor.last_block : latestBlock - ERC8004_DEFAULT_LOOKBACK;
```

With `ERC8004_DEFAULT_LOOKBACK = 50_000` and `ERC8004_BLOCK_CHUNK = 2_000`, the crawl loop makes **25 sequential RPC calls per chain** just for the initial catchup. With multiple chains in `CHAINS` and then 25 metadata fetches (`erc8004EnrichMetadata`), total execution easily exceeds Vercel's hard 300-second limit.

Logs confirm: `Vercel Runtime Timeout Error: Task timed out after 300 seconds` on `/api/cron/erc8004-crawl`.

## Fix

**Option A — Reduce default lookback (immediate fix):**

Lower `ERC8004_DEFAULT_LOOKBACK` to a safe value that completes in <60 seconds on first run. Based on 2,000 blocks/call at ~500ms each and multiple chains, a safe default is `2000` (one chunk per chain on first run):

In `api/cron/[name].js` line 87:
```js
// Before:
const ERC8004_DEFAULT_LOOKBACK = parseInt(process.env.ERC8004_CRAWL_LOOKBACK || '50000', 10);

// After:
const ERC8004_DEFAULT_LOOKBACK = parseInt(process.env.ERC8004_CRAWL_LOOKBACK || '2000', 10);
```

Set `ERC8004_CRAWL_LOOKBACK=50000` in the Vercel environment only when doing a one-time manual backfill (trigger the endpoint manually, not via cron).

**Option B — Per-invocation block budget:**

Add a time budget so the cron stops processing and returns before Vercel's limit:
```js
const CRAWL_BUDGET_MS = 240_000; // 240s — leaves 60s margin
const crawlStart = Date.now();

while (fromBlock <= latestBlock) {
    if (Date.now() - crawlStart > CRAWL_BUDGET_MS) break; // resume next invocation
    // ...existing loop body...
}
```

**Recommended:** Apply both — Option A as the default, Option B as a safety net.

Also add `ERC8004_CRAWL_LOOKBACK` to `.env.example` with a comment explaining the backfill use case.

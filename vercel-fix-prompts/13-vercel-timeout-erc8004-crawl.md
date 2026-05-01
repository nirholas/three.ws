# Fix: Vercel 300-Second Timeout on erc8004-crawl Cron Job

## Problem

`/api/cron/erc8004-crawl` times out with:

```
Vercel Runtime Timeout Error: Task timed out after 300 seconds
```

Vercel's maximum function execution time is 300 seconds (5 minutes) on Pro plans. The crawl job exceeds this limit.

## What to investigate

1. Find the handler for `/api/cron/erc8004-crawl` and understand what it does — how many records it processes, what external calls it makes, and why it takes >300 seconds.
2. Identify the bottleneck: is it sequential processing of many items, slow external HTTP calls, or large data sets?
3. Check if there is a cursor/offset mechanism already in place to support incremental processing.

## Expected fix

**Option A — Incremental/chunked processing with cursor:**
Instead of processing everything in one run, process a fixed-size chunk per invocation and store a cursor in the database (`solana_attestations_cursor` table already exists for this pattern). The next cron invocation picks up where the last left off.

```js
// At start of cron handler:
const cursor = await db.getCursor('erc8004-crawl');
const items = await fetchItems({ after: cursor, limit: 100 });
await processItems(items);
await db.setCursor('erc8004-crawl', items.at(-1)?.id);
```

**Option B — Increase timeout via Vercel config:**
If on Vercel Enterprise or using Edge Functions, set `maxDuration` in `vercel.json`:
```json
{
  "functions": {
    "api/cron/erc8004-crawl.js": {
      "maxDuration": 800
    }
  }
}
```
Note: This only works on Enterprise plans and has a hard ceiling.

**Option C — Background processing:**
Offload the heavy work to a background queue (e.g. Inngest, QStash, or a DB-backed job queue) and have the cron job only enqueue work, not do it inline.

Recommended: Option A (cursor-based incremental crawl) is the most robust long-term solution.

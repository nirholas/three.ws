# /play activity ticker and hype moments

A compact, collapsible feed in the bottom-left corner of `/play` (opposite chat) that shows what is really happening in the world, plus a "hype moment" for genuinely large buys. Built for the $THREE community meetups.

Code: `src/game/activity-ticker.js` (DOM), `src/game/activity-ticker.css`, `src/game/activity-feeds.js` (sources and glue), `src/game/hype-threshold.js` (per-coin threshold tuner), `src/game/trade-feed.js` (trade tape fetch with fallback). Tests: `tests/hype-threshold.test.js`, `tests/activity-feeds.test.js`, `tests/trade-feed.test.js`.

## What it shows (real events only)

| Row | Source |
| --- | --- |
| `Name joined` / `Name left` | Room roster (`add`/`remove`), announced only after the room's first sync, and not while reconnecting. The local player is "You". |
| `Buy $42 · 7xKX…AsU` / `Sell ...` | The coin trade tape the jumbotron already polls. At most 3 rows per poll (largest first) plus one summary row. Silent on the first backlog fill. |
| `Name won JACKPOT on the wheel` | Server broadcast `activity` from the spin wheel (`multiplayer/src/spin-wheel.js`). |
| `Name unlocked <cosmetic>` | Server broadcast `activity` from the boutique settle path; your own x402 cosmetic buys are noted locally. |
| `You completed <quest>` | Your own quest completions. The room does not broadcast other players' quests. |
| `Big buy $X of $SYM` (gold) | Hype moment, below. |

Wallets are truncated, names are the nameplate names, rows never link anywhere, and every string is written with `textContent` after control, zero-width and bidi characters are stripped. The server `activity` message carries only `{kind, id, label}` where `label` is a server-side catalog or wheel label, never player text.

## Staying quiet when there is nothing real to say

The ticker emits nothing for the tape when the poll failed, the chart status is `stale`, the batch is the initial backlog, or a trade is older than 90 s (an outage replay).

The trade tape comes from `/api/pump/coin-trades`. pump.fun's swap API is behind a Cloudflare challenge that answers 403 for some coins (observed for the $THREE mint). `fetchTradeTape` then falls back to `/api/pump/dex-trades` (GeckoTerminal pool trades, Solana only) and remembers for 60 s to skip the blocked primary. It throws only when every feed fails, so the chart marks itself stale. 0x coins never touch the Solana pool feed.

## Hype moments

`createHypeDirector` keeps a rolling window (200) of recent BUY sizes per unit (USD preferred, SOL otherwise). The bar is `max(p95, 4 x median)`, so it adapts per coin. Nothing fires until 20 buys have been seen. At most one winner per batch (the largest), and a strict 60 s cooldown between moments; suppressed candidates are counted in `stats()`.

A winner is routed through the existing market reactor hooks: `MarketReactor` takes an optional `isWhale(trade)` (default is the old `usd >= WHALE_USD`), and the world's `onWhale` first calls `activity.celebrate(trade)`, which posts the gold row, plays a two-note chime if the player turned sound on, and flashes the jumbotron banner (`chartScreen.hype(label)`), then runs the existing beam and toast.

Behavior change: because `isWhale` is now "the director's winner", large SELLS no longer raise the red whale beam. Only qualifying buys do.

## Ticker push API

```js
import { ActivityTicker, getActivityTicker } from './activity-ticker.js';

const ticker = new ActivityTicker();   // or getActivityTicker() for the singleton
ticker.show();

ticker.push({
  kind: 'quest',        // free-form tag, used as a CSS class suffix
  text: 'You completed Find the Lantern', // plain text, rendered with textContent
  tone: 'up',           // optional: 'up' | 'down' | 'hype'
  highlight: true,      // optional: gold row, bypasses the burst limiter
  key: 'quest:lantern', // optional: identical keys within 10 s are dropped
  ts: Date.now(),       // optional
});

const off = ticker.subscribe((row) => { /* each accepted row */ });
ticker.setOpen(true);   // persisted in localStorage `cc-ticker-open`
ticker.setSound(true);  // persisted in `cc-ticker-sound`; chime only plays when on
ticker.dispose();
```

Limits: 40 rows maximum (oldest removed), rows expire after 2 minutes, bursts above 5 rows per 2 s are coalesced into one "+N more events" row, and the expiry timer is only armed while rows exist. There is no requestAnimationFrame loop, so the per-frame cost is zero. Closed by default on screens under 720 px wide. `body.is-zen` hides it.

Adding a new source: call `ticker.push(...)` from wherever the real event arrives and clean any untrusted text with `cleanLabel` from `activity-feeds.js`.

## Developer verification hook (dev builds only)

In `npm run dev` only (`import.meta.env.DEV`; stripped from production builds):

- `window.__ccInjectTrade(usd = 5000, isBuy = true)` feeds one synthetic live trade through the real chart-screen ingest path, so it exercises the director, the cooldown, the reactor, the jumbotron and the ticker end to end.
- `window.__ccActivity()` returns `{ hub, ticker }`.

A second injection inside the 60 s cooldown must not produce a second moment.

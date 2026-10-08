# Chart Companion

> **Audience:** Traders who want company on a chart, streamers who show charts live, and coin teams who want a livelier coin page. Also developers embedding it, and the three.ws side for how reactions are decided.

[`/chart-companion`](https://three.ws/chart-companion) puts a live DEXTools chart next to a 3D agent that watches it with you. Every time a real swap lands, the agent reacts: a whale buy gets a superhero jump, a dump gets a facepalm, five buys in a row start a dance, and a buy above the day's high gets a round of applause. Each reaction comes with one spoken-style line built from the swap that caused it ("Whale alert. $4.2K buy on $THREE."), and every line in the feed links to its transaction on Solscan, so nothing on screen is invented.

It is free, keyless, and needs no account.

---

## Use it

Open [/chart-companion](https://three.ws/chart-companion) and paste any of these into the box:

- a DEXTools pair link, such as `https://www.dextools.io/app/en/solana/pair-explorer/CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa`
- a DEXTools chart widget link (`/widget-chart/...`)
- a bare pair address, or a token mint

With nothing pasted it watches $THREE.

| Control | What it does |
|---|---|
| **Open on DEXTools** | Goes to the coin's DEXTools pair page through [`/api/coin/dextools`](../api/coin/README.md), so the visit counts toward DEXTools Social Boost. |
| **Voice** | Reads each reaction aloud with the browser's own speech engine. Off by default; nothing is sent anywhere. |
| **Avatar picker** | Swaps the companion's body. Every option is a humanoid rig that the shared animation library retargets onto. |
| **Copy link / OBS overlay URL / embed code** | The three ways to take it elsewhere, described below. |

The stats strip (price, 24h change, buys and sells, net flow, biggest swap) covers the recent swaps the page loaded plus every swap since. The feed opens on the notable swaps that already happened, stamped with their real trade times, and only reactions to swaps that arrive while you watch are performed by the avatar.

## Address it by URL

| Parameter | Meaning |
|---|---|
| `pair=<address>` | A DEXTools pair (pool) address. Resolved to its token through [`/api/coin/pair`](./coin3d-embed.md). |
| `mint=<address>` | A token mint. Its most liquid pool becomes the chart's pair, through `/api/coin/pool`. |
| `url=<link>` | A pasted DEXTools link. Solana pairs only; another chain gets a clear message instead of a dead page. |
| `avatar=<name>` | `default`, `michelle`, `realistic-female`, `realistic-male`, or `mannequin`. |
| `agent=<id>` | Use your own three.ws agent as the companion, with its own body. Takes precedence over `avatar`. |
| `voice=1` | Start with the voice on (a browser may still wait for a click before it speaks). |
| `embed=1` | Chart and companion only, for an iframe. |
| `overlay=1` | Companion, speech bubble and a price ticker on a transparent background, for a stream. |

## Stream it

1. Copy the **OBS overlay URL** from the page (it is the current coin with `&overlay=1`).
2. In OBS, add a **Browser Source**, paste the URL, and size it around 500 x 700.
3. Place it over your own chart capture. The background is transparent, so only the companion, its speech bubble and the ticker show.

The overlay keeps polling while OBS has it in the background, so it never misses a swap mid-stream.

## Embed it

```html
<iframe src="https://three.ws/chart-companion?pair=CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa&embed=1"
        width="960" height="540" style="border:0;border-radius:12px" loading="lazy"
        allow="clipboard-write; fullscreen"
        title="Live chart companion by three.ws"></iframe>
```

The route is served with `frame-ancestors *`, so it frames on any site. Below 900px wide the embed stacks the companion above the chart.

---

## How reactions are decided

Everything lives in one pure module, [src/chart-companion/reactor.js](../src/chart-companion/reactor.js), covered by [tests/chart-companion-reactor.test.js](../tests/chart-companion-reactor.test.js).

- **Size is relative to the coin.** A swap is *big* at 3x the median of the last 60 swaps and a *whale* at 8x, with dollar floors of $150 and $1,000. A $300 buy is noise on a coin doing millions a day and a whale on one doing thousands; the same rule handles both, and a dead tape of tiny swaps never cries whale.
- **New highs are real highs.** The 24-hour high comes from `/api/pump/price-history` candles. A buy that prints above it is called out once, then not again for a minute.
- **Streaks fire once.** Five swaps on the same side make a streak, announced once until the side flips.
- **A burst cannot thrash the avatar.** A frame's reactions are ranked by priority (whales first, then highs, size, streaks, and quiet-tape lines). A new reaction interrupts the current one only if it outranks it; the rest still land in the feed.
- **It narrates, never advises.** Every line describes a swap that already happened. Nothing predicts a price or suggests a trade.

| Event | Clip | Emotion |
|---|---|---|
| Whale buy | `av-superhero-jump` | celebration |
| Whale sell | `defeated` | concern |
| New 24h high | `av-brag-claps` | celebration |
| Big buy / sell | `celebrate` / `facepalm` | celebration / concern |
| Buy / sell streak | `dance` / `shrug` | celebration / concern |
| Quiet for 2 minutes | `think` | patience |

Clips come from the shared library at [`/animations/manifest.json`](https://three.ws/animations/manifest.json) through `<agent-3d>`'s `playClip()`, so they play on any humanoid body, including your own agent's (see [the web component reference](./web-component.md)).

## Data path

| Step | Source |
|---|---|
| Pair to token, symbol, pair name | `GET /api/coin/pair` |
| Token to its chart pair | `GET /api/coin/pool` |
| 24h baseline | `GET /api/pump/price-history?interval=15m` |
| Live swaps, polled every 5s | `GET /api/pump/dex-trades` (edge-cached, so a crowd of viewers shares one upstream poll) |
| The chart | DEXTools' `/widget-chart/` embed, URL built by [src/shared/chart-embeds.js](../src/shared/chart-embeds.js) |

When a source is down, the page says so instead of going blank: the chart falls back to an "open on DEXTools" panel, a coin with no pool yet still gets reactions, and a stalled swap feed dims the LIVE badge and explains itself in the feed.

## Related

- [DEXTools on three.ws](./dextools.md): every DEXTools integration in one place.
- [Token in 3D, as an embed](./coin3d-embed.md): the same pair-or-mint addressing for a 3D scene of the market.
- [STRUCTURE.md](../STRUCTURE.md): where this surface lives.

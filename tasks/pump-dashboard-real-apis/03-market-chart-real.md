# 03 — Market Chart panel: render a real price chart

## Problem
[pump-dashboard.html](../../pump-dashboard.html) lines ~513–526 render only an empty state with the literal text "Chart data loading..." — there is no chart, no fetch, and no library wired up. This is a placeholder shipped to production.

## Outcome
The Market Chart panel renders a real price line/candle chart for the currently selected token (the `<select>` in the panel — task 04 owns populating that selector, but this task must work against any valid token mint passed to it). The chart updates when the selector changes.

## Data source (real, no mocks)
Use [api/pump/curve.js](../../api/pump/curve.js) for live PumpFun bonding-curve tokens (price + market cap). For graduated / non-PumpFun tokens use Birdeye OHLC via a new server-side proxy `GET /api/pump/price-history?mint=<mint>&interval=15m&from=<unix>&to=<unix>` that wraps `https://public-api.birdeye.so/defi/ohlcv?address=<mint>&type=15m&time_from=…&time_to=…` using `BIRDEYE_API_KEY` (already referenced in [api/pump/dashboard.js](../../api/pump/dashboard.js)). Never hit Birdeye from the browser — the key stays server-side.

Return shape from the new endpoint:
```json
{ "data": [ { "t": 1714867200, "o": 0.0, "h": 0.0, "l": 0.0, "c": 0.0, "v": 0.0 }, ... ] }
```

## Implementation
1. Add `api/pump/price-history.js` — Vercel function that proxies Birdeye OHLCV. Validate `mint` is base58 and in `[32,44]` chars before calling upstream; rate-limit per IP using the existing `limits` helper in [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js).
2. In [pump-dashboard.html](../../pump-dashboard.html), replace the empty state block with a `<canvas id="market-chart">` sized to fill the panel body.
3. Render the chart with a tiny vanilla canvas line plot (no new dependency required). No fake animations, no `setTimeout` frame stalls — draw once per data load and on resize via `ResizeObserver`. Required visual: x-axis time ticks (every ~6 segments, formatted as `HH:mm` for ≤24h windows, `MMM d` otherwise), y-axis price ticks (5 evenly spaced, formatted with adaptive decimals), a hairline crosshair on hover that displays time + close at the cursor.
4. Wire the panel `<select>` change event (and an initial load) to call `/api/pump/price-history` for the selected mint with the last 24 hours, plus `/api/pump/curve?mint=…` for a live "spot" overlay when the token is a PumpFun token.
5. Real states only:
   - Loading: render a skeleton grid in the canvas — do **not** display "Chart data loading…" forever.
   - Empty (`data: []`): write "No trades in the selected window" centered in the canvas.
   - Upstream 4xx/5xx: render the upstream error message returned by `/api/pump/price-history`. Never silently fall back to fake data.

## Definition of done
- Selecting a real graduated token (e.g. paste a known mainnet mint into the selector via task 04 or via DOM) renders a real line chart with real OHLC values; numbers match Birdeye's UI for the same window.
- Selecting a live PumpFun token renders the price-history series and an overlaid live spot price from `/api/pump/curve`.
- Network tab shows `/api/pump/price-history` succeeding; no calls to `public-api.birdeye.so` originate from the browser.
- `BIRDEYE_API_KEY` missing → endpoint returns 503 `not_configured` and the panel surfaces it; no silent fallback.
- `npm test` green; **completionist** subagent run on changed files.

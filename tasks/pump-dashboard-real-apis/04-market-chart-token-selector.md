# 04 — Market Chart token selector: real trending-token list

## Problem
[pump-dashboard.html](../../pump-dashboard.html) line ~519 contains a `<select>` whose only option is the literal placeholder `<option>Top Token</option>`. There is no fetch, no token mint, and the chart cannot be driven. Placeholder data shipped to production.

## Outcome
On Dashboard load, the selector is populated with **real** trending Solana tokens (symbol + short mint), and changing it dispatches a `chart:tokenChange` CustomEvent on the document carrying `{ mint, symbol }` so the chart panel (task 03) consumes it. The default selected option must be the top trending token returned by the API — **never** a hardcoded fallback like SOL or USDC.

## Data source (real, no mocks)
Add a server-side proxy `GET /api/pump/trending?limit=25` that calls Birdeye `https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=25&chain=solana` using `BIRDEYE_API_KEY` (the same key wired in [api/pump/dashboard.js](../../api/pump/dashboard.js)). Never expose the key to the browser.

Returned shape:
```json
{ "data": [ { "mint": "...", "symbol": "...", "name": "...", "logo": "https://…", "price_usd": 0.0, "rank": 1 }, ... ] }
```

## Implementation
1. Add `api/pump/trending.js` (Vercel function). Validate query params, rate-limit with `limits.publicIp` from [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js), and return upstream errors verbatim (no fallback list).
2. In [pump-dashboard.html](../../pump-dashboard.html):
   - On `DOMContentLoaded` and on every nav into the Dashboard page, call `/api/pump/trending?limit=25` and replace the `<select>` options with the real list. Each `<option value="<mint>">` shows `#<rank>  <SYMBOL>  (<short mint>)`.
   - On `change`, dispatch `document.dispatchEvent(new CustomEvent('chart:tokenChange', { detail: { mint, symbol } }))`.
   - Auto-select the first item and dispatch the event so the chart paints immediately on load.
3. Real states:
   - Loading: a single disabled `<option>Loading trending tokens…</option>` while the request is in flight (replaced when it resolves — no `setTimeout` smoothing).
   - Error / 503: a single disabled `<option>` displaying the upstream error string, plus an inline retry button next to the select. Do not silently render a hardcoded list.
   - Empty (`data: []`): single disabled `<option>No trending tokens right now</option>`.

## Definition of done
- Network tab shows `/api/pump/trending` succeeding; no Birdeye calls from the browser.
- The selector contains 25 real trending tokens with valid mainnet mints; clicking one dispatches the event.
- `BIRDEYE_API_KEY` missing → endpoint returns 503 `not_configured`; the selector surfaces the error and never renders a fake list.
- No string `"Top Token"` remains in the HTML.
- `npm test` green; **completionist** subagent run on changed files.

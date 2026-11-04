# Mobile performance re-measure (2026-11-03 order, measured 2026-11-04)

Method: `node scripts/mobile-perf.mjs` (Playwright PerformanceObserver metrics, not Lighthouse), Pixel 5, slow 4G (1.6 Mbps / 150 ms RTT), 4x CPU, 1 run, 6 s settle. TBT* is a long-task blocking-time proxy.

## Budget (enforced by `--budget`)

LCP at most 4000 ms, CLS at most 0.1, TBT* at most 600 ms, on `/`, `/play`, `/marketplace`, `/forge`, the $THREE coin page and one agent profile. The gate lives in `scripts/lib/mobile-perf-budget.mjs` (tests: `tests/mobile-perf-budget.test.js`). Run `node scripts/mobile-perf.mjs --budget --base https://three.ws`; it exits 1 and prints one OVER line per breach.

## Before (production, https://three.ws)

| page | LCP ms | CLS | TBT* ms |
|---|---|---|---|
| /marketplace | 25596 | 0.237 | 10103 |
| /play | 18484 | 0.230 | 15345 |
| /agents/d94d2a50-... | 16884 | 0.217 | 2442 |
| / | 7356 | 0.099 | 2324 |
| /forge | 3348 | 0.177 | 2065 |
| /coin/FeMb...pump | 2936 | 0.481 | 1313 |

## Fix shipped: coin page chart layout shift

The coin chart section rendered empty, then a 300 px loading state, then a 440/520 px provider embed, shifting everything below it (largest shift 0.44 on `section#cv-chart`). The static HTML now carries the chart skeleton, and the skeleton, the loading state and the embed wrapper share one height (440 px, 520 px from 768 px wide).

After, measured against the local Vite dev server (unbundled, so LCP and TBT are not comparable to production): coin CLS 0.530 to 0.257. A second shift source remains on that page and has not been isolated.

## Remaining work (owner or next pass)

1. Deploy, then run `--budget` against production to get the real after numbers for the coin fix.
2. Coin page: isolate the remaining 0.26 CLS (use the layout-shift sources the harness prints).
3. /marketplace, /play, /agents/<id>: LCP 17-26 s and TBT 2-15 s are dominated by the 3D/world bundle and 130-166 requests; they need code-splitting and deferral of WebGL until interaction. `section#market-hero` (0.107), `/play` `section` (0.23) and `main#av-shell` are the CLS sources.

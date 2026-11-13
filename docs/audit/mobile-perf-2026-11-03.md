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

## Re-measured 2026-11-13 (production, before this pass)

Same harness and profile (Pixel 5, slow 4G, 4x CPU, 1 run), against https://three.ws at revision `0d4c38210`. The measuring host was heavily loaded (load average 114 to 198 on 32 cores while other sessions built and tested), so TBT* is inflated here and should be read as relative, not absolute. LCP elements and layout-shift sources are the trustworthy signals.

| page | LCP ms | CLS | TBT* ms | transfer | requests | LCP element / largest shifts |
|---|---|---|---|---|---|---|
| /marketplace | 22916 | 0.167 | 32591 | 3214 KB | 149 | `/cdn/thumb/...png` (300 KB); `section#market-hero` 0.106, `div#tws-corner-stack` 0.060 |
| /agents/d94d2a50-... | 17072 | 0.133 | 34890 | 3943 KB | 156 | `div#av-stage-loading`; `main#av-shell` 0.067, corner stack 0.060; 653 KB `three-addons` preloaded |
| /coin/FeMb...pump | 6192 | 0.360 | 2771 | 612 KB | 98 | `span.cv-price`; `section#cv-chart` 0.126 and 0.116, corner stack 0.059 twice |
| /forge | 4872 | 0.128 | 12028 | 1655 KB | 117 | corner stack 0.060 twice |
| / | 1084 | 0.101 | 3387 | 1499 KB | 45 | `ul` 0.041, `body` 0.030, `div#os` 0.030 |
| /play | probe failed | | | 4240 KB | 142 | main thread blocked for over 30 s; Rapier (1.55 MB) is the largest download |

Every page breaks the budget (15 OVER lines). Several of the CLS sources were already fixed locally by other passes the same day and were waiting on a deploy: the corner stack (`541124072`), the coin header (`921a32abd`), the marketplace theme strip, the avatar-page action bar (`5695b5950`) and the forge starter chips.

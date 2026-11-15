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

## Fix: the agent profile no longer downloads three.js on first load

`/agents/<id>` shows its avatar in `<model-viewer>`, but [src/avatar-page.js](../../src/avatar-page.js) statically imported three click-only features that each build their own three.js scene: the Talk overlay, the Pose stage and the client-side GLB/OBJ/USDZ export. So every visit modulepreloaded the site's three.js stack (`three-addons`, `talk-scene`, `usdz-pipeline` and their dependencies), the largest script on the page. They now load through cached dynamic imports that retry after a failed load. Talk starts fetching on hover, focus or touch, shows a busy state, and toasts if the chunk cannot load. [tests/avatar-page-first-load.test.js](../../tests/avatar-page-first-load.test.js) walks the static import graph with es-module-lexer ([scripts/lib/static-import-graph.mjs](../../scripts/lib/static-import-graph.mjs)) and fails if anything reachable from the page entry pulls in three.js.

Built output, same page: modulepreloads 67 to 44, first-load JavaScript 896 KB to 137 KB gzip.

## After (local production builds, 2026-11-13)

Measured with [scripts/perf-preview-server.mjs](../../scripts/perf-preview-server.mjs) (see [scripts/README.md](../../scripts/README.md)): the built bundle served through the production route table, with `/api`, `/cdn` and bucket assets streamed live from https://three.ws. "Before" is a build of `d71c512e3`, "after" a build of `9728d0dab`. Both builds already contain the other passes' undeployed CLS fixes, which is why CLS is under budget in both columns; the agent-profile delta between them is this pass alone (no other commit in that range touches the page or its imports). Host load average was about 200 on 32 cores, so TBT* is inflated and noisy.

Agent profile, three interleaved runs per build (median, range):

| build | LCP ms | CLS | TBT* ms | transfer | requests |
|---|---|---|---|---|---|
| before | 21900 (15676 to 22892) | 0.006 | 34611 | 4026 KB | 156 |
| after | 13680 (10296 to 16656) | 0.006 | 27822 | 3269 KB | 132 |

Full `--budget` pass, one run per page, before then after:

| page | LCP ms | CLS | TBT* ms | transfer |
|---|---|---|---|---|
| /marketplace | 28568 / 18664 | 0.000 / 0.000 | 26680 / 13715 | 3217 KB / 783 KB |
| /agents/d94d2a50-... | 16356 / 18408 | 0.007 / 0.000 | 52117 / 27411 | 4024 KB / 3315 KB |
| /coin/FeMb...pump | 12908 / 13924 | 0.000 / 0.000 | 5868 / 5411 | 604 KB / 656 KB |
| /forge | 3592 / 4484 | 0.009 / 0.009 | 18878 / 20141 | 1703 KB / 1778 KB |
| / | 2068 / 1512 | 0.052 / 0.052 | 5236 / 2947 | 996 KB / 953 KB |
| /play | probe failed / probe failed | | | 3085 KB / 3085 KB |

The single-run agent LCP in this table (16356 to 18408) sits inside the run-to-run spread the interleaved runs show, which is why the A/B above uses three. The marketplace drop between builds (3217 KB to 783 KB, no WebGL context created) comes from another pass in the range, the shared marketplace hero rework (`9af7292d1`, `ab4412953`), not from this one.

Verified in a Pixel 5 emulated browser against the after build: no 3D chunk on first load; Talk opens its overlay (fetching talk-mode, talk-scene and three-addons on demand); the Pose tab mounts its canvas and, for this unrigged avatar, shows the designed "needs a rigged humanoid skeleton" message; the VRM export loads the exporter and reports its own skeleton error. The only other console error was a 404 from production's `/api/actions/agent-hire?probe=1`, already fixed locally in `86647347d` and waiting on the same deploy.

## Remaining work (2026-11-13)

1. Deploy (`git push threews main`, then `npm run deploy:gcp:full`), then run `node scripts/mobile-perf.mjs --budget --base https://three.ws` on a quiet machine. CLS should then clear on every page; LCP and TBT* will not.
2. Agent profile: the avatar GLB itself (1.46 MB for this agent) is now the largest download and `<model-viewer>` evaluation follows it. Serve a decimated mobile tier of the GLB, or show the avatar's still thumbnail until the viewer is in view and idle.
3. `/play`: the probe cannot even read metrics because the main thread is blocked for over 30 s. Rapier (1.55 MB) and the world bundle need to load after first paint, behind an explicit "enter world" step on mobile.
4. `/marketplace` and `/coin`: LCP is bound to API data (the hero thumbnail, the live price), so it moves with API latency more than with bundle size.
5. TBT* at 4x CPU is over 600 ms on every page, including home. Reaching that bar needs per-page main-thread budgets, not one more lazy import.

## Re-measure and fixes (2026-11-15)

### Production, before this pass

`node scripts/mobile-perf.mjs --budget --base https://three.ws` on 2026-11-15 (production build `518f61469`), Pixel 5, slow 4G, 4x CPU, one run per page, host load average about 70:

| page | LCP ms | CLS | TBT* ms | transfer | LCP element |
|---|---|---|---|---|---|
| /play | 50252 | 0.001 | 65333 | 3882 KB | `p.pi-body` |
| /marketplace | 15228 | 0.000 | 7709 | 1010 KB | `img.market-hero-poster` |
| /agents/d94d2a50-... | 7436 | 0.000 | 22144 | 3457 KB | `#av-stage-loading` |
| /forge | 4904 | 0.006 | 9227 | 1722 KB | |
| /coin/FeMb...pump | 2656 | 0.001 | 1316 | 1188 KB | |
| / | 2464 | 0.094 | 3004 | 1012 KB | |

CLS now clears on every page (the 2026-11-03 to 2026-11-13 fixes are live). Ten budget lines are over: LCP on /play, /marketplace, /agents and /forge, and TBT* on all six.

### Root cause 1: one 2.4 MB "three-addons" chunk on every 3D surface

The request initiator trace showed /, /coin, /forge and /play each downloading `three-addons-*.js` at 638 KB transfer, even on pages that only render the walk companion or footer bot. Its source map (built with `build.sourcemap`) explained it: the `manualChunks` rule sent every module under `three/examples` to one group, and rolldown packed that group into a single 2.4 MB chunk (664 KB gzip) that held three's WebGPU and TSL builds (about 700 KB, only used by the cinematic TSL path), chevrotain (148 KB, VRML only), and the FBX, USD, Collada, LDraw and 3DM loaders next to GLTFLoader. Every lazy `import('three/addons/loaders/FBXLoader.js')` compiled to a facade that imported the whole chunk.

Fix: the vendor rules moved to [scripts/vite/vendor-chunks.mjs](../../scripts/vite/vendor-chunks.mjs) (unit-tested in [tests/vite-vendor-chunks.test.js](../../tests/vite-vendor-chunks.test.js)). Only three's WebGL build (`three.core.js`, `three.module.js`) stays a shared `three-core` vendor chunk (183 KB transfer); addons and the WebGPU/TSL builds follow the import graph, so a lazy loader stays lazy.

Static import closure (everything a page must download before the entry runs), gzip, same commit before and after the rule change:

| entry | before | after |
|---|---|---|
| walk companion (site-wide) | 741 KB | 280 KB |
| footer bot | 667 KB | 206 KB |
| feature tour | 732 KB | 270 KB |
| /play | 1145 KB | 700 KB |
| /forge | 1165 KB | 741 KB |

### Root cause 2: the agent profile's stats row raced the avatar download

`fetchGlbStats` in [src/lib/glb-stats.js](../../src/lib/glb-stats.js) sent a HEAD request and then a 256 KB range request to read the GLB's JSON chunk, which is 1,324 bytes for this agent. On a 1.6 Mbps link that 256 KB shared bandwidth with `<model-viewer>`'s own download of the same 1.46 MB file. It now reads a 16 KB first window, takes the file size from the GLB header, and fetches only the missing bytes when the JSON chunk is larger. A server that ignores Range still works. Pinned by [tests/glb-stats.test.js](../../tests/glb-stats.test.js).

### Local before and after

Both builds served by [scripts/perf-preview-server.mjs](../../scripts/perf-preview-server.mjs) with `/api` and `/cdn` proxied to production. "Before" is the session's starting HEAD, "after" adds the two fixes. One run each, measured concurrently, host load average about 200 on 32 cores, so LCP and TBT* swing by seconds between runs and only transfer is a reliable comparison:

| page | transfer before / after | LCP ms before / after | TBT* ms before / after |
|---|---|---|---|
| / | 1412 KB / 965 KB | 984 / 5112 | 3689 / 4316 |
| /forge | 1767 KB / 1364 KB | 3244 / 3168 | 8963 / 7448 |
| /play | 3074 KB / 2616 KB | probe failed / probe failed | |
| /coin/FeMb...pump | 650 KB / 850 KB | 3984 / 4912 | 2418 / 3599 |
| /agents/d94d2a50-... | 3259 KB / 3275 KB | 7812 / 6088 | 22460 / 23054 |
| /marketplace | 1054 KB / 1237 KB | 23492 / 30412 | 11272 / 12455 |

The coin "after" run includes the walk companion's first-visit auto-summon (it fires when the page goes quiet, which the "before" run missed inside its settle window); that summon now costs 280 KB instead of 741 KB. The marketplace difference is its live API data, not the bundle: no file it loads changed. The agent profile saving does not show through the proxy, which does not honour Range the way the bucket does.

Verified in a Pixel 5 emulated browser (SwiftShader WebGL) against the after build with the companion enabled: /, /coin, /forge, /agents, /walk, /app and /play load with no page errors and no failed asset requests; the companion, footer bot, agent stage, viewer and /play canvases render; /play reaches its lobby. The only console error was a 429 from the production API behind the proxy.

### Remaining work (2026-11-15)

1. Deploy (`git push threews main`, then `npm run deploy:gcp:full`) and re-run `node scripts/mobile-perf.mjs --budget --runs 3 --base https://three.ws` on a quiet machine to record the production after column.
2. `/play` is still far over: the world's own bundle (700 KB gzip static closure) plus Rapier load before the first frame. A mobile "enter world" step that defers both is the next lever.
3. `/marketplace` and `/coin` LCP track API latency (hero thumbnail, live price), not bundle size.
4. TBT* under 600 ms at 4x CPU is not reachable on these pages with lazy loading alone; it needs per-page main-thread budgets.
